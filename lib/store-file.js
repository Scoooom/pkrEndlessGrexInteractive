"use strict";
// Persistence for checklist state: { version, values: { key: number } }.
// Swap this module to change where state lives on the server; server.js only calls load/save.
const fs = require("node:fs");
const path = require("node:path");

function createFileStore(dir) {
  const file = path.join(dir, "state.json");
  fs.mkdirSync(dir, { recursive: true });
  return {
    load() {
      try {
        const s = JSON.parse(fs.readFileSync(file, "utf8"));
        return { version: Number(s.version) || 0, values: s && typeof s.values === "object" && s.values ? s.values : {} };
      } catch (e) {
        if (e.code !== "ENOENT") console.error("could not read state, starting empty:", e.message);
        return { version: 0, values: {} };
      }
    },
    save(state) {
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
      fs.renameSync(tmp, file);
    },
  };
}

module.exports = { createFileStore };
