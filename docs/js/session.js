// Decodes a PokeRogue session export (.prsv) in the browser.
// Logged-in exports are CryptoJS AES.encrypt(json, saveKey): OpenSSL "Salted__" format,
// key and IV from EVP_BytesToKey (MD5), AES-256-CBC. Web Crypto does the AES; it has no MD5,
// so a small MD5 is included here. Offline/guest saves are btoa(encodeURIComponent(json)).
// Plain JSON is accepted too. Needs a secure context (https or localhost) for crypto.subtle.
(function (root) {
  "use strict";
  var SAVE_KEY = "x0i2O7WRiANTqPmZ"; // pokerogue src/constants.ts saveKey

  // ---- MD5 (RFC 1321) over a Uint8Array, returns a Uint8Array(16)
  function md5(bytes) {
    var K = [], S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    for (var i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    var n = bytes.length, words = ((n + 8) >>> 6) + 1, M = new Int32Array(words * 16);
    for (i = 0; i < n; i++) M[i >> 2] |= bytes[i] << ((i % 4) * 8);
    M[n >> 2] |= 0x80 << ((n % 4) * 8);
    M[words * 16 - 2] = n * 8;
    var a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    for (var blk = 0; blk < M.length; blk += 16) {
      var A = a0, B = b0, C = c0, D = d0;
      for (i = 0; i < 64; i++) {
        var F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        var s = S[(i >> 4) * 4 + (i % 4)];
        var x = (A + F + K[i] + M[blk + g]) | 0;
        A = D; D = C; C = B;
        B = (B + ((x << s) | (x >>> (32 - s)))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    var out = new Uint8Array(16);
    [a0, b0, c0, d0].forEach(function (w, j) { for (var k = 0; k < 4; k++) out[j * 4 + k] = (w >>> (8 * k)) & 255; });
    return out;
  }
  function concat(a, b) { var o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
  function b64bytes(t) { var s = atob(t), o = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }

  function aesDecrypt(b64, pass) {
    var raw = b64bytes(b64);
    if (String.fromCharCode.apply(null, raw.subarray(0, 8)) !== "Salted__") return Promise.reject(new Error("not AES data"));
    var salt = raw.subarray(8, 16), pw = new TextEncoder().encode(pass);
    var derived = new Uint8Array(0), prev = new Uint8Array(0);
    while (derived.length < 48) { prev = md5(concat(concat(prev, pw), salt)); derived = concat(derived, prev); }
    var subtle = root.crypto && root.crypto.subtle;
    if (!subtle) return Promise.reject(new Error("this page needs https to read encrypted saves"));
    return subtle.importKey("raw", derived.subarray(0, 32), { name: "AES-CBC" }, false, ["decrypt"])
      .then(function (key) { return subtle.decrypt({ name: "AES-CBC", iv: derived.subarray(32, 48) }, key, raw.subarray(16)); })
      .then(function (buf) { return new TextDecoder().decode(buf); });
  }

  // a session save (party + modifiers) or a system save (dexData + starterData, for the starter planner)
  function valid(s) { return s && ((Array.isArray(s.party) && Array.isArray(s.modifiers)) || (s.dexData && s.starterData)) ? s : null; }

  // -> Promise<session>
  function decodeSave(text) {
    var t = String(text || "").trim();
    if (!t) return Promise.reject(new Error("empty file"));
    try { var j = valid(JSON.parse(t)); if (j) return Promise.resolve(j); } catch (e) { /* not plain JSON */ }
    function guest() {
      try { var g = valid(JSON.parse(decodeURIComponent(atob(t)))); if (g) return g; } catch (e) { /* not a guest save */ }
      throw new Error("could not read this file as a PokeRogue save");
    }
    return aesDecrypt(t, SAVE_KEY).then(function (s) { return valid(JSON.parse(s)) || guest(); }, guest);
  }

  root.EndlessSession = { decodeSave: decodeSave, md5: md5 };
})(typeof self !== "undefined" ? self : this);
