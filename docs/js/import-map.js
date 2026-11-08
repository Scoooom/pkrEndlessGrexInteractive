// Maps a decoded PokeRogue session (JSON) onto checklist values, using the `import`
// rules in guide.json. Dependency-free; runs in Node (require) and in the browser
// (window.EndlessImport), so it can move client-side if storage moves off the server.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EndlessImport = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function nice(id) {
    return String(id).toLowerCase().split("_").map(function (w) { return w ? w[0].toUpperCase() + w.slice(1) : w; }).join(" ");
  }
  function moveKey(name) {
    return String(name).toUpperCase().replace(/['’]/g, "").replace(/[^A-Z0-9]+/g, "_");
  }

  function mapSession(session, guide, ids) {
    if (!session || !Array.isArray(session.party) || !Array.isArray(session.modifiers)) throw new Error("not a PokeRogue session file");
    var typeId = {};
    Object.keys(ids.types).forEach(function (k) { typeId[ids.types[k]] = Number(k); });
    function fam(speciesId) {
      var n = ids.species[speciesId];
      return n ? ids.family[n] || n : null;
    }

    var members = session.party.map(function (p) {
      var known = {};
      (p.moveset || []).forEach(function (m) { if (m && ids.moves[m.moveId]) known[ids.moves[m.moveId]] = true; });
      (p.usedTMs || []).forEach(function (m) { if (ids.moves[m]) known[ids.moves[m]] = true; });
      return {
        p: p, fam: fam(p.species), ffam: p.fusionSpecies ? fam(p.fusionSpecies) : null, known: known,
        label: nice(ids.species[p.species] || "?") + (p.fusionSpecies ? " + " + nice(ids.species[p.fusionSpecies] || "?") : ""),
      };
    });
    var groups = {}, baseOnly = {};
    (guide.groups || []).forEach(function (g) { groups[g.id] = g.family || []; if (g.base_only) baseOnly[g.family] = true; });
    function inFam(m, fams) { return fams.indexOf(m.fam) >= 0 || (m.ffam && fams.indexOf(m.ffam) >= 0); }
    // a base_only group (Boss Killer base) only counts Pokémon that have it as the base species, so the
    // Runner's wild Dugtrio fusion partner is not mistaken for a Diglett-line Boss Killer
    function membersOf(fams) {
      var strict = baseOnly[fams];
      return members.filter(function (m) { return strict ? fams.indexOf(m.fam) >= 0 : inFam(m, fams); });
    }
    function names(ms) { return ms.map(function (m) { return m.label; }).join(", "); }

    function knows(ms, moves, any) {
      var hits = moves.filter(function (mv) { return ms.some(function (m) { return m.known[mv]; }); });
      return any ? hits.length > 0 : hits.length === moves.length;
    }
    function heldCount(ms, typeIdName, stat) {
      var idSet = {};
      ms.forEach(function (m) { idSet[m.p.id] = true; });
      return session.modifiers.reduce(function (sum, mod) {
        if (mod.typeId !== typeIdName || !mod.args || !idSet[mod.args[0]]) return sum;
        if (stat !== undefined && mod.args[1] !== stat) return sum;
        return sum + (mod.stackCount || 0);
      }, 0);
    }

    var values = {}, reasons = {};
    function put(k, v, why) { values[k] = v; reasons[k] = why; }

    // items
    guide.items.forEach(function (it) {
      var r = it.import || {}, q = it.qty || 1, k = "i:" + it.id;
      var ms = membersOf(r.holders || groups[it.group] || []);
      if (it.max_iv !== undefined) {
        // vitamins cap at the holder's IV for that stat
        var ivm = ms.filter(function (m) { return m.p.ivs; })[0];
        if (ivm) { q = Math.min(q, ivm.p.ivs[it.max_iv]); put("iv:" + it.id, q, ivm.label + " has " + q + " Speed IV"); }
      }
      if (r.held) {
        var n = heldCount(ms, r.held, r.stat);
        put(k, Math.min(q, n), ms.length ? names(ms) + (ms.length > 1 ? " hold " : " holds ") + n : "not in party");
      } else if (r.move) {
        var ok = knows(ms, r.move, r.any);
        put(k, ok ? 1 : 0, ok ? names(ms) + " knows " + r.move.map(nice).join(r.any ? " or " : " and ") : "move not known");
      } else if (r.tera) {
        var t = ms.filter(function (m) { return m.p.teraType === typeId[r.tera]; });
        put(k, t.length ? 1 : 0, t.length ? names(t) + " has " + nice(r.tera) + " tera" : "no " + nice(r.tera) + " tera type");
      } else if (r.global) {
        var g = session.modifiers.some(function (mod) { return mod.typeId === r.global; });
        put(k, g ? 1 : 0, g ? "in your items" : "not in your items");
      }
    });

    // splice steps (after items, since Carbos steps depend on them)
    guide.splicing.steps.forEach(function (s) {
      var r = s.import || {}, k = "p:" + s.n, ms = membersOf(groups[s.group] || []);
      if (s.optional) return;
      if (r.species) {
        // a step that is done once a species is in the party (Shedinja split off Nincada)
        var sp = members.filter(function (m) { return ids.species[m.p.species] === r.species || ids.species[m.p.fusionSpecies] === r.species; });
        put(k, sp.length ? 1 : 0, sp.length ? nice(r.species) + " in party" : "no " + nice(r.species) + " in party");
      } else if (r.move) {
        var ok = knows(ms, r.move, r.any);
        put(k, ok ? 1 : 0, ok ? "knows " + r.move.map(nice).join(r.any ? " or " : " and ") : "move not known");
      } else if (r.item) {
        var it = guide.items.filter(function (x) { return x.id === r.item; })[0];
        var cap = it ? values["iv:" + it.id] || it.qty : 0;
        var ok2 = it && values["i:" + it.id] >= cap;
        put(k, ok2 ? 1 : 0, ok2 ? "Carbos maxed" : "Carbos " + (values["i:" + r.item] || 0) + " / " + (cap || "?"));
      } else if (r.fused) {
        // check the fusion as it is now: the ability it actually has (the fusion side's slot on its
        // current form, or an override), and the partner's base Speed on its current form
        var good = [], why = "not fused yet";
        ms.filter(function (m) { return m.ffam; }).forEach(function (m) {
          var ourFams = groups[s.group] || [];
          var pIsFusion = ourFams.indexOf(m.fam) >= 0;
          var pSpecies = ids.species[pIsFusion ? m.p.fusionSpecies : m.p.species];
          var pForm = ((ids.forms || {})[pSpecies] || [])[(pIsFusion ? m.p.fusionFormIndex : m.p.formIndex) || 0];
          var fForm = ((ids.forms || {})[ids.species[m.p.fusionSpecies]] || [])[m.p.fusionFormIndex || 0];
          var over = m.p.fusionCustomPokemonData && m.p.fusionCustomPokemonData.ability;
          var ability = over != null && over >= 0 ? ids.abilityIds[over] : fForm ? fForm[m.p.fusionAbilityIndex || 0] : null;
          var spd = pForm ? pForm[3] : null;
          var problems = [];
          if (r.with && m.fam !== r.with && m.ffam !== r.with) problems.push("not fused with " + nice(r.with));
          if (r.ability && ability !== r.ability) problems.push("ability is " + (ability ? nice(ability) : "unknown") + ", not " + nice(r.ability));
          if (r.ability_any && r.ability_any.indexOf(ability) < 0) problems.push("ability is " + (ability ? nice(ability) : "unknown") + ", not a lure ability");
          if (r.min_speed && !(spd >= r.min_speed)) problems.push(nice(pSpecies || "?") + " base Speed " + spd + " is under " + r.min_speed);
          if (problems.length) why = m.label + ": " + problems.join("; ");
          else good.push(m.label + (r.ability || r.ability_any ? " (" + nice(ability) + (r.min_speed ? ", base Speed " + spd : "") + ")" : ""));
        });
        put(k, good.length ? 1 : 0, good.length ? "fused: " + good.join(", ") : why);
      }
    });

    // build-phase-only items (Regigigas's Rock Slide / Land's Wrath, Darkest Lariat) are forgotten in the
    // step 17 fusion; once that step is done they count as done
    guide.items.forEach(function (it) {
      var st = it.done_after_step, k = "i:" + it.id;
      if (st && values["p:" + st] && !values[k]) put(k, it.qty || 1, "not needed after splicing step " + st);
    });

    // starters
    guide.starters.forEach(function (s) {
      var r = s.import || {}, k = "s:" + s.id;
      // done once its splice step is done (it is fused away then), or while it is in the party (r.family)
      if (r.step && (values["p:" + r.step] || !r.family)) { put(k, values["p:" + r.step] ? 1 : 0, values["p:" + r.step] ? "inferred from splice step " + r.step : "splice step " + r.step + " not done"); return; }
      var ms = members.filter(function (m) {
        var want = r.hidden ? 2 : r.ability_index;
        if (m.fam === r.family) return want == null || m.p.abilityIndex === want;
        if (m.ffam === r.family) return want == null || m.p.fusionAbilityIndex === want;
        return false;
      });
      var any = members.some(function (m) { return inFam(m, [r.family]); });
      if (ms.length && r.knows) {
        // a starter that must bring a move (Smoochum's Powder Snow); once passed on it may be forgotten
        var passed = r.or_known_by && knows(membersOf([r.or_known_by]), r.knows);
        if (!knows(ms, r.knows) && !passed) { put(k, 0, "in party, but does not know " + r.knows.map(nice).join(", ")); return; }
      }
      put(k, ms.length ? 1 : 0, ms.length ? "in party" + (r.hidden ? " with hidden ability" : r.ability_index != null ? " with the right ability" : "") : any ? "in party, but not with " + (r.hidden ? "its hidden ability" : "the right ability") : "not in party");
    });

    // final builds and move chips
    guide.final_builds.forEach(function (b) {
      // a build's moves can sit on either Pokémon before they are fused (Entrainment on Regigigas for Killer Support)
      var ms = membersOf((b.import && b.import.families) || groups[b.group] || []), all = true;
      b.moves.forEach(function (mv, j) {
        // "A or B" on a build move means either one counts
        var alts = String(mv).split(/ or /).map(moveKey);
        var ok = ms.some(function (m) { return alts.some(function (a) { return m.known[a]; }); });
        if (!ok) all = false;
        put("m:" + b.id + ":" + j, ok ? 1 : 0, ok ? "known" : "not known");
      });
      var step = b.import && b.import.step, fused = step ? values["p:" + step] : 1;
      var missing = (b.needs || []).filter(function (iid) {
        var it = guide.items.filter(function (x) { return x.id === iid; })[0];
        return it && (values["i:" + iid] || 0) < (it.qty || 1);
      }).length;
      var ok = fused && all && !missing;
      put("b:" + b.id, ok ? 1 : 0, ok ? "fused with all four moves and items" : !fused ? "not fused yet" : !all ? "missing moves" : missing + " item" + (missing > 1 ? "s" : "") + " still missing");
    });

    var summary = {
      wave: session.waveIndex,
      biome: session.arena && ids.biomes ? nice(ids.biomes[session.arena.biome] || "") : "",
      party: members.map(function (m) { return m.label + " Lv " + m.p.level; }),
      saved: session.timestamp || null,
    };
    return { values: values, reasons: reasons, summary: summary };
  }

  // which build the save is going for, from who is in the party (base or fusion side). Each variant
  // option in guide.json lists the families that give it away (`detect`). Only a clear signal counts:
  // exactly one option of a choice is present; otherwise null (keep the toggle).
  function detectVariant(session, ids, guide) {
    var fams = {}, baseFams = {};
    (session.party || []).forEach(function (p) {
      [p.species, p.fusionSpecies].forEach(function (id, i) {
        var n = id && ids.species[id];
        if (!n) return;
        fams[ids.family[n] || n] = true;
        if (i === 0) baseFams[ids.family[n] || n] = true;
      });
    });
    var out = {};
    Object.keys((guide && guide.variants) || {}).forEach(function (k) {
      var seen = guide.variants[k].detect_base ? baseFams : fams;   // detect_base: only the base species counts
      var hit = guide.variants[k].options.filter(function (o) { return (o.detect || []).some(function (f) { return seen[f]; }); });
      out[k] = hit.length === 1 ? hit[0].id : null;
    });
    return out;
  }

  return { mapSession: mapSession, detectVariant: detectVariant };
});
