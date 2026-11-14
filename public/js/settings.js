/* Pulsegrid — user settings, saved in this browser (localStorage). */
(function () {
  "use strict";
  const PG = window.Pulsegrid;
  const KEY = "pulsegrid:settings";
  const defaults = {
    name: "Admin",
    warn: 80, // region load % that counts as "Degraded"
    critical: 92, // region load % that counts as "Critical"
    live: true, // simulated live updates on/off
    interval: 6, // seconds between live updates
    toasts: true, // pop-up alerts
    feedAlerts: true, // write alerts into the activity feed
  };
  const subs = [];

  function sanitize(o) {
    const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
    const s = { ...defaults, ...o };
    s.name = String(s.name || defaults.name).slice(0, 40);
    s.warn = num(s.warn, 50, 95, defaults.warn);
    s.critical = num(s.critical, 60, 99, defaults.critical);
    if (s.critical <= s.warn) s.critical = s.warn + 1;
    s.interval = [3, 6, 12, 30].includes(+s.interval) ? +s.interval : defaults.interval;
    ["live", "toasts", "feedAlerts"].forEach((k) => (s[k] = !!s[k]));
    return s;
  }

  let state = { ...defaults };
  try {
    state = sanitize(JSON.parse(localStorage.getItem(KEY)) || {});
  } catch (_) {}

  PG.settings = {
    defaults,
    get: () => state,
    set(patch) {
      state = sanitize({ ...state, ...patch });
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch (_) {}
      subs.forEach((f) => f(state));
    },
    reset() {
      PG.settings.set(defaults);
    },
    onChange: (f) => subs.push(f),
  };
})();