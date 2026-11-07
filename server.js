"use strict";
// Local static server for testing the site (the dev container on :3320). The site itself is
// fully static: everything lives in docs/ and runs in the browser, so GitHub Pages can host it.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, "docs");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png" };

http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); }
  catch (e) { res.writeHead(400, { "Content-Type": "text/plain" }); return res.end("bad request"); }
  if (p === "/healthz") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("ok"); }
  const file = path.normalize(path.join(ROOT, p.endsWith("/") ? p + "index.html" : p));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(404); return res.end("not found"); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
}).listen(PORT, () => console.log("listening on " + PORT));
