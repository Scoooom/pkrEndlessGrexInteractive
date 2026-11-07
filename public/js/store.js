// Checklist storage. The app talks only to a store object with this interface:
//   store.start()            -> Promise, loads initial values and begins listening for changes
//   store.get(key)           -> number (0 when unset), includes local edits not yet saved
//   store.set({key: value})  -> applies optimistically, saves in the background
//   store.replace({k: v})    -> Promise, replaces every value at once (used by import)
//   store.reset()            -> Promise, clears everything
//   store.onChange(fn)       -> fn() after any value change (local or remote)
//   store.onStatus(fn)       -> fn(status): server store "synced" | "saving" | "offline" | "reconnecting",
//                               local store "local" | "unsaved" (storage blocked, e.g. private mode)
// createLocalStore keeps state in this browser's localStorage (other tabs follow via the storage event).
// createServerStore keeps state on the server and syncs devices over Server-Sent Events (not in use;
// the server no longer exposes the state endpoints, kept for reference if sync comes back).
(function (root) {
  "use strict";

  function createServerStore(base) {
    base = base || "api/";
    var server = {}, version = -1, pending = {};
    var inflight = false, retryMs = 1000, retryTimer = null, live = false;
    var changeFns = [], statusFns = [];

    function emitChange() { changeFns.forEach(function (f) { f(); }); }
    function status() {
      if (retryTimer || (!live && version < 0)) return "offline";
      if (inflight || Object.keys(pending).length) return "saving";
      if (!live) return "reconnecting";
      return "synced";
    }
    function emitStatus() { var s = status(); statusFns.forEach(function (f) { f(s); }); }

    function accept(st) {
      if (!st || typeof st.version !== "number" || st.version < version) return;
      version = st.version; server = st.values || {};
      emitChange();
    }
    function post(path, body) {
      return fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
    }
    function flush() {
      if (inflight || retryTimer) return;
      var keys = Object.keys(pending);
      if (!keys.length) { emitStatus(); return; }
      var batch = {};
      keys.forEach(function (k) { batch[k] = pending[k]; });
      inflight = true; emitStatus();
      post("state", { set: batch }).then(function (st) {
        keys.forEach(function (k) { if (pending[k] === batch[k]) delete pending[k]; });
        inflight = false; retryMs = 1000; accept(st); flush();
      }).catch(function () {
        inflight = false;
        retryTimer = setTimeout(function () { retryTimer = null; flush(); }, retryMs);
        retryMs = Math.min(retryMs * 2, 30000); emitStatus();
      });
    }
    function listen() {
      var es = new EventSource(base + "events");
      es.onopen = function () { live = true; emitStatus(); };
      es.onmessage = function (e) { try { accept(JSON.parse(e.data)); } catch (_) {} emitStatus(); };
      es.onerror = function () { live = false; emitStatus(); };
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", function () { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } flush(); });
    }

    return {
      start: function () {
        return fetch(base + "state").then(function (r) { return r.json(); }).then(function (st) { accept(st); listen(); emitStatus(); });
      },
      get: function (k) { return k in pending ? pending[k] : server[k] || 0; },
      set: function (changes) {
        Object.keys(changes).forEach(function (k) { pending[k] = changes[k]; });
        emitChange(); flush();
      },
      replace: function (values) {
        pending = {};
        return post("state", { replace: values }).then(accept).then(emitStatus);
      },
      reset: function () {
        pending = {};
        return post("reset").then(accept).then(emitStatus);
      },
      onChange: function (f) { changeFns.push(f); },
      onStatus: function (f) { statusFns.push(f); },
    };
  }


  function createLocalStore(key, targets) {
    key = key || "endless-checklist";
    var values = {}, ok = true, changeFns = [], statusFns = [];
    function emitChange() { changeFns.forEach(function (f) { f(); }); }
    function emitStatus() { var s = ok ? "local" : "unsaved"; statusFns.forEach(function (f) { f(s); }); }
    function clean(v) {
      var out = {};
      Object.keys(v || {}).forEach(function (k) {
        var n = Math.round(Number(v[k]));
        if (targets && !(k in targets)) return;
        if (targets) n = Math.min(targets[k], n);
        if (n > 0) out[k] = n;
      });
      return out;
    }
    function read() {
      try { var raw = localStorage.getItem(key); values = raw ? clean(JSON.parse(raw).values) : {}; ok = true; }
      catch (e) { ok = false; }
    }
    function write() {
      try { localStorage.setItem(key, JSON.stringify({ version: 1, values: values })); ok = true; }
      catch (e) { ok = false; }
      emitStatus();
    }
    if (typeof window !== "undefined") {
      window.addEventListener("storage", function (e) { if (e.key === key) { read(); emitChange(); emitStatus(); } });
    }
    return {
      start: function () { read(); emitChange(); emitStatus(); return Promise.resolve(); },
      get: function (k) { return values[k] || 0; },
      set: function (changes) {
        Object.keys(changes).forEach(function (k) { values[k] = changes[k]; });
        values = clean(values); write(); emitChange();
      },
      replace: function (v) { values = clean(v); write(); emitChange(); return Promise.resolve(); },
      reset: function () { values = {}; write(); emitChange(); return Promise.resolve(); },
      onChange: function (f) { changeFns.push(f); },
      onStatus: function (f) { statusFns.push(f); },
    };
  }

  root.EndlessStore = { createServerStore: createServerStore, createLocalStore: createLocalStore };
})(typeof self !== "undefined" ? self : this);
