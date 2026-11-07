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
    // the passive depends on the form the build uses (Midday Lycanroc has Sturdy, Rockruff has Pickup);
    // the unlock itself is one bit on the starter
    var po = plan.passive_of, psp = po ? info.species[po.species] : sp, pform = po ? po.form || 0 : form;
    var passive = psp.passives[pform] || psp.passives[0];
    if ((plan.passive || plan.need_passive) && passive) {
      r.passive = { name: nice(passive), unlocked: !!(s.passiveAttr & 1) };
      // the build depends on it (Mold Breaker on Killer Support's base, Sturdy on the Boss Killer)
      if (plan.need_passive && !r.passive.unlocked) r.blockers.push("passive " + nice(passive) + " not unlocked");
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
    var plan = s.plan, r = planSpecies(plan.species, plan, Array.isArray(plan.moves) ? plan.moves : [], save, info);
    r.id = s.id;
    if (typeof s.name === "string") r.name = s.name;   // the card's name ("Alolan Diglett", "Oshawott (Hisuian Samurott)")
    return r;
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

  // guide = the full guide (all variants), with $switch values unresolved; only the hard checks
  // (caught, ability, required moves) are used here, to choose the build.
  // Each variant with `plan_pick` gets a recommendation:
  //   "only":  the one option whose starters are all unlocked; with none or several, the current choice stays
  //   "first": the first option (in listed order) whose starters are all unlocked
  function condOk(cond, v) {
    return Object.keys(cond).every(function (k) { return Array.isArray(cond[k]) ? cond[k].indexOf(v[k]) >= 0 : v[k] === cond[k]; });
  }
  // the option is ruled out (guide.variant_excludes) by the picks made so far
  function ruledOut(guide, pick, k, id) {
    return ((guide.variant_excludes) || []).filter(function (r) {
      if (r.change !== k) return false;
      var t = {}; Object.keys(pick).forEach(function (x) { t[x] = pick[x]; }); t[k] = id;
      return condOk(r.when, t);
    })[0] || null;
  }
  function choose(guide, save, info, current) {
    var plans = {};
    guide.starters.forEach(function (s) { if (s.plan) plans[s.id] = planStarter(s, save, info); });
    var pick = {}, status = {};
    Object.keys(guide.variants || {}).forEach(function (k) { pick[k] = current[k]; });
    // keys are decided in the order guide.variants lists them, so an earlier pick can rule out later options
    Object.keys(guide.variants || {}).forEach(function (k) {
      var V = guide.variants[k];
      if (!V.plan_pick) return;
      var st = status[k] = {};
      V.options.forEach(function (o) {
        var mine = guide.starters.filter(function (s) {
          var c = s.variant && s.variant[k];
          return c && (Array.isArray(c) ? c.indexOf(o.id) >= 0 : c === o.id) && plans[s.id];
        });
        var bad = mine.filter(function (s) { return plans[s.id].blockers.length; });
        st[o.id] = { ok: !bad.length, why: bad.map(function (s) { return plans[s.id].name + ": " + plans[s.id].blockers.join(", "); }) };
        var ex = ruledOut(guide, pick, k, o.id);
        if (ex) { st[o.id].ok = false; st[o.id].excluded = true; st[o.id].why = [ex.why]; }
      });
      var ok = V.options.filter(function (o) { return st[o.id].ok; });
      if (V.plan_pick === "only" && ok.length === 1) pick[k] = ok[0].id;
      if (V.plan_pick === "first" && ok.length) pick[k] = ok[0].id;
    });
    // "first" keys: prefer the first unlocked option whose team fits the point limit at this save's
    // current costs (Dracovish at 5 can push a Regigigas team over, Samurott at 1 does not)
    function inBuild(s) {
      return !s.variant || Object.keys(s.variant).every(function (k) {
        var c = s.variant[k]; return Array.isArray(c) ? c.indexOf(pick[k]) >= 0 : c === pick[k];
      });
    }
    function total() {
      return guide.starters.filter(function (s) { return plans[s.id] && inBuild(s); }).reduce(function (n, s) { return n + plans[s.id].cost; }, 0);
    }
    Object.keys(guide.variants || {}).forEach(function (k) {
      var V = guide.variants[k];
      if (V.plan_pick !== "first" || total() <= info.value_limit) return;
      var keep = pick[k];
      var fit = V.options.filter(function (o) {
        if (!status[k][o.id].ok) return false;
        pick[k] = o.id; return total() <= info.value_limit;
      })[0];
      pick[k] = fit ? fit.id : keep;
    });
    return { pick: pick, status: status };
  }
  // plans for the starters of one build (a guide with the variant applied)
  function planBuild(starters, save, info) {
    return starters.filter(function (s) { return s.plan; }).map(function (s) { return planStarter(s, save, info); });
  }

  return { isSystemSave: isSystemSave, readSystem: readSystem, choose: choose, planBuild: planBuild, readiness: readiness };
});
