"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { decodeSave } = require("./lib/session");
const { mapSession, detectVariant } = require("./public/js/import-map");
const { applyVariant } = require("./public/js/variant");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const read = (f) => { try { return fs.readFileSync(path.join(__dirname, f), "utf8"); } catch (e) { console.warn("missing " + f); return null; } };
const guideRaw = read("guide.json");
const guide = JSON.parse(guideRaw);
const spawnsRaw = read("spawns.json");
const ids = JSON.parse(read("pokerogue-ids.json") || "null");

// ---- import targets: values from a save are capped at what the guide (for the chosen variant) needs
function targetsFor(guide) {
  const targets = {};
  guide.starters.forEach((s) => (targets["s:" + s.id] = 1));
  guide.items.forEach((it) => {
    targets["i:" + it.id] = it.qty || 1;
    if (it.max_iv !== undefined) targets["iv:" + it.id] = 31;
  });
  guide.splicing.steps.forEach((p) => { if (!p.optional) targets["p:" + p.n] = 1; });
  guide.final_builds.forEach((b) => {
    targets["b:" + b.id] = 1;
    b.moves.forEach((_, j) => (targets["m:" + b.id + ":" + j] = 1));
  });
  return targets;
}
function clamp(targets, k, v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(targets[k], n)) : 0;
}
// Progress lives in each browser's localStorage. The server only serves the page, guide data
// and decodes save files for import; it stores nothing.

// ---- helpers
function send(res, code, body, type) {
  res.writeHead(code, { "Content-Type": type || "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
function readText(req, limit) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (c) => { data += c; if (data.length > limit) { reject(new Error("too large")); req.destroy(); } });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
// script URLs carry a content hash so browser/CDN caches never serve stale code after a deploy
const assetVersion = require("node:crypto").createHash("sha1")
  .update(fs.readdirSync(path.join(PUBLIC_DIR, "js")).sort().map((f) => fs.readFileSync(path.join(PUBLIC_DIR, "js", f))).join(""))
  .digest("hex").slice(0, 10);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png" };

// ---- server
http.createServer(async (req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  try {
    if (p === "/api/guide" && req.method === "GET") return send(res, 200, guideRaw);
    if (p === "/api/spawns" && req.method === "GET") return spawnsRaw ? send(res, 200, spawnsRaw) : send(res, 404, { error: "no spawn data" });
    if (p === "/api/import" && req.method === "POST") {
      // preview only: decode the save and map it; the client decides whether to apply
      if (!ids) return send(res, 503, { error: "import data missing on server" });
      let session;
      try { session = decodeSave(await readText(req, 4 * 1024 * 1024)); }
      catch (e) { return send(res, 400, { error: e.message }); }
      const q = new URL(req.url, "http://x").searchParams;
      // the save's party decides the build where it is clear; the page's toggle fills the rest
      const found = detectVariant(session, ids);
      const variant = { carry: found.carry || q.get("carry"), killer: found.killer || q.get("killer") };
      const g = applyVariant(guide, variant);
      const targets = targetsFor(g);
      const r = mapSession(session, g, ids);
      for (const k of Object.keys(r.values)) r.values[k] = k in targets ? clamp(targets, k, r.values[k]) : 0;
      r.variant = variant; r.detected = found;
      return send(res, 200, r);
    }
    if (p === "/healthz") return send(res, 200, "ok", "text/plain");
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method not allowed" });

    const file = path.normalize(path.join(PUBLIC_DIR, p === "/" ? "index.html" : p));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, "not found", "text/plain");
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, "not found", "text/plain");
      if (file.endsWith(".html")) buf = Buffer.from(buf.toString("utf8").replace(/src="js\/([\w.-]+\.js)"/g, 'src="js/$1?v=' + assetVersion + '"'));
      // sprites only change when tools/sprites.py is rerun; let browsers keep them for a day
      const cache = p.startsWith("/sprites/") ? "public, max-age=86400" : "no-cache";
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": cache });
      res.end(buf);
    });
  } catch (e) {
    send(res, 400, { error: String(e.message || e) });
  }
}).listen(PORT, () => console.log("listening on " + PORT + ""));
