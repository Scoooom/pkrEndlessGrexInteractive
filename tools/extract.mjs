// Builds spawns.json: for each splice target in guide.json, which wild Pokémon
// learn the move(s) by LEVEL-UP (or have the ability), and which biomes they spawn in.
// Also writes pokerogue-ids.json (move/species/type id -> name, species -> family root) for save import.
// Usage: node tools/extract.mjs /opt/pokerogue guide.json spawns.json pokerogue-ids.json
import fs from "node:fs";
import path from "node:path";

const [, , SRC = "/opt/pokerogue", GUIDE = "docs/data/guide.json", OUT = "docs/data/spawns.json", IDS_OUT = "docs/data/pokerogue-ids.json"] = process.argv;
const speciesDir = path.join(SRC, "src/data/balance/species");
const biomeDir = path.join(SRC, "src/data/balance/biomes");

const TIERS = ["COMMON", "UNCOMMON", "RARE", "SUPER_RARE", "ULTRA_RARE", "BOSS", "BOSS_RARE", "BOSS_SUPER_RARE", "BOSS_ULTRA_RARE"];
const nice = (id) => id.toLowerCase().split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const moveId = (name) => name.toUpperCase().replace(/['’]/g, "").replace(/[^A-Z0-9]+/g, "_");

// ---------- species: level moves, evolutions, abilities
const species = {}; // ID -> { moves: {MOVE: level}, evos: [{id, level}], abilities: {ID: "hidden"|"normal"} }
for (const f of fs.readdirSync(speciesDir).filter((f) => f.endsWith(".ts"))) {
  const text = fs.readFileSync(path.join(speciesDir, f), "utf8");
  const parts = text.split(/\n\s*generation\w+SpeciesData\[SpeciesId\.([A-Z0-9_]+)\]\s*=\s*\{/);
  for (let i = 1; i < parts.length; i += 2) {
    const id = parts[i], body = parts[i + 1];
    const s = (species[id] = { moves: {}, evos: [], abilities: {} });
    // level-up moves (levelMoves and formLevelMoves); EVOLVE_MOVE / RELEARN_MOVE kept as labels
    for (const m of body.matchAll(/\[\s*(\d+|EVOLVE_MOVE|RELEARN_MOVE)\s*,\s*MoveId\.([A-Z0-9_]+)\s*\]/g)) {
      const lvl = /^\d+$/.test(m[1]) ? Number(m[1]) : m[1] === "EVOLVE_MOVE" ? "evo" : "relearn";
      const prev = s.moves[m[2]];
      if (prev === undefined || (typeof lvl === "number" && (typeof prev !== "number" || lvl < prev))) s.moves[m[2]] = lvl;
    }
    for (const m of body.matchAll(/Species(?:Form)?Evolution\(\{\s*speciesId:\s*SpeciesId\.([A-Z0-9_]+)(?:[^}]*?level:\s*(\d+))?/g)) {
      if (!s.evos.some((e) => e.id === m[1])) s.evos.push({ id: m[1], level: m[2] ? Number(m[2]) : null });
    }
    // forms in save order: [ability1, ability2, hidden, baseSpd]; species without forms have one entry
    const slotOf = (txt) => ["ability1", "ability2", "abilityHidden"].map((k) => (txt.match(new RegExp(k + ":\\s*AbilityId\\.([A-Z0-9_]+)")) || [])[1] || "NONE")
      .concat([Number((txt.match(/baseSpd:\s*(\d+)/) || [])[1] || 0)]);
    const formBlocks = body.split("new PokemonForm({").slice(1).map((fm) => fm.slice(0, fm.indexOf("})")));
    s.forms = formBlocks.length ? formBlocks.map(slotOf) : [slotOf(body.slice(0, body.indexOf("forms:") > 0 ? body.indexOf("forms:") : undefined))];
    // abilities: base species = normal/hidden; alternate forms (Mega, G-Max, ...) carry the item that triggers them
    const addAb = (ab, rank, label) => {
      if (ab === "NONE") return;
      const cur = s.abilities[ab];
      if (!cur || rank < cur.rank) s.abilities[ab] = { rank, label };
    };
    const baseForm = body.slice(0, body.indexOf("}),"));
    for (const m of baseForm.matchAll(/(ability1|ability2|abilityHidden):\s*AbilityId\.([A-Z0-9_]+)/g))
      addAb(m[2], m[1] === "abilityHidden" ? 1 : 0, m[1] === "abilityHidden" ? "hidden ability" : "");
    const items = {};
    for (const m of body.matchAll(/evoFormKey:\s*([^,\n]+),\s*trigger:\s*new SpeciesFormChangeItemTrigger\(FormChangeItem\.([A-Z0-9_]+)/g))
      items[m[1].trim()] ||= nice(m[2]);
    for (const fm of body.split("new PokemonForm({").slice(1)) {
      const f = fm.slice(0, fm.indexOf("})"));
      const key = ((f.match(/formKey:\s*([^,\n]+)/) || [])[1] || "").trim();
      if (key === '""' || key === "''") continue;
      const name = (f.match(/formName:\s*"([^"]*)"/) || [])[1] || key.replace("SpeciesFormKey.", "");
      const item = items[key];
      const slots = {};
      for (const m of f.matchAll(/(ability1|ability2|abilityHidden):\s*AbilityId\.([A-Z0-9_]+)/g)) (slots[m[2]] ||= []).push(m[1]);
      for (const [ab, sl] of Object.entries(slots)) {
        const hiddenOnly = sl.every((x) => x === "abilityHidden");
        const label = name + (/form$/i.test(name) ? "" : " form") + (hiddenOnly ? " (hidden ability)" : "") + (item ? ", needs " + item : "");
        addAb(ab, (item ? 2 : 3) + (hiddenOnly ? 2 : 0), label);
      }
    }
  }
}

// ---------- biomes: species -> [{biome, tier, times}]
const spawns = {};
for (const f of fs.readdirSync(biomeDir).filter((f) => f.endsWith(".ts"))) {
  const text = fs.readFileSync(path.join(biomeDir, f), "utf8");
  const biome = nice((text.match(/biomeId:\s*BiomeId\.([A-Z_]+)/) || [, f.replace(".ts", "").replace(/-/g, "_")])[1]);
  const pool = text.slice(text.indexOf("pokemonPool"), text.indexOf("trainerPool") > 0 ? text.indexOf("trainerPool") : undefined);
  for (const t of pool.split(/\[BiomePoolTier\.([A-Z_]+)\]\s*:\s*\{/).reduce((a, x, i, arr) => (i % 2 ? a.concat([[x, arr[i + 1]]]) : a), [])) {
    const [tier, tbody] = t;
    for (const tm of tbody.matchAll(/\[TimeOfDay\.([A-Z]+)\]\s*:\s*\[([^\]]*)\]/g)) {
      for (const sm of tm[2].matchAll(/SpeciesId\.([A-Z0-9_]+)/g)) {
        const list = (spawns[sm[1]] ||= []);
        let e = list.find((x) => x.biome === biome && x.tier === tier);
        if (!e) list.push((e = { biome, tier, times: [] }));
        if (!e.times.includes(tm[1])) e.times.push(tm[1]);
      }
    }
  }
}

// evolution chain from a species (itself + all descendants), with min level to reach
function chain(id, viaLevel = 0, seen = new Set()) {
  if (seen.has(id) || !species[id]) return [];
  seen.add(id);
  const out = [{ id, reach: viaLevel }];
  for (const e of species[id].evos) out.push(...chain(e.id, e.level == null ? viaLevel : Math.max(viaLevel, e.level), seen));
  return out;
}

// ---------- targets from guide.json
const guide = JSON.parse(fs.readFileSync(GUIDE, "utf8"));
function targetFor(step) {
  const p = step.partner;
  if (/^Wild .*with a lure ability/.test(p)) return { kind: "ability", any: (step.import.ability_any || []).map((a) => [a]) };
  if (/^Wild .*with (Sturdy|No Guard)/.test(p)) return { kind: "ability", any: [[moveId(p.match(/with ([A-Za-z ]+?)(?: \(|$)/)[1])]] };
  const m = p.match(/^Wild (.+?) users?$/);
  if (!m) return null;
  // "A and B" = both on the same Pokémon, "A or B" = either
  if (/ and /.test(m[1])) return { kind: "move", any: [m[1].split(/ and /).map(moveId)] };
  return { kind: "move", any: m[1].split(/ or /).map((x) => [moveId(x)]) };
}

const allBiomes = new Set(Object.values(spawns).flat().map((e) => e.biome));
const result = { biomes: [...allBiomes].sort(), generated: new Date().toISOString().slice(0, 10), source: SRC, tiers: TIERS, steps: {} };
function findBiomes(t) {
  const finds = [];
  for (const [poolId, entries] of Object.entries(spawns)) {
    // in Endless every wild Pokémon is fully evolved (never Mega/G-Max), so only the final
    // evolutions of each pool species matter, judged by their own level-up moves and abilities
    for (const c of chain(poolId).filter((c) => !species[c.id].evos.some((e) => species[e.id]))) {
      if (t.only && !t.only.includes(c.id)) continue;
      const sp = species[c.id];
      for (const need of t.any) {
        let ok, detail;
        if (t.kind === "move") {
          ok = need.every((mv) => sp.moves[mv] !== undefined);
          detail = ok ? need.map((mv) => nice(mv) + " " + (typeof sp.moves[mv] === "number" ? "Lv " + sp.moves[mv] : sp.moves[mv] === "evo" ? "on evolution" : "relearn")).join(", ") : "";
        } else {
          const a = sp.abilities[need[0]];
          ok = a !== undefined;
          detail = ok ? a.label : "";
        }
        if (!ok) continue;
        finds.push({ key: c.id, spawn: nice(c.id), learner: null, evoLevel: null, detail, hidden: /hidden|form/.test(detail), entries });
        break;
      }
    }
  }
  // group by biome
  const byBiome = {};
  for (const fnd of finds) for (const e of fnd.entries) {
    const list = (byBiome[e.biome] ||= []);
    const dup = list.find((x) => x.species === fnd.spawn && x.tier === e.tier);
    if (dup) { e.times.forEach((t) => dup.times.includes(t) || dup.times.push(t)); if (dup.times.includes("ALL")) dup.times = ["ALL"]; continue; }
    list.push({ key: fnd.key, species: fnd.spawn, learner: fnd.learner, evoLevel: fnd.evoLevel, detail: fnd.detail, hidden: fnd.hidden, tier: e.tier, times: e.times.slice() });
  }
  const best = (list) => Math.min(...list.map((x) => TIERS.indexOf(x.tier) + (x.hidden ? 0.5 : 0)));
  const biomes = Object.entries(byBiome)
    .map(([biome, list]) => ({ biome, list: list.sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || a.species.localeCompare(b.species)) }))
    .sort((a, b) => best(a.list) - best(b.list) || b.list.length - a.list.length || a.biome.localeCompare(b.biome));
  return { kind: t.kind, biomes };
}
for (const step of guide.splicing.steps) {
  const t = targetFor(step);
  if (t && step.only) t.only = step.only; // restrict to named species lines (step 15's fast No Guard picks)
  if (t) result.steps[step.n] = findBiomes(t);
}
// TM items that can also be picked up by splicing a wild Pokémon that knows the move
result.items = {};
for (const it of guide.items) if (it.splice) result.items[it.id] = findBiomes({ kind: "move", any: it.splice.map((m) => [m]) });
fs.writeFileSync(OUT, JSON.stringify(result));

// ---------- id maps for save import
function parseEnum(file) {
  const t = fs.readFileSync(path.join(SRC, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const decl = t.search(/export (?:enum \w+|const \w+ = )\{/);
  const start = t.indexOf("{", decl);
  const body = t.slice(start + 1, t.indexOf("}", start));
  const out = {};
  let n = -1;
  for (const part of body.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^([A-Z0-9_]+)\s*(?:[=:]\s*(-?\d+))?$/);
    if (!m) throw new Error("cannot parse enum entry in " + file + ": " + p);
    n = m[2] !== undefined ? Number(m[2]) : n + 1;
    out[n] = m[1];
  }
  return out;
}
const parent = {};
for (const [id, s] of Object.entries(species)) for (const e of s.evos) if (!parent[e.id]) parent[e.id] = id;
const family = {};
for (const id of Object.keys(species)) { let r = id, guard = 0; while (parent[r] && guard++ < 10) r = parent[r]; family[id] = r; }
fs.writeFileSync(IDS_OUT, JSON.stringify({
  generated: result.generated,
  moves: parseEnum("src/enums/move-id.ts"),
  species: parseEnum("src/enums/species-id.ts"),
  types: parseEnum("src/enums/pokemon-type.ts"),
  biomes: parseEnum("src/enums/biome-id.ts"),
  family,
  abilityIds: parseEnum("src/enums/ability-id.ts"),
  // per species, forms in save order: [ability1, ability2, hidden, baseSpd], to read a fusion's live ability
  forms: Object.fromEntries(Object.entries(species).map(([id, sp]) => [id, sp.forms])),
}));
for (const [n, s] of Object.entries({ ...result.steps, ...result.items })) console.log("step", n, s.kind, s.biomes.length, "biomes", s.biomes.slice(0, 3).map((b) => b.biome + ":" + b.list.map((x) => x.species + "/" + x.tier).join("|")).join("  "));
