// Build variants (Mold Breaker base, Normalize partner, Boss Killer base, Dark Void starter).
// Any guide entry with a `variant` field ({mb: "kyogre"}, {partner: ["skitty"]}, ...) only shows
// when the chosen variant matches; entries without one always show. Entries of the form
// {text, variant} inside string lists become plain strings once kept.
// Dependency-free; used by the server (import) and the browser (render).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EndlessVariant = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function defaults(guide) {
    var out = {};
    Object.keys((guide && guide.variants) || {}).forEach(function (k) { out[k] = guide.variants[k].options[0].id; });
    return out;
  }
  // why a combination is not allowed (guide.variant_excludes: [{when, change, why}]), or null
  function excludedBy(guide, v) {
    return ((guide && guide.variant_excludes) || []).filter(function (r) { return when(r.when, v); })[0] || null;
  }
  // would picking option `id` for key `k` (keeping the rest of v) be excluded? -> reason or null
  function excluded(guide, v, k, id) {
    var t = {}; Object.keys(v).forEach(function (x) { t[x] = v[x]; }); t[k] = id;
    var r = excludedBy(guide, t);
    return r && r.change === k ? r.why : null;
  }
  // keep only known option ids, fill the rest with defaults; an excluded mix moves the rule's
  // `change` key to its first allowed option
  function normalize(guide, v) {
    var out = defaults(guide);
    Object.keys(out).forEach(function (k) {
      var ok = guide.variants[k].options.some(function (o) { return o.id === (v && v[k]); });
      if (ok) out[k] = v[k];
    });
    for (var guard = 0, r; (r = excludedBy(guide, out)) && guard < 10; guard++) {
      var free = guide.variants[r.change].options.filter(function (o) { return !excluded(guide, out, r.change, o.id); })[0];
      if (!free) break;
      out[r.change] = free.id;
    }
    return out;
  }
  // a value can be one option id or a list of them
  function when(cond, v) {
    return Object.keys(cond).every(function (k) { return Array.isArray(cond[k]) ? cond[k].indexOf(v[k]) >= 0 : v[k] === cond[k]; });
  }
  function matches(entry, v) {
    if (!entry || typeof entry !== "object" || !entry.variant) return true;
    return when(entry.variant, v);
  }
  // {"$switch": [{when: {...}, value: X}, ..., {value: default}]} picks the first case that matches;
  // a value of null drops the field
  function isSwitch(x) { return x && typeof x === "object" && !Array.isArray(x) && Array.isArray(x.$switch); }
  function pickSwitch(x, v) {
    var c = x.$switch.filter(function (c) { return !c.when || when(c.when, v); })[0];
    return c ? c.value : null;
  }
  function walk(x, v, names) {
    if (isSwitch(x)) return walk(pickSwitch(x, v), v, names);
    // {carry}, {dv}, ... in text become the chosen option's name
    if (typeof x === "string") return x.replace(/\{(\w+)\}/g, function (m, k) { return names[k] || m; });
    if (Array.isArray(x)) {
      var out = [];
      x.forEach(function (e) {
        if (!matches(e, v)) return;
        var w = e && typeof e === "object" && !Array.isArray(e) && e.variant && typeof e.text === "string" && Object.keys(e).length === 2
          ? walk(e.text, v, names) : walk(e, v, names);
        if (w !== null || !isSwitch(e)) out.push(w);
      });
      return out;
    }
    if (x && typeof x === "object") {
      var o = {};
      Object.keys(x).forEach(function (k) {
        if (k === "variants") { o[k] = x[k]; return; }
        var w = walk(x[k], v, names);
        if (w !== null || !isSwitch(x[k])) o[k] = w;
      });
      return o;
    }
    return x;
  }
  function applyVariant(guide, v) {
    var n = normalize(guide, v), names = {};
    Object.keys(n).forEach(function (k) { names[k] = guide.variants[k].options.filter(function (o) { return o.id === n[k]; })[0].name; });
    return walk(guide, n, names);
  }

  return { applyVariant: applyVariant, normalize: normalize, defaults: defaults, excluded: excluded, when: when };
});
