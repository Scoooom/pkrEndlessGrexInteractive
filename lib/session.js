"use strict";
// Decodes a PokeRogue session export (.prsv). Logged-in exports are CryptoJS
// AES.encrypt(json, saveKey): OpenSSL "Salted__" format, EVP_BytesToKey (MD5), AES-256-CBC.
// Offline/guest saves use btoa(encodeURIComponent(json)). Plain JSON is accepted too.
const crypto = require("node:crypto");

const SAVE_KEY = "x0i2O7WRiANTqPmZ"; // /opt/pokerogue/src/constants.ts saveKey

function aesDecrypt(b64, pass) {
  const raw = Buffer.from(b64, "base64");
  if (raw.subarray(0, 8).toString("latin1") !== "Salted__") throw new Error("not AES data");
  const salt = raw.subarray(8, 16);
  const pw = Buffer.from(pass, "utf8");
  let derived = Buffer.alloc(0), prev = Buffer.alloc(0);
  while (derived.length < 48) {
    prev = crypto.createHash("md5").update(Buffer.concat([prev, pw, salt])).digest();
    derived = Buffer.concat([derived, prev]);
  }
  const d = crypto.createDecipheriv("aes-256-cbc", derived.subarray(0, 32), derived.subarray(32, 48));
  return Buffer.concat([d.update(raw.subarray(16)), d.final()]).toString("utf8");
}

function decodeSave(text) {
  const t = String(text || "").trim();
  if (!t) throw new Error("empty file");
  const attempts = [
    () => JSON.parse(t),
    () => JSON.parse(aesDecrypt(t, SAVE_KEY)),
    () => JSON.parse(decodeURIComponent(Buffer.from(t, "base64").toString("latin1"))),
  ];
  for (const a of attempts) {
    try {
      const s = a();
      if (s && Array.isArray(s.party) && Array.isArray(s.modifiers)) return s;
    } catch (e) { /* try next */ }
  }
  throw new Error("could not read this file as a PokeRogue session save");
}

module.exports = { decodeSave };
