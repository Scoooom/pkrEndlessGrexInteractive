// Starter planner: reads a PokeRogue system save (Manage Data > Export Data) and works out, for each
// starter the guide names, whether it is unlocked and what to pick on the starter select screen:
// ability, passive, nature and starting moves (level 1 to 5 moves plus unlocked egg moves).
// Rules follow the game code: DexAttr / AbilityAttr / Passive bits, natureAttr bit (1 << (nature + 1)),
// egg move bit (1 << index), cost minus valueReduction down to 1, Endless limit 15 points.
// Dependency-free; runs in Node (require) and in the browser (window.EndlessStarterPlan).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EndlessStarterPlan = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var NAMES = { LANDS_WRATH: "Land's Wrath", FREEZE_DRY: "Freeze-Dry", BABY_DOLL_EYES: "Baby-Doll Eyes", V_CREATE: "V-create", U_TURN: "U-turn" };
  function nice(id) {
    if (NAMES[id]) return NAMES[id];
    return String(id).toLowerCase().split("_").map(function (w) { return w ? w[0].toUpperCase() + w.slice(1) : w; }).join(" ");
  }
  // exported system saves use short keys ($ca, $a, ...); accept both
  function pick(o, long, short) { return o ? (o[long] !== undefined ? o[long] : o[short]) : undefined; }
  function big(v) { try { return BigInt(v || 0); } catch (e) { return BigInt(0); } }

  function isSystemSave(d) { return !!(d && typeof d === "object" && d.dexData && d.starterData); }

  // keep only what the planner needs, for the species in info (small enough for localStorage)
  function readSystem(sys, info) {
    if (!isSystemSave(sys)) throw new Error("not a PokeRogue system save");
    var out = { saved: sys.timestamp || null, species: {} };
    Object.keys(info.species).forEach(function (id) {
      var num = info.species[id].num, dex = sys.dexData[num], st = sys.starterData[num];
      var caught = big(pick(dex, "caughtAttr", "$ca"));
      out.species[id] = {
        caught: caught > BigInt(0),
        forms: Number(caught >> BigInt(7)) || 0,   // bit n = form n caught (DEFAULT_FORM is 1 << 7)
        abilityAttr: Number(pick(st, "abilityAttr", "$a")) || 0,
        passiveAttr: Number(pick(st, "passiveAttr", "$pa")) || 0,
        natureAttr: Number(pick(dex, "natureAttr", "$na")) || 0,
        eggMoves: Number(pick(st, "eggMoves", "$em")) || 0,
        valueReduction: Number(pick(st, "valueReduction", "$vr")) || 0,
        candy: Number(pick(st, "candyCount", "$x")) || 0,
      };
    });
    return out;
  }

  // plan one species against what the save has; `need` = moves it should start with
  function planSpecies(id, plan, need, save, info) {
    var sp = info.species[id], s = save.species[id] || {}, form = plan.form || 0;
    var cost = sp.cost;
    for (var v = 0; v < (s.valueReduction || 0); v++) if (cost > 1) cost--;
    var r = { species: id, name: nice(id), caught: !!s.caught, cost: cost, baseCost: sp.cost, reduced: s.valueReduction || 0, candy: s.candy || 0, blockers: [], notes: [] };
    if (!s.caught) { r.blockers.push("not caught yet"); return r; }

    if (plan.form != null && !(s.forms & (1 << form))) r.notes.push((plan.form_name || "form " + form) + " form not caught");

    // ability: index 0/1/2 = bits 1/2/4
    var abil = sp.abilities[form] || sp.abilities[0];
    if (plan.ability != null) {
      var have = !!(s.abilityAttr & (1 << plan.ability));
      r.ability = { name: nice(abil[plan.ability]), hidden: plan.ability === 2, unlocked: have };
      if (!have) r.blockers.push((plan.ability === 2 ? "hidden ability " : "ability ") + nice(abil[plan.ability]) + " not unlocked");
    }
    // passive
    var passive = sp.passives[form] || sp.passives[0];
    if (plan.passive && passive) {
      r.passive = { name: nice(passive), unlocked: !!(s.passiveAttr & 1) };
    }
    // nature: first of the wanted ones that is unlocked
    var natNum = {};
    Object.keys(info.natures).forEach(function (n) { natNum[info.natures[n]] = Number(n); });
    if (plan.natures) {
      var got = plan.natures.filter(function (n) { return s.natureAttr & (1 << (natNum[n] + 1)); });
      r.nature = { pick: got.length ? nice(got[0]) : null, wanted: plan.natures.map(nice) };
    }
    // starting moves: level 1 to 5 moves plus unlocked egg moves
    var egg = sp.eggMoves.filter(function (m, i) { return s.eggMoves & (1 << i); });
    var avail = sp.levelMoves.concat(egg.filter(function (m) { return sp.levelMoves.indexOf(m) < 0; }));
    var want = need.filter(function (m) { return avail.indexOf(m) >= 0; });
    var missing = need.filter(function (m) { return avail.indexOf(m) < 0; });
    r.moves = {
      pick: want.map(nice),
      missing: missing.map(function (m) { var i = sp.eggMoves.indexOf(m); return nice(m) + (i >= 0 ? (i === 3 ? " (rare egg move)" : " (egg move)") : ""); }),
      other: avail.filter(function (m) { return want.indexOf(m) < 0; }).map(nice),
      egg: egg.map(nice),
    };
    if (missing.length && plan.need_moves) r.blockers.push(r.moves.missing.join(", ") + " not unlocked");
    return r;
  }

  function planStarter(s, save, info) {
    var plan = s.plan, main = planSpecies(plan.species, plan, plan.moves || [], save, info);
    main.id = s.id;
    if (!main.blockers.length || !plan.alts) return main;
    // an alternative that can do the same job (Dark Void from an egg move), cheapest first
    var alts = plan.alts.map(function (a) {
      var sp = info.species[a];
      var need = (plan.moves || []).filter(function (m) { return sp.levelMoves.indexOf(m) >= 0 || sp.eggMoves.indexOf(m) >= 0; });
      var r = planSpecies(a, { natures: plan.natures, need_moves: plan.need_moves, passive: false }, need, save, info);
      r.id = s.id; r.instead_of = main.name;
      return r;
    }).filter(function (r) { return !r.blockers.length; }).sort(function (a, b) { return a.cost - b.cost; });
    if (alts.length) { alts[0].main = main; return alts[0]; }
    // none of them can do it yet: say any of them would do
    var names = plan.alts.map(nice), need = (plan.moves || []).filter(function (m) {
      return plan.alts.some(function (a) { return info.species[a].eggMoves.indexOf(m) >= 0 || info.species[a].levelMoves.indexOf(m) >= 0; });
    }).map(nice);
    main.alt_text = "or use " + names.slice(0, -1).join(", ") + " or " + names[names.length - 1] + (need.length ? " with " + need.join(", ") + " unlocked" : "");
    return main;
  }

  // Can this save start the build? `starters` = the plans for the build's starters (current variant).
  // Not ready when a starter is missing a hard unlock, or the team costs more than the limit.
  // `need` lists the minimum unlocks: every hard unlock, plus the cheapest cost reductions (by candy)
  // that bring the team under the limit.
  function readiness(starters, info) {
    var need = [];
    starters.forEach(function (p) {
      var what = p.blockers.map(function (b) { return b === "not caught yet" ? "catch or hatch it" : "unlock " + b.replace(/ not unlocked$/, ""); });
      if (what.length) need.push({ name: p.name, what: what.join(", ") + (p.alt_text ? ", " + p.alt_text : "") });
    });
    var total = starters.reduce(function (n, p) { return n + p.cost; }, 0), over = total - info.value_limit;
    if (over > 0) {
      var steps = [];
      starters.forEach(function (p) {
        var cost = p.cost;
        for (var i = p.reduced; i < info.value_reduction_max; i++) {
          if (cost <= 1) break;
          cost--;
          steps.push({ p: p, n: i + 1, candy: info.cost_reduction[p.baseCost - 1][i], newCost: cost });
        }
      });
      // a 2nd reduction always costs more candy than the 1st, so cheapest-first keeps the order valid
      steps.sort(function (a, b) { return a.candy - b.candy; });
      var picked = steps.slice(0, over);
      starters.forEach(function (p) {
        var mine = picked.filter(function (st) { return st.p === p; });
        if (!mine.length) return;
        var candy = mine.reduce(function (n, st) { return n + st.candy; }, 0);
        need.push({ name: p.name, what: (mine.length > 1 ? mine.length + " cost reductions" : "1 cost reduction") + " (" + p.cost + " to " + mine[mine.length - 1].newCost + " points), " + candy + " candy", candy: candy, have: p.candy });
      });
      if (picked.length < over) need.push({ name: "Team", what: "still over the limit with every cost reduction" });
    }
    // one line per Pokémon
    var byName = [], seen = {};
    need.forEach(function (x) {
      if (!seen[x.name]) { seen[x.name] = { name: x.name, what: [] }; byName.push(seen[x.name]); }
      seen[x.name].what.push(x.what);
      if (x.candy) { seen[x.name].candy = x.candy; seen[x.name].have = x.have; }
    });
    need = byName.map(function (x) { return { name: x.name, what: x.what.join("; "), candy: x.candy, have: x.have }; });
    return { ready: !need.length, need: need, total: total, limit: info.value_limit };
  }

  // guide = the full guide (all variants); returns per-starter plans and which carry options work
  function planAll(guide, save, info) {
    var byId = {};
    guide.starters.forEach(function (s) { if (s.plan) byId[s.id] = planStarter(s, save, info); });
    var carry = {};
    ((guide.variants && guide.variants.carry && guide.variants.carry.options) || []).forEach(function (o) {
      var mine = guide.starters.filter(function (s) { return s.variant && s.variant.carry === o.id; });
      var bad = mine.filter(function (s) { return byId[s.id] && byId[s.id].blockers.length; });
      carry[o.id] = { ok: !bad.length, why: bad.map(function (s) { return byId[s.id].name + ": " + byId[s.id].blockers.join(", "); }) };
    });
    var okIds = Object.keys(carry).filter(function (k) { return carry[k].ok; });
    return { starters: byId, carry: carry, carryPick: okIds.length === 1 ? okIds[0] : null, limit: info.value_limit };
  }

  return { isSystemSave: isSystemSave, readSystem: readSystem, planAll: planAll, readiness: readiness };
});
