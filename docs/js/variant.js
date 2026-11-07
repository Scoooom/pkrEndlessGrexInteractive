// Build variants (carry: Regigigas or Kyogre/Skitty, boss killer: Yamazone or Shedinja).
// Any guide entry with a `variant` field ({carry: "kyogre"}, {killer: "shedinja"}, ...) only shows
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
  // keep only known option ids, fill the rest with defaults
  function normalize(guide, v) {
    var out = defaults(guide);
    Object.keys(out).forEach(function (k) {
      var ok = guide.variants[k].options.some(function (o) { return o.id === (v && v[k]); });
      if (ok) out[k] = v[k];
    });
    return out;
  }
  function matches(entry, v) {
    if (!entry || typeof entry !== "object" || !entry.variant) return true;
    return Object.keys(entry.variant).every(function (k) { return v[k] === entry.variant[k]; });
  }
  function walk(x, v) {
    if (Array.isArray(x)) {
      return x.filter(function (e) { return matches(e, v); }).map(function (e) {
        if (e && typeof e === "object" && !Array.isArray(e) && e.variant && typeof e.text === "string" && Object.keys(e).length === 2) return e.text;
        return walk(e, v);
      });
    }
    if (x && typeof x === "object") {
      var o = {};
      Object.keys(x).forEach(function (k) { o[k] = k === "variants" ? x[k] : walk(x[k], v); });
      return o;
    }
    return x;
  }
  function applyVariant(guide, v) { return walk(guide, normalize(guide, v)); }

  return { applyVariant: applyVariant, normalize: normalize, defaults: defaults };
});
