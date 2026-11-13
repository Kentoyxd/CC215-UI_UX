/* Pulsegrid — app entry point: state + wiring. */
(function () {
  "use strict";
  const PG = window.Pulsegrid;
  const { kpi, feed } = PG.panels;
  const { pad, clamp, jitter } = PG.util;
  const ui = PG.ui;
  const $ = (s) => document.querySelector(s);

  /* ---------- state (range + environment persist between visits) ---------- */
  const PREFS_KEY = "pulsegrid:prefs";
  const state = { range: 30, env: "all", query: "" };
  try {
    Object.assign(state, JSON.parse(localStorage.getItem(PREFS_KEY)) || {});
  } catch (_) {}
  if (!PG.ranges[state.range]) state.range = 30;
  if (!PG.environments[state.env]) state.env = "all";
  const savePrefs = () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ range: state.range, env: state.env }));
    } catch (_) {}
  };

  /* ---------- render ---------- */
  function applyRange(first) {
    const { label, factor } = PG.ranges[state.range];
    $("#rangeLabel").textContent = label;
    $("#uptimeTitle").textContent = `Uptime — last ${state.range} days`;
    $("#incidentsHint").textContent = `last ${state.range} days`;
    $("#uptimeHint").textContent = `avg ${PG.charts.line(state.range).toFixed(2)}%`;
    PG.charts.donut(factor);
    const total = PG.charts.bars(factor, first ? 400 : 60);
    $("#ticketsHint").textContent = `${total.toLocaleString("en-US")} total`;
    if (!first) kpi.set("resolved", total);
  }

  function applyEnv(first) {
    $("#envLabel").textContent = PG.environments[state.env];
    PG.panels.renderRegions(state.env, state.query, true);
    if (!first) PG.panels.updateHero();
  }

  function setRange(n) {
    state.range = PG.ranges[+n] ? +n : 30;
    savePrefs();
    applyRange(false);
  }
  function setEnv(k) {
    state.env = PG.environments[k] ? k : "all";
    savePrefs();
    applyEnv(false);
  }
  // Used by the Pulse assistant (js/bot.js)
  PG.getState = () => ({ range: state.range, env: state.env });
  PG.actions = { setRange, setEnv, refresh: () => liveTick() };

  /* ---------- menus ---------- */
  ui.attachMenu(
    $("#rangeChip"),
    () =>
      Object.entries(PG.ranges).map(([k, v]) => ({
        id: k,
        label: `Last ${v.label}`,
        selected: +k === state.range,
      })),
    (id) => setRange(id),
  );

  ui.attachMenu(
    $("#envChip"),
    () =>
      Object.entries(PG.environments).map(([k, v]) => ({
        id: k,
        label: v,
        selected: k === state.env,
      })),
    (id) => setEnv(id),
  );

  const notes = PG.notifications.slice();
  let unread = notes.length;
  function paintBadge() {
    const b = $("#notifBadge");
    b.textContent = unread > 9 ? "9+" : unread;
    b.hidden = unread === 0;
  }
  ui.attachMenu(
    $("#notifBtn"),
    () => [
      ...notes.map((n, i) => ({ id: i, label: n.label, meta: n.meta, dot: n.dot })),
      { id: "read", label: "Mark all as read" },
    ],
    (id) => {
      if (id !== "read") return;
      unread = 0;
      paintBadge();
      ui.toast("All caught up");
    },
  );

  /* ---------- alerts: a region going critical (or recovering) ---------- */
  function notify(dot, label, feedText) {
    notes.unshift({ dot, label, meta: "just now" });
    notes.length = Math.min(notes.length, 8);
    unread++;
    paintBadge();
    const s = PG.settings.get();
    if (s.feedAlerts) feed.log(dot, feedText);
    if (s.toasts) ui.toast(label);
    PG.bot.alert(dot, label);
  }
  function handleChanges(changes) {
    changes.forEach((c) => {
      if (c.to === "crit")
        notify("#f2565f", `Critical load on ${c.name}`, `Alert: <b>${c.name}</b> load is critical`);
      else if (c.from === "crit")
        notify("#3ed486", `${c.name} recovered`, `<b>${c.name}</b> recovered from critical load`);
    });
  }

  /* ---------- search filters the region list and activity feed ---------- */
  ui.initSearch((q) => {
    state.query = q;
    feed.setQuery(q);
    PG.views.setQuery(q);
    PG.panels.renderRegions(state.env, q, false);
  });
  ui.initNav();

  /* ---------- clock + "last synced" ---------- */
  let lastSync = Date.now();
  function paintClock() {
    const d = new Date();
    $("#clock").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const s = Math.floor((Date.now() - lastSync) / 1000);
    $("#lastSync").textContent = s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
  }

  /* ---------- simulated live data (swap for a Firestore listener later) ---------- */
  function liveTick() {
    if (document.hidden) return;
    handleChanges(PG.panels.driftRegions());
    kpi.set("response", Math.round(clamp(kpi.get("response") + jitter(6), 90, 220)));
    kpi.set("bandwidth", +clamp(kpi.get("bandwidth") + jitter(1.5), 30, 95).toFixed(1));
    lastSync = Date.now();
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) liveTick();
  });

  /* ---------- click "Last synced" to refresh; export + sort ---------- */
  const sync = $("#lastSync");
  sync.title = "Refresh now";
  sync.style.cursor = "pointer";
  ui.activate(sync, () => {
    liveTick();
    ui.toast("Data refreshed");
  });
  $("#exportBtn").addEventListener("click", () =>
    ui.toast(`Exported ${PG.panels.exportCsv()} regions to CSV`),
  );
  PG.panels.initSort();

  /* ---------- boot ---------- */
  applyRange(true);
  applyEnv(true);
  paintBadge();
  paintClock();
  kpi.intro();
  feed.init();
  PG.panels.updateHero();
  PG.views.init();
  PG.bot.init();
  ui.openFromHash();
  setInterval(paintClock, 1000);
  let timer;
  function schedule() {
    clearInterval(timer);
    const s = PG.settings.get();
    if (s.live) timer = setInterval(liveTick, s.interval * 1000);
  }
  PG.settings.onChange(() => {
    schedule();
    PG.panels.repaint();
  });
  schedule();
})();