(function () {
  "use strict";
  var CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(id) { return document.getElementById(id); }

  var targets = {};
  var store = window.EndlessStore.createLocalStore("endless-checklist", targets);
  var guide = null, rawGuide = null, spawnData = null;
  // chosen build variant (carry / boss killer); kept apart from progress so import and Reset leave it alone
  var VARIANT_KEY = "endless-variant", variant = {};
  try { variant = JSON.parse(localStorage.getItem(VARIANT_KEY) || "{}") || {}; } catch (e) { variant = {}; }
  function saveVariant() { try { localStorage.setItem(VARIANT_KEY, JSON.stringify(variant)); } catch (e) {} }
  var ivItems = {};            // item id -> item, for items capped by an IV
  var labels = {}, sections = [], spliceSteps = [];
  var groupKeys = {};          // "items:regigigas" -> [keys]
  var expanded = {};           // group id -> show completed rows (per page, not saved)

  function val(k) { return store.get(k); }
  // the target for k; vitamins (Carbos) cap at the holder's IV, stored per run as "iv:<item>"
  function tgt(k) {
    var it = k.slice(0, 2) === "i:" && ivItems[k.slice(2)];
    return it ? val("iv:" + it.id) || targets[k] : targets[k];
  }
  function isDone(k) {
    // an item can be covered by another one (Rock Slide TM is not needed once Land's Wrath is ticked)
    var it = k.slice(0, 2) === "i:" && guide && guide.items.filter(function (x) { return x.id === k.slice(2); })[0];
    if (it && it.done_if && val("i:" + it.done_if) >= 1) return true;
    return val(k) >= tgt(k) && (k.slice(0, 2) !== "b:" || !buildMissing(k.slice(2)).length);
  }
  // a final fusion only counts once every item it needs is complete
  function buildMissing(id) {
    var b = guide && guide.final_builds.filter(function (x) { return x.id === id; })[0];
    if (!b) return [];
    return (b.needs || []).map(function (iid) { return guide.items.filter(function (it) { return it.id === iid; })[0]; })
      .filter(function (it) { return it && val("i:" + it.id) < tgt("i:" + it.id); })
      .map(function (it) { var q = tgt("i:" + it.id), have = val("i:" + it.id); return q > 1 ? (q - have) + " " + it.name : it.name; });
  }

  // ---------- sync status
  var STATUS_TEXT = { synced: "synced", saving: "saving", offline: "offline, will retry", reconnecting: "reconnecting",
    local: "saved in this browser", unsaved: "can't save, storage blocked" };
  store.onStatus(function (s) {
    var el = $("sync");
    el.setAttribute("data-s", s === "reconnecting" || s === "unsaved" ? "offline" : s === "local" ? "synced" : s);
    el.lastChild.textContent = STATUS_TEXT[s] || s;
  });
  store.onChange(function () { update(); });

  // ---------- spawn helpers
  var TIER_LABEL = { COMMON: "common", UNCOMMON: "uncommon", RARE: "rare", SUPER_RARE: "super rare", ULTRA_RARE: "ultra rare",
    BOSS: "boss", BOSS_RARE: "boss rare", BOSS_SUPER_RARE: "boss super rare", BOSS_ULTRA_RARE: "boss ultra rare" };
  // front sprites cut from the PokeRogue assets by tools/sprites.py
  function spr(key, cls) {
    return key ? '<img class="spr ' + (cls || "") + '" src="sprites/' + esc(key) + '.png" alt="" loading="lazy" onerror="this.remove()">' : "";
  }
  function groupSprite(id) { var g = guide.groups.filter(function (x) { return x.id === id; })[0]; return g && g.sprite; }
  // recommended picks for a step (rec_species in guide.json) are highlighted and listed first
  function isRec(x, step) {
    return !!(step && step.rec_species || []).filter(function (r) { return r.key === x.key && (!r.hidden || x.hidden); }).length;
  }
  function chips(list, step) {
    var rec = list.filter(function (x) { return isRec(x, step); });
    return rec.concat(list.filter(function (x) { return !isRec(x, step); })).map(function (x) { return monChip(x, isRec(x, step)); }).join("");
  }
  function monChip(x, rec) {
    var ti = spawnData.tiers.indexOf(x.tier);
    var bits = [TIER_LABEL[x.tier] || x.tier];
    if (rec === true) bits.unshift("recommended");
    if (x.times.indexOf("ALL") < 0) bits.push(x.times.map(function (t) { return t.toLowerCase(); }).join("/"));
    if (x.learner) bits.push("evolve to " + x.learner + (x.evoLevel > 1 ? " (Lv " + x.evoLevel + ")" : ""));
    if (x.detail) bits.push(x.detail);
    return '<span class="mon t' + ti + (ti >= 5 ? " boss" : "") + (rec === true ? " rec" : "") + '">' + spr(x.key, "s-chip") + esc(x.species) + ' <small>' + esc(bits.join(" · ")) + '</small></span>';
  }
  function whereHtml(n, st, label, item) {
    var step = n != null ? spliceSteps.filter(function (q) { return q.n === n; })[0] : item;
    st = st || (spawnData && spawnData.steps[n]);
    if (!st) return "";
    if (!st.biomes.length) return '<div class="flag where-none">No wild Pokémon in any biome pool learns this by level-up.</div>';
    var body = st.biomes.map(function (b) {
      return '<div class="biome"><b>' + esc(b.biome) + '</b><span class="mons">' + chips(b.list, step) + '</span></div>';
    }).join("");
    return '<details class="where"><summary>' + (label || "Where to find") + ': ' + st.biomes.length + ' biome' + (st.biomes.length === 1 ? "" : "s") + '</summary><div class="inner">' + body + '</div></details>';
  }

  // "keep fused" locks its Pokémon, so it waits for every "then unsplice" step on the same Pokémon
  function blockers(p) {
    if (p.result !== "keep") return [];
    var names = [p.base, p.partner];
    return spliceSteps.filter(function (q) {
      return q.n !== p.n && q.result === "unsplice" && names.indexOf(q.base) >= 0 && !isDone("p:" + q.n);
    }).map(function (q) { return q.n; });
  }
  function hitsIn(biome) {
    var out = [];
    function look(st) { return st && st.biomes.filter(function (x) { return x.biome === biome; })[0]; }
    spliceSteps.forEach(function (p) {
      if (p.optional || isDone("p:" + p.n) || blockers(p).length) return;
      var b = look(spawnData.steps[p.n]);
      if (b) out.push({ step: p, list: b.list, row: "p:" + p.n, href: "#splice-" + p.n,
        title: '<span class="pri">' + p.n + '</span>' + spr(groupSprite(p.group), "s-row") + esc(p.base) + ' + ' + esc(p.partner) });
    });
    guide.items.forEach(function (it) {
      if (!it.splice || isDone("i:" + it.id)) return;
      // carry-only moves (Land's Wrath / Rock Slide, Darkest Lariat) stop mattering once the final fusion step is done
      if (it.done_after_step && isDone("p:" + it.done_after_step)) return;
      var b = look(spawnData.items && spawnData.items[it.id]);
      if (b) out.push({ item: it, list: b.list, row: "i:" + it.id, href: "#item-" + it.id,
        title: '<span class="pri">TM</span>' + spr(groupSprite(it.group), "s-row") + esc(it.name.replace(/ TM$/, "")) + (it.holder ? ' for ' + esc(it.holder) : "") +
          (it.rec_species ? ' <span class="tag opt">recommended</span>' : "") });
    });
    return out;
  }


  // ---------- render
  function reg(secId, key, target, label, groupKey) {
    sections.filter(function (s) { return s.id === secId; })[0].keys.push(key);
    targets[key] = target; labels[key] = label;
    if (groupKey) (groupKeys[groupKey] = groupKeys[groupKey] || []).push(key);
  }
  // turn references in the how-to text into links to the matching tab or routine
  function linkify(text) {
    var links = [
      [/Splicing step 17|step 17/g, "#splice-17"], [/Splicing step 23|step 23/g, "#splice-23"],
      [/Standard boss/g, "#playbook"], [/Complicated boss/g, "#playbook"], [/Capturing safely/g, "#playbook"],
      [/In the run/g, "#playbook"], [/Items, Splicing and Final fusions/g, "#start"],
    ];
    var out = esc(text);
    links.forEach(function (l) { out = out.replace(l[0], function (m) { return '<a href="' + l[1] + '">' + m + '</a>'; }); });
    return out;
  }
  function teachText(p) {
    if (!p.teach.length) return p.purpose || (p.result === "keep" ? "Keep fused" : "");
    var counts = {}, order = [];
    p.teach.forEach(function (m) { if (!counts[m]) { counts[m] = 0; order.push(m); } counts[m]++; });
    var parts = order.map(function (m) { return (counts[m] > 1 ? counts[m] + "x " : "") + m; });
    var t = "Learn " + (parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0]);
    if (p.alt) t += /^can /i.test(p.alt) ? ". " + p.alt : p.first ? ". Or learn " + p.alt : " (or " + p.alt + ")";
    return t;
  }
  function groupWrap(section, g, inner, extraClass) {
    var gk = section + ":" + g.id;
    return '<div class="group" data-group="' + gk + '"><div class="g-head">' + spr(g.sprite, "s-group") + '<h3>' + esc(g.name) + '</h3>' +
      (g.note ? '<span class="g-note">' + esc(g.note) + '</span>' : '') + '<span class="mono g-count"></span></div>' +
      '<div class="rows ' + (extraClass || "") + '">' + inner + '</div>' +
      '<button type="button" class="g-more" data-more="' + gk + '" hidden></button></div>';
  }

  function itemRow(it) {
    var k = "i:" + it.id, q = it.qty || 1;
    var group = guide.groups.filter(function (g) { return g.id === it.group; })[0] || {};
    if (it.optional) { targets[k] = q; labels[k] = it.name + (it.holder ? " · " + it.holder : "") + " (optional)"; }
    else reg("items", k, q, it.name + (it.holder ? " · " + it.holder : ""), "items:" + it.group);
    var qtyHtml = '<span class="qty">' + q + 'x</span>';
    if (it.max_iv !== undefined) {
      // vitamins stack up to the holder's IV in that stat; the IV is set per run (or read from an imported save)
      ivItems[it.id] = it; targets["iv:" + it.id] = 31; labels["iv:" + it.id] = (it.holder || "") + " Speed IV";
      var opts = ""; for (var n = 31; n >= 0; n--) opts += '<option value="' + n + '">' + n + '</option>';
      qtyHtml = '<label class="iv">up to Speed IV <select data-iv="' + esc(it.id) + '" aria-label="' + esc(it.holder) + ' Speed IV">' + opts + '</select></label>';
    }
    var who = it.holder && it.holder !== group.name ? '<div class="who">' + esc(it.holder) + '</div>' : '';
    var notes = (it.note ? '<div class="note">' + esc(it.note) + '</div>' : '') + (it.flag ? '<div class="flag">Note: ' + esc(it.flag) + '</div>' : '');
    var h = '<div class="row" id="item-' + esc(it.id) + '" data-row="' + k + '">';
    var where = it.splice && spawnData && spawnData.items ? whereHtml(null, spawnData.items[it.id], "Or splice it from a wild user", it) : "";
    if (q > 1) {
      h += '<div><div class="title"><span>' + esc(it.name) + '</span>' + qtyHtml + '</div>' + who + notes + '</div>' +
        '<div class="stepper"><button type="button" data-step="' + k + '" data-d="-1" aria-label="Remove one ' + esc(it.name) + '">−</button>' +
        '<span class="val" data-val="' + k + '"></span>' +
        '<button type="button" data-step="' + k + '" data-d="1" aria-label="Add one ' + esc(it.name) + '">+</button>' +
        '<button type="button" class="full" data-step="' + k + '" data-d="full" aria-label="Set ' + esc(it.name) + ' to full">max</button></div>';
    } else {
      h += '<label class="chk"><input type="checkbox" data-chk="' + k + '"><span class="box">' + CHECK + '</span><span><span class="title"><span>' + esc(it.name) + '</span>' + (it.optional ? '<span class="tag opt">optional</span>' : '') + '</span>' +
        who.replace('<div class="who">', '<span class="who" style="display:block">').replace("</div>", "</span>") + notes + '</span></label><span></span>';
    }
    return h + where + '</div>';
  }

  function vitText(b) {
    var it = (b.needs || []).map(function (id) { return ivItems[id]; }).filter(Boolean)[0];
    return it ? '<b data-vit="' + esc(it.id) + '">' + tgt("i:" + it.id) + '</b>x Carbos' : esc(b.vitamins);
  }
  function recFlag(text, cls) {
    return text ? '<span class="flag rec' + (cls ? " " + cls : "") + '"><b>Recommended:</b> ' + esc(text) + '</span>' : "";
  }
  function spliceRow(p, sturdyAlt) {
    var k = "p:" + p.n;
    if (p.optional) {
      // recommended but optional: shown, never counted, never blocks
      return '<div class="row opt" id="splice-' + p.n + '"><div class="chk"><span class="pri">' + p.n + '</span><span class="body"><span class="pair">' + spr(groupSprite(p.group), "s-row") +
        '<span>' + esc(p.base) + '</span><span class="plus">+</span><span>' + esc(p.partner) + '</span><span class="tag opt">optional</span></span>' +
        '<span class="desc">' + esc(teachText(p)) + '</span>' + recFlag(p.rec) + '</span></div></div>';
    }
    reg("splicing", k, 1, "Step " + p.n + " · " + p.base + (p.result === "setup" ? " setup" : " + " + p.partner), "splicing:" + p.group);
    if (p.result === "setup") {
      return '<div class="row" id="splice-' + p.n + '" data-row="' + k + '"><label class="chk"><input type="checkbox" data-chk="' + k + '"><span class="box">' + CHECK + '</span>' +
        '<span class="pri">' + p.n + '</span><span class="body"><span class="pair">' + spr(groupSprite(p.group), "s-row") + '<span>' + esc(p.base) + '</span>' +
        '<span class="tag unsplice">setup, no splicer</span></span><span class="desc">' + esc(teachText(p)) + '</span></span></label></div>';
    }
    var flag = p.n === 9 && sturdyAlt.length ? sturdyAlt.join(" and ") + " are good Sturdy options." : "";
    return '<div class="row" id="splice-' + p.n + '" data-row="' + k + '"><label class="chk"><input type="checkbox" data-chk="' + k + '"><span class="box">' + CHECK + '</span>' +
      '<span class="pri">' + p.n + '</span><span class="body"><span class="pair">' + spr(groupSprite(p.group), "s-row") + '<span>' + esc(p.base) + '</span><span class="plus">+</span><span>' + esc(p.partner) + '</span>' +
      '<span class="tag ' + (p.result === "keep" ? "keep" : "unsplice") + '">' + (p.result === "keep" ? "keep fused" : "then unsplice") + '</span></span>' +
      '<span class="desc">' + esc(teachText(p)) + '</span>' + (p.first ? '<span class="note first">Always your first fusion.</span>' : '') + (flag ? '<span class="flag">' + esc(flag) + '</span>' : '') + recFlag(p.rec) +
      '<span class="flag lock" data-lock="' + p.n + '" hidden></span></span></label>' + whereHtml(p.n) + '</div>';
  }

  // every key any variant can use, so the local store keeps progress for the variant not shown
  function allTargets(g) {
    g.starters.forEach(function (s) { targets["s:" + s.id] = 1; });
    g.items.forEach(function (it) { targets["i:" + it.id] = it.qty || 1; if (it.max_iv !== undefined) targets["iv:" + it.id] = 31; });
    g.splicing.steps.forEach(function (p) { if (!p.optional) targets["p:" + p.n] = 1; });
    g.final_builds.forEach(function (b) { targets["b:" + b.id] = 1; b.moves.forEach(function (_, j) { targets["m:" + b.id + ":" + j] = 1; }); });
  }
  function variantPicker(g) {
    if (!g.variants) return "";
    return '<div class="variants">' + Object.keys(g.variants).map(function (k) {
      var v = g.variants[k];
      return '<div class="var-row"><span class="var-label">' + esc(v.label) + '</span><span class="seg" role="group" aria-label="' + esc(v.label) + '">' +
        v.options.map(function (o) {
          var on = variant[k] === o.id;
          return '<button type="button" data-var="' + esc(k) + '" data-opt="' + esc(o.id) + '" aria-pressed="' + on + '">' + esc(o.name) + '</button>';
        }).join("") + '</span></div>';
    }).join("") + '</div>';
  }
  function render() {
    variant = window.EndlessVariant.normalize(rawGuide, variant);
    var g = window.EndlessVariant.applyVariant(rawGuide, variant);
    guide = g;
    Object.keys(targets).forEach(function (k) { delete targets[k]; });
    labels = {}; groupKeys = {}; ivItems = {};
    allTargets(rawGuide);
    $("byline").textContent = g.meta.game + " " + g.meta.mode + " guide by " + g.meta.author;
    $("summary").textContent = g.meta.summary + " Tick things off as you go, or import a save. Progress is saved in this browser.";
    $("source").innerHTML = 'Source: <a href="' + esc(g.meta.source_url) + '" target="_blank" rel="noopener">PokeRogue wiki guide</a>. Thanks to ' + esc(g.meta.author) + ' for the build.';

    sections = [
      { id: "starters", label: "Starters", keys: [] },
      { id: "items", label: "Items", keys: [] },
      { id: "splicing", label: "Splicing", keys: [] },
      { id: "builds", label: "Final fusions", keys: [] }
    ];
    var h = "";

    // "Start here": how to use the guide, what to do next in each stage, and the trade-offs
    h += '<section id="start" data-tab="start"><div class="sec-head"><h2>Start here</h2></div>' +
      '<p class="sec-note">Unlock the starters before the run. Once it starts, Items, Splicing and Final fusions are all worked on at the same time. Items are rewards, so take them whenever they show up. For splicing, do the first fusion (Smeargle onto Pumpkaboo) first, then whatever is rarest or available where you are. Use the I&#39;m in box at the top whenever you reach a new biome to see what you can pick up there. Tick things off as you go, or import your save to fill everything in at once.</p>' +
      '<h3 class="sub-h">Your build</h3>' + variantPicker(g) +
      '<div class="stages" id="stages"></div>' +
      '<h3 class="sub-h">Before you commit</h3><div class="two">' +
      '<div class="card"><h3>What you get</h3><ul>' + g.pros.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + '</ul></div>' +
      '<div class="card"><h3>What it costs</h3><ul>' + g.cons.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + '</ul></div></div></section>';

    // how to play: the phases of a run
    if (g.how_to_play) {
      var hp = g.how_to_play;
      h += '<section id="howto" data-tab="howto"><div class="sec-head"><h2>How to play</h2></div><p class="sec-note">' + esc(hp.intro) + '</p><ol class="phases">' +
        hp.phases.map(function (ph, i) {
          return '<li class="phase-card" id="howto-' + esc(ph.id) + '"><div class="ph-head"><span class="st-num">' + (i + 1) + '</span><h3>' + esc(ph.title) + '</h3>' +
            '<span class="ph-when">' + esc(ph.when) + '</span></div><ul>' + ph.points.map(function (pt) { return "<li>" + linkify(pt) + "</li>"; }).join("") + '</ul></li>';
        }).join("") + '</ol></section>';
    }

    // starters
    h += '<section id="starters" data-tab="starters"><div class="sec-head"><h2>Starters</h2><span class="mono" id="c-starters"></span></div>' +
      '<p class="sec-note">Check each one once it is unlocked with the right ability and nature.</p><div class="grid">';
    g.starters.forEach(function (s) {
      var k = "s:" + s.id; reg("starters", k, 1, "Starter · " + s.name);
      var extra = "";
      if (s.evolves_to) extra += '<dt>Evolves</dt><dd>' + esc(s.evolves_to) + '</dd>';
      if (s.alternatives && s.alternatives.length) extra += '<dt>Alt</dt><dd>' + esc(s.alternatives.join(", ")) + '</dd>';
      h += '<div class="card" data-card="' + k + '"><label class="chk"><input type="checkbox" data-chk="' + k + '"><span class="box">' + CHECK + '</span><h3>' + esc(s.name) + '</h3>' + spr(s.sprite, "s-card") + '</label>' +
        '<p class="role">' + esc(s.role) + '</p><dl><dt>Ability</dt><dd>' + esc(s.ability) + '</dd><dt>Passive</dt><dd>' + esc(s.passive) +
        '</dd><dt>Egg move</dt><dd>' + esc(s.egg_moves.length ? s.egg_moves.join(", ") : "None") + '</dd>' +
        (s.must_know ? '<dt>Must know</dt><dd><b>' + esc(s.must_know.join(", ")) + '</b></dd>' : '') + '<dt>Nature</dt><dd>' + esc(s.nature) + '</dd>' + extra + '</dl></div>';
    });
    h += '</div></section>';

    // items, grouped by the Pokémon that holds them
    h += '<section id="items" data-tab="items"><div class="sec-head"><h2>Items</h2><span class="mono" id="c-items"></span></div>' +
      '<p class="sec-note">Grouped by the Pokémon that holds them. Finished rows fold away inside each group.</p><div class="groups">';
    g.groups.forEach(function (gr) {
      var its = g.items.filter(function (it) { return it.group === gr.id; });
      if (its.length) h += groupWrap("items", gr, its.map(itemRow).join(""));
    });
    h += '</div></section>';

    // splicing, grouped by the base Pokémon
    spliceSteps = g.splicing.steps;
    var sturdyAlt = (g.starters.filter(function (s) { return s.id === "yamask"; })[0] || {}).alternatives || [];
    h += '<section id="splicing" data-tab="splicing"><div class="sec-head"><h2>Splicing</h2><span class="mono" id="c-splicing"></span></div>' +
      '<p class="sec-note">' + esc(g.splicing.note) + '</p>' +
      (spawnData ? '<p class="where-note">"Where to find" lists wild Pokémon that learn the move by level-up or have the ability. Endless spawns are fully evolved, so each one is shown in its final form, read from the PokeRogue source on ' + esc(spawnData.generated) +
        '. Biomes with the most common spawns come first. Dashed chips are boss-wave only. Hidden abilities are rare on wild Pokémon, so use Frisk to check. Mega and G-Max abilities count too, but the fusion then has to hold that item.</p>' : '') +
      '<div class="groups">';
    g.groups.forEach(function (gr) {
      var st = spliceSteps.filter(function (p) { return p.group === gr.id; });
      if (st.length) h += groupWrap("splicing", gr, st.map(function (p) { return spliceRow(p, sturdyAlt); }).join(""), "splice");
    });
    h += '</div></section>';

    // final builds
    h += '<section id="builds" data-tab="builds"><div class="sec-head"><h2>Final fusions</h2><span class="mono" id="c-builds"></span></div>' +
      '<p class="sec-note">' + esc(g.spare_slots) + '</p><div class="grid">';
    g.final_builds.forEach(function (b) {
      var k = "b:" + b.id; reg("builds", k, 1, "Final fusion · " + b.name);
      var fam = (b.import && b.import.families) || null;
      var bSprites = (fam ? g.groups.filter(function (x) { return fam.indexOf(x.family[0]) >= 0; }).map(function (x) { return x.sprite; }) : [groupSprite(b.group)]);
      var items = Object.keys(b.items).map(function (n) { return b.items[n] + " " + n; }).join(", ");
      h += '<div class="card" data-card="' + k + '"><div class="build-head' + (bSprites.length > 1 ? " two" : "") + '"><label class="chk"><input type="checkbox" data-chk="' + k + '"><span class="box">' + CHECK + '</span>' +
        '<span><h3>' + esc(b.name) + '</h3><p class="sub">' + esc(b.made_from) + '</p><span class="flag lock" data-block="' + esc(b.id) + '" hidden></span></span></label>' +
        '<span class="b-sprites">' + bSprites.map(function (k) { return spr(k, "s-card"); }).join("") + '</span></div><div class="chips">' +
        b.moves.map(function (m, j) {
          var ck = "m:" + b.id + ":" + j; targets[ck] = 1; labels[ck] = b.name + " move · " + m;
          return '<button type="button" class="chip" data-chip="' + ck + '" aria-pressed="false">' + esc(m) + '</button>';
        }).join("") +
        '</div><div class="facts"><span>Ability <b>' + esc(b.ability) + '</b>, passive <b>' + esc(b.passive) + '</b></span>' +
        '<span>Nature <b>' + esc(b.nature) + '</b>, ' + (b.vitamins === "none" ? "no vitamins" : vitText(b)) + '</span><span>' + esc(items) + '</span>' +
        (b.notes || []).map(function (n) { return '<span class="b-note">' + esc(n) + '</span>'; }).join("") + '</div>' + recFlag(b.rec, "block") + '</div>';
    });
    if (g.optional_slot) {
      var os = g.optional_slot;
      h += '<div class="card opt-slot"><h3>' + esc(os.title) + '</h3><div class="chips">' + os.moves.map(function (m) { return '<span class="chip static">' + esc(m) + '</span>'; }).join("") +
        '</div><p class="sub">' + esc(os.note) + '</p></div>';
    }
    h += '</div>';
    if (g.move_order) {
      var mo = g.move_order, shown = {};
      g.final_builds.forEach(function (b) { shown[b.id] = b; });
      var rows = g.final_builds.map(function (b) {
        var e = mo.entries.filter(function (x) { return x.build === b.id; })[0] || mo.entries.filter(function (x) { return x.build === "*"; })[0];
        return e ? '<li><b>' + esc(b.name) + '</b>: ' + esc(e.text) + '</li>' : "";
      }).join("");
      h += '<div class="move-order"><h3 class="sub-h">Move order <span class="draft">draft</span></h3><p class="sec-note">' + esc(mo.note) + '</p><ul>' + rows + '</ul></div>';
    }
    h += '</section>';

    // playbook
    h += '<section id="playbook" data-tab="playbook"><div class="sec-head"><h2>In the run</h2></div><p class="sec-note">Reference only, nothing to check off.</p>';
    g.playbook.forEach(function (pb) {
      h += '<details><summary>' + esc(pb.title) + '</summary><div class="inner"><ol>' + pb.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + '</ol></div></details>';
    });
    h += '</section>';

    $("app").innerHTML = h;
    $("nav").innerHTML = '<a href="#start" id="nav-start" data-tab-link="start">Start here</a>' +
      (g.how_to_play ? '<a href="#howto" id="nav-howto" data-tab-link="howto">How to play</a>' : '') +
      sections.map(function (s) { return '<a href="#' + s.id + '" id="nav-' + s.id + '" data-tab-link="' + s.id + '">' + s.label + ' <span class="mono"></span></a>'; }).join("") +
      '<a href="#playbook" id="nav-playbook" data-tab-link="playbook">In the run</a>';
    var first = tabOf(location.hash.slice(1));
    showTab(first || "start", false);
  }

  // ---------- tabs: one section at a time; any #id (a row, a step) opens the tab that holds it
  var activeTab = "start";
  function tabOf(id) {
    var el = id && document.getElementById(id);
    var sec = el && el.closest("[data-tab]");
    return sec ? sec.getAttribute("data-tab") : null;
  }
  function showTab(tab, scroll) {
    activeTab = tab;
    document.querySelectorAll("[data-tab]").forEach(function (sec) { sec.hidden = sec.getAttribute("data-tab") !== tab; });
    document.querySelectorAll("[data-tab-link]").forEach(function (a) {
      var on = a.getAttribute("data-tab-link") === tab;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    if (scroll) scrollToEl(document.getElementById(tab), false);
  }
  function scrollToEl(target, smooth) {
    var sticky = document.querySelector(".sticky");
    var stick = sticky.getBoundingClientRect().height + parseFloat(getComputedStyle(sticky).top || 0);
    var top = window.scrollY + target.getBoundingClientRect().top - stick - 12;
    // only move up to the tab's top if we are below it, so switching tabs never jumps down past the header
    if (target.hasAttribute("data-tab") && window.scrollY < top) return;
    window.scrollTo({ top: top, behavior: smooth ? "smooth" : "auto" });
  }
  window.addEventListener("popstate", function () {
    var id = location.hash.slice(1), tab = tabOf(id) || "start";
    if (tab !== activeTab) showTab(tab, id === tab);
  });
  window.addEventListener("hashchange", function () {
    var id = location.hash.slice(1), tab = tabOf(id);
    if (tab && tab !== activeTab) showTab(tab, id === tab);
  });

  // what to do next in each stage, for the Start here tab
  function nextUp(sec) {
    var open = sec.keys.filter(function (k) { return !isDone(k); });
    if (!open.length) return { text: "All done", href: null };
    if (sec.id === "splicing") {
      var ready = spliceSteps.filter(function (p) { return !isDone("p:" + p.n) && !blockers(p).length; })[0];
      if (ready) return { text: "Step " + ready.n + ": " + ready.base + " + " + ready.partner.replace(/^Wild /, "wild "), href: "#splice-" + ready.n };
    }
    if (sec.id === "items") {
      var it = guide.items.filter(function (x) { return !x.optional && !isDone("i:" + x.id); })[0];
      return { text: open.length + " left, e.g. " + it.name + (it.holder ? " for " + it.holder : ""), href: "#item-" + it.id };
    }
    var k = open[0];
    return { text: (labels[k] || k).replace(/^[^·]*· /, ""), href: "#" + sec.id };
  }
  function updateStages() {
    var el = $("stages");
    if (!el) return;
    el.innerHTML = sections.map(function (sec, i) {
      var d = sec.keys.filter(isDone).length, n = sec.keys.length, nx = nextUp(sec);
      var phase = i === 0 ? '<h3 class="phase">Before the run</h3>' : i === 1 ? '<h3 class="phase">During the run, all at the same time</h3>' : '';
      return phase + '<a class="stage' + (d === n ? " complete" : "") + (i > 0 ? " parallel" : "") + '" href="#' + sec.id + '">' +
        '<span class="st-num">' + (d === n ? "✓" : i === 0 ? 1 : 2) + '</span>' +
        '<span class="st-body"><b>' + esc(sec.label) + '</b><span class="st-blurb">' + esc(STAGE_BLURB[sec.id] || "") + '</span>' +
        '<span class="st-next">' + (d === n ? "Finished" : "Next: " + esc(nx.text)) + '</span></span>' +
        '<span class="st-count mono">' + d + " / " + n + '</span></a>';
    }).join("") +
      '<h3 class="phase">Reference</h3><a class="stage ref" href="#howto"><span class="st-num">?</span><span class="st-body"><b>How to play</b>' +
      '<span class="st-blurb">The phases of a run: the early Regigigas carry, the switch, and the running loop.</span></span></a>' +
      '<a class="stage ref" href="#playbook"><span class="st-num">→</span><span class="st-body"><b>In the run</b>' +
      '<span class="st-blurb">How to fight bosses once the team is built. Reference only.</span></span></a>';
  }
  var STAGE_BLURB = {
    starters: "Unlock the starters with the right abilities and natures.",
    items: "Held items, TMs and vitamins for each Pokémon. Grab them whenever they show up.",
    splicing: "Always start with Smeargle onto Pumpkaboo. After that, fuse in whatever order your biomes allow.",
    builds: "What each finished fusion needs: moves, items and its keep-fused step.",
  };

  // ---------- update
  function update() {
    if (!sections.length) return;
    var total = 0, done = 0;
    sections.forEach(function (s) {
      var d = s.keys.filter(isDone).length; total += s.keys.length; done += d;
      var c = $("c-" + s.id); if (c) c.textContent = d + " / " + s.keys.length;
      var a = $("nav-" + s.id); if (a) { a.querySelector(".mono").textContent = d + "/" + s.keys.length; a.classList.toggle("done", d === s.keys.length); }
    });
    $("overall").textContent = done + " / " + total;
    var pct = total ? Math.round(done / total * 100) : 0;
    $("barfill").style.width = pct + "%"; $("bar").setAttribute("aria-valuenow", pct);
    document.querySelectorAll("[data-chk]").forEach(function (el) {
      var k = el.getAttribute("data-chk"); el.checked = isDone(k);
      var row = el.closest("[data-row], [data-card]"); if (row) row.classList.toggle("is-done", el.checked);
    });
    document.querySelectorAll("[data-val]").forEach(function (el) {
      var k = el.getAttribute("data-val"); el.textContent = val(k) + " / " + tgt(k);
      el.closest("[data-row]").classList.toggle("is-done", isDone(k));
    });
    document.querySelectorAll("[data-iv]").forEach(function (el) { el.value = String(val("iv:" + el.getAttribute("data-iv")) || 31); });
    document.querySelectorAll("[data-vit]").forEach(function (el) { el.textContent = tgt("i:" + el.getAttribute("data-vit")); });
    document.querySelectorAll("[data-chip]").forEach(function (el) { el.setAttribute("aria-pressed", val(el.getAttribute("data-chip")) ? "true" : "false"); });
    updateGroups();
    updateStages();
    updateLocks();
    updateHere();
  }

  function updateGroups() {
    document.querySelectorAll("[data-group]").forEach(function (gEl) {
      var gk = gEl.getAttribute("data-group"), keys = groupKeys[gk] || [];
      var d = keys.filter(isDone).length, open = !!expanded[gk], complete = d === keys.length;
      gEl.classList.toggle("complete", complete);
      gEl.querySelector(".g-count").textContent = (complete ? "✓ " : "") + d + " / " + keys.length;
      var visible = 0;
      gEl.querySelectorAll("[data-row]").forEach(function (r) {
        var hide = r.classList.contains("is-done") && !open;
        r.hidden = hide; if (!hide) visible++;
      });
      visible += gEl.querySelectorAll(".row.opt").length;
      gEl.querySelector(".rows").hidden = visible === 0;
      var more = gEl.querySelector(".g-more");
      more.hidden = d === 0;
      more.textContent = open ? "Hide " + d + " done" : "Show " + d + " done";
      more.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  function updateLocks() {
    document.querySelectorAll("[data-block]").forEach(function (el) {
      var id = el.getAttribute("data-block"), miss = buildMissing(id), box = document.querySelector('[data-chk="b:' + id + '"]');
      el.hidden = !miss.length;
      if (miss.length) el.textContent = "Still needs " + miss.join(", ") + ".";
      if (box) box.disabled = !!miss.length;
    });
    document.querySelectorAll("[data-lock]").forEach(function (el) {
      var p = spliceSteps.filter(function (q) { return String(q.n) === el.getAttribute("data-lock"); })[0];
      var b = p && !isDone("p:" + p.n) ? blockers(p) : [];
      el.hidden = !b.length;
      if (b.length) el.textContent = "Finish step" + (b.length > 1 ? "s " : " ") + b.join(", ") + " first. " + (p.lock_note || "Keeping this fusion locks " + p.base + (p.partner === "Regigigas" ? " and Regigigas" : "") + ".");
    });
  }

  // ---------- biome picker: a plain text box with our own suggestion list (no <datalist>; iOS keyboards ignore it)
  var hereFolded = false;      // biome panel collapsed to its header
  var curBiome = "", sugg = [], act = -1;
  function biomeMatches(q) {
    q = q.trim().toLowerCase();
    var all = spawnData.biomes;
    if (!q) return all.slice();
    var starts = [], words = [], inside = [];
    all.forEach(function (b) {
      var l = b.toLowerCase(), i = l.indexOf(q);
      if (i === 0) starts.push(b);
      else if (i > 0 && l[i - 1] === " ") words.push(b);
      else if (i > 0) inside.push(b);
    });
    return starts.concat(words, inside);
  }
  function exactBiome(q) {
    q = q.trim().toLowerCase();
    return spawnData.biomes.filter(function (b) { return b.toLowerCase() === q; })[0] || "";
  }
  function renderSugg() {
    var inp = $("biome"), list = $("biome-list"), q = inp.value.trim().toLowerCase();
    sugg = biomeMatches(inp.value);
    if (act >= sugg.length) act = sugg.length - 1;
    if (act < 0 && sugg.length && q) act = 0;
    inp.classList.toggle("bad", !!q && !sugg.length);
    list.innerHTML = sugg.length ? sugg.map(function (b, i) {
      var n = hitsIn(b).length, l = b.toLowerCase(), j = q ? l.indexOf(q) : -1;
      var name = j < 0 ? esc(b) : esc(b.slice(0, j)) + "<mark>" + esc(b.slice(j, j + q.length)) + "</mark>" + esc(b.slice(j + q.length));
      return '<li role="option" data-biome="' + esc(b) + '" class="' + (i === act ? "act" : "") + '" aria-selected="' + (i === act) + '"><span>' + name + '</span>' + (n ? '<span class="n">' + n + '</span>' : "") + '</li>';
    }).join("") : '<li class="none">No biome matches</li>';
    list.hidden = false; inp.setAttribute("aria-expanded", "true");
    var el = list.children[act]; if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }
  function closeSugg() {
    $("biome-list").hidden = true; $("biome").setAttribute("aria-expanded", "false"); act = -1;
  }
  function showBiome() {
    var inp = $("biome");
    inp.value = curBiome; inp.classList.remove("bad"); inp.classList.toggle("on", !!curBiome);
    inp.placeholder = "type a biome";
  }
  function chooseBiome(b) {
    curBiome = b; closeSugg(); showBiome(); $("biome").blur(); updateHere();
  }
  function revertBiome() { closeSugg(); showBiome(); $("biome").blur(); }
  function startTyping() {
    var inp = $("biome");
    inp.value = ""; inp.placeholder = curBiome || "type a biome"; inp.classList.remove("on", "bad"); act = -1;
  }

  function updateHere() {
    if (!spawnData || !spliceSteps.length) return;
    var cur = curBiome;
    $("here").hidden = false;
    if (document.activeElement !== $("biome")) showBiome(); else if (!$("biome-list").hidden) renderSugg();
    var panel = $("here-panel");
    document.querySelectorAll(".row.hl").forEach(function (r) { r.classList.remove("hl"); });
    if (!cur) { panel.hidden = true; return; }
    var hits = hitsIn(cur);
    hits.forEach(function (x) { var r = document.querySelector('[data-row="' + x.row + '"]'); if (r) r.classList.add("hl"); });
    panel.hidden = false;
    panel.classList.toggle("folded", hereFolded);
    panel.innerHTML = '<div class="hp-head"><b>' + esc(cur) + '</b><span class="hp-tools">' +
      '<span class="muted">' + (hits.length ? hits.length + (hits.length === 1 ? " thing" : " things") + " you still need" : "nothing needed here") + '</span>' +
      (hits.length ? '<button class="hp-fold" type="button" id="here-fold" aria-expanded="' + !hereFolded + '">' + (hereFolded ? "Show" : "Hide") + '</button>' : '') +
      '<button class="x" type="button" id="here-close" aria-label="Close">×</button></span></div>' +
      '<div class="hp-body">' + (hits.length ? hits.map(function (x) {
        return '<div class="hp-step"><a href="' + x.href + '">' + x.title + '</a>' +
          '<span class="mons">' + chips(x.list, x.step || x.item) + '</span></div>';
      }).join("") : '<p class="hp-none">Nothing you still need spawns here. Biomes with a number in the list have something.</p>') + '</div>';
  }

  // ---------- events
  document.addEventListener("change", function (e) {
    var k = e.target.getAttribute && e.target.getAttribute("data-chk");
    if (k) { var c = {}; c[k] = e.target.checked ? 1 : 0; store.set(c); return; }
    var iv = e.target.getAttribute && e.target.getAttribute("data-iv");
    if (iv) {
      // lowering the IV also trims Carbos already counted above it
      var n = parseInt(e.target.value, 10), ch = {}; ch["iv:" + iv] = n === 31 ? 0 : n;
      if (val("i:" + iv) > n) ch["i:" + iv] = n;
      store.set(ch); return;
    }
    if (e.target.id === "import-file") onImportFile(e.target);
  });
  // biome box: focus clears it for a fresh search; Escape goes back to the current biome; Enter picks
  document.addEventListener("focusin", function (e) { if (e.target.id === "biome") { startTyping(); renderSugg(); } });
  document.addEventListener("focusout", function (e) { if (e.target.id === "biome") { closeSugg(); showBiome(); } });
  document.addEventListener("input", function (e) { if (e.target.id === "biome") { act = -1; renderSugg(); } });
  document.addEventListener("mousedown", function (e) {
    var li = e.target.closest && e.target.closest("#biome-list li[data-biome]");
    if (li) { e.preventDefault(); chooseBiome(li.getAttribute("data-biome")); }
  });
  document.addEventListener("keydown", function (e) {
    var inp = $("biome");
    if (!inp || $("here").hidden) return;
    if (e.target === inp) {
      if (e.key === "Escape") { e.preventDefault(); revertBiome(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (sugg.length) act = (act + (e.key === "ArrowDown" ? 1 : -1) + sugg.length) % sugg.length;
        renderSugg();
      } else if (e.key === "Enter") {
        e.preventDefault();
        var q = inp.value.trim();
        if (!q) { revertBiome(); return; }
        var pick = exactBiome(q) || (act >= 0 && sugg[act]) || "";
        if (pick) chooseBiome(pick); else { inp.classList.remove("bad"); void inp.offsetWidth; inp.classList.add("bad"); }
      }
      return;
    }
    // typing anywhere else on the page jumps into the biome box
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || e.key === " ") return;
    var t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
    if (document.querySelector(".imp-wrap:not([hidden])")) return;
    inp.focus();   // the keystroke then lands in the now-empty box
  });
  document.addEventListener("click", function (e) {
    var t = e.target;
    var step = t.closest("[data-step]");
    if (step) {
      var k = step.getAttribute("data-step"), d = step.getAttribute("data-d"), v = val(k), c = {};
      var t = tgt(k);
      c[k] = d === "full" ? (v >= t ? 0 : t) : Math.max(0, Math.min(t, v + parseInt(d, 10)));
      store.set(c); return;
    }
    var chip = t.closest("[data-chip]");
    if (chip) { var ck = chip.getAttribute("data-chip"), cc = {}; cc[ck] = val(ck) ? 0 : 1; store.set(cc); return; }
    var vb = t.closest("[data-var]");
    if (vb) {
      variant[vb.getAttribute("data-var")] = vb.getAttribute("data-opt"); saveVariant();
      var y = window.scrollY; render(); update(); window.scrollTo(0, y); return;
    }
    var more = t.closest("[data-more]");
    if (more) { var gk = more.getAttribute("data-more"); expanded[gk] = !expanded[gk]; updateGroups(); return; }
    if (t.id === "here-close") { chooseBiome(""); return; }
    if (t.id === "here-fold") { hereFolded = !hereFolded; updateHere(); return; }
    if (t.closest("#import-btn")) { $("import-file").value = ""; $("import-file").click(); return; }
    if (t.id === "import-cancel") { closeImport(); return; }
    if (t.id === "import-apply") { applyImport(); return; }
    // in-page links: offset by the sticky header's real height (it grows when the biome panel is open)
    var a = t.closest('a[href^="#"]');
    if (a) {
      var target = document.getElementById(a.getAttribute("href").slice(1));
      if (!target) return;
      e.preventDefault();
      var tab = tabOf(target.id);
      if (tab && tab !== activeTab) showTab(tab, false);
      if (target.hasAttribute("data-tab")) {
        // a tab link: show the tab from its top; push history so Back returns to the previous tab
        if (location.hash !== "#" + target.id) history.pushState(null, "", "#" + target.id);
        scrollToEl(target, false);
        return;
      }
      var grp = target.closest("[data-group]");
      if (target.hidden && grp) { expanded[grp.getAttribute("data-group")] = true; updateGroups(); }
      scrollToEl(target, true);
      history.replaceState(null, "", "#" + target.id);
      target.classList.remove("flash"); void target.offsetWidth; target.classList.add("flash");
    }
  });

  // ---------- reset (two taps)
  var resetBtn = $("reset"), label = resetBtn.querySelector("span"), armTimer;
  resetBtn.addEventListener("click", function () {
    if (!resetBtn.classList.contains("armed")) {
      resetBtn.classList.add("armed"); label.textContent = "Tap again to confirm";
      armTimer = setTimeout(function () { resetBtn.classList.remove("armed"); label.textContent = "Reset all"; }, 4000);
      return;
    }
    clearTimeout(armTimer); resetBtn.classList.remove("armed"); label.textContent = "Resetting…";
    store.reset().then(function () { label.textContent = "Reset all"; })
      .catch(function () { label.textContent = "Failed, offline?"; setTimeout(function () { label.textContent = "Reset all"; }, 3000); });
  });

  // ---------- import (overwrite the checklist with what a save shows)
  var importValues = null;
  function onImportFile(input) {
    var f = input.files && input.files[0];
    if (!f) return;
    var panel = $("import-panel");
    panel.hidden = false;
    $("import-body").innerHTML = '<p class="muted">Reading ' + esc(f.name) + '…</p>';
    $("import-apply").disabled = true;
    // any file can be picked (see index.html), so check it here before sending
    var bad = f.size > 4 * 1024 * 1024 ? "that file is too large to be a session save"
      : f.size === 0 ? "that file is empty"
      : /\.(png|jpe?g|gif|heic|webp|mp4|mov|pdf|zip)$/i.test(f.name) ? "that looks like a " + f.name.split(".").pop().toUpperCase() + " file, not a save" : "";
    if (bad) {
      $("import-body").innerHTML = '<p class="imp-err">Could not import: ' + esc(bad) + '. Pick the session save (.prsv) exported from PokeRogue.</p>';
      return;
    }
    // everything runs in the browser: decode the save, work out the build, map it onto the checklist
    Promise.all([f.text().then(window.EndlessSession.decodeSave), loadIds()]).then(function (res) {
      return importSession(res[0], res[1]);
    }).then(showPreview).catch(function (e) {
      $("import-body").innerHTML = '<p class="imp-err">Could not import: ' + esc(e.message) + '. Pick the session save (.prsv) exported from PokeRogue.</p>';
    });
  }
  var preImportVariant = null;    // the toggle before a preview switched it, restored on cancel
  function variantName(k, id) {
    var o = rawGuide.variants[k].options.filter(function (x) { return x.id === id; })[0];
    return o ? o.name : id;
  }
  var idsPromise = null;   // PokeRogue id maps, only needed for import, loaded on first use
  function loadIds() {
    idsPromise = idsPromise || fetch("data/pokerogue-ids.json").then(function (r) { if (!r.ok) throw new Error("import data missing"); return r.json(); });
    idsPromise.catch(function () { idsPromise = null; });
    return idsPromise;
  }
  // the save's party decides the build where it is clear; the page's toggle fills the rest.
  // Values are capped at what the guide for that build needs.
  function importSession(session, ids) {
    var found = window.EndlessImport.detectVariant(session, ids);
    var v = { carry: found.carry || variant.carry, killer: found.killer || variant.killer };
    var g = window.EndlessVariant.applyVariant(rawGuide, v);
    var cap = {};
    g.starters.forEach(function (s) { cap["s:" + s.id] = 1; });
    g.items.forEach(function (it) { cap["i:" + it.id] = it.qty || 1; if (it.max_iv !== undefined) cap["iv:" + it.id] = 31; });
    g.splicing.steps.forEach(function (p) { if (!p.optional) cap["p:" + p.n] = 1; });
    g.final_builds.forEach(function (b) { cap["b:" + b.id] = 1; b.moves.forEach(function (_, j) { cap["m:" + b.id + ":" + j] = 1; }); });
    var r = window.EndlessImport.mapSession(session, g, ids);
    Object.keys(r.values).forEach(function (k) {
      var n = Math.round(Number(r.values[k]));
      r.values[k] = k in cap && isFinite(n) ? Math.max(0, Math.min(cap[k], n)) : 0;
    });
    r.variant = v; r.detected = found;
    return r;
  }
  function showPreview(r) {
    importValues = r.values;
    // the save shows which build it is going for: switch the page to it so the preview lists the right rows
    var detectedHtml = "";
    if (r.variant) {
      var found = Object.keys(r.detected || {}).filter(function (k) { return r.detected[k]; });
      var changed = Object.keys(r.variant).some(function (k) { return r.variant[k] && r.variant[k] !== variant[k]; });
      if (changed) {
        if (!preImportVariant) preImportVariant = JSON.parse(JSON.stringify(variant));
        Object.keys(r.variant).forEach(function (k) { if (r.variant[k]) variant[k] = r.variant[k]; });
        render(); update();
      }
      if (found.length) detectedHtml = '<p class="imp-sum">Build detected from the party: <b>' + found.map(function (k) { return esc(rawGuide.variants[k].label + ": " + variantName(k, r.detected[k])); }).join("</b>, <b>") + '</b>' +
        (changed ? '. The page switched to it.' : '.') + '</p>';
    }
    var changes = Object.keys(targets).map(function (k) {
      return { k: k, from: val(k), to: r.values[k] || 0, why: r.reasons[k] || "" };
    }).filter(function (c) { return c.from !== c.to; });
    var lowered = changes.filter(function (c) { return c.to < c.from; }).length;
    var when = r.summary.saved ? new Date(r.summary.saved).toLocaleString() : "";
    var fmt = function (k, v, after) {
      if (k.slice(0, 3) === "iv:") return v || "–";
      var t = after && ivItems[k.slice(2)] ? r.values["iv:" + k.slice(2)] || targets[k] : tgt(k);
      return targets[k] > 1 ? v + " / " + t : v ? "✓" : "–";
    };
    $("import-body").innerHTML =
      '<p class="imp-sum">Wave <b>' + esc(r.summary.wave) + '</b>' + (r.summary.biome ? ' in <b>' + esc(r.summary.biome) + '</b>' : '') + (when ? ' · saved ' + esc(when) : '') + '</p>' +
      '<p class="imp-sum">Party: ' + r.summary.party.map(esc).join(", ") + '</p>' + detectedHtml +
      '<p class="imp-sum">' + (changes.length ? '<b>' + changes.length + '</b> change' + (changes.length === 1 ? "" : "s") + (lowered ? ', <b class="down">' + lowered + ' lowered or unticked</b>' : '') +
        '. Applying replaces the whole checklist with what this save shows.' : 'The checklist already matches this save.') + '</p>' +
      (changes.length ? '<div class="imp-list">' + changes.map(function (c) {
        return '<div class="imp-row' + (c.to < c.from ? " down" : "") + '"><span>' + esc(labels[c.k] || c.k) + '<small>' + esc(c.why) + '</small></span><span class="mono">' + fmt(c.k, c.from) + ' → ' + fmt(c.k, c.to, true) + '</span></div>';
      }).join("") + '</div>' : '');
    $("import-apply").disabled = !changes.length;
  }
  function applyImport() {
    if (!importValues) return;
    var btn = $("import-apply"); btn.disabled = true; btn.textContent = "Applying…";
    preImportVariant = null; saveVariant();
    store.replace(importValues).then(function () { btn.textContent = "Apply"; closeImport(); })
      .catch(function () { btn.disabled = false; btn.textContent = "Apply (retry)"; });
  }
  function closeImport() {
    $("import-panel").hidden = true; importValues = null;
    if (preImportVariant) { variant = preImportVariant; preImportVariant = null; render(); update(); }
  }

  // ---------- boot
  Promise.all([
    fetch("data/guide.json").then(function (r) { return r.json(); }),
    fetch("data/spawns.json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
  ]).then(function (res) {
    spawnData = res[1]; rawGuide = res[0]; render();
    return store.start();
  }).then(update).catch(function () { $("app").innerHTML = '<p class="loading">Could not load the guide data. Reload to try again.</p>'; });
})();
