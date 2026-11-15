(function () {
  "use strict";
  const PG = window.Pulsegrid;
  const { kpi, feed } = PG.panels;
  const { pad, esc } = PG.util;
  const ui = PG.ui;
  const $ = (s) => document.querySelector(s);

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

  function applyRange(first, quiet) {
    const { label } = PG.ranges[state.range];
    $("#rangeLabel").textContent = label;
    $("#uptimeTitle").textContent = `Uptime — last ${state.range} days`;
    $("#incidentsHint").textContent = `last ${state.range} days`;
    $("#uptimeHint").textContent = `avg ${PG.charts.line(state.range, !quiet).toFixed(2)}%`;
    PG.charts.donut(state.range);
    const total = PG.charts.bars(state.range, first ? 400 : 60);
    $("#ticketsHint").textContent = `${total.toLocaleString("en-US")} total`;
    PG.panels.updateKpis(state.range);
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

  function renderData() {
    applyRange(false, true);
    PG.panels.renderRegions(state.env, state.query, false);
    PG.panels.updateHero();
    feed.refresh();
  }

  PG.getState = () => ({ range: state.range, env: state.env });
  PG.actions = { setRange, setEnv, refresh: renderData };

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

  const notes = [];
  let unread = 0;
  function paintBadge() {
    const b = $("#notifBadge");
    b.textContent = unread > 9 ? "9+" : unread;
    b.hidden = unread === 0;
  }
  ui.attachMenu(
    $("#notifBtn"),
    () =>
      notes.length
        ? [
            ...notes.map((n, i) => ({ id: i, label: n.label, meta: n.meta, dot: n.dot })),
            { id: "read", label: "Mark all as read" },
          ]
        : [{ id: "none", label: "No notifications yet" }],
    (id) => {
      if (id !== "read") return;
      unread = 0;
      paintBadge();
      ui.toast("All caught up");
    },
  );

  function notify(dot, label, feedText) {
    notes.unshift({ dot, label: esc(label), meta: "just now" });
    notes.length = Math.min(notes.length, 8);
    unread++;
    paintBadge();
    const s = PG.settings.get();
    if (s.feedAlerts && feedText) feed.log(dot, feedText);
    if (s.toasts) ui.toast(label);
    PG.bot.alert(dot, label);
  }
  const sevColor = (k) => (PG.severityMeta.find((m) => m.key === k) || {}).color || "#5b8fef";

  PG.store.on((col, info) => {
    if (info.error) {
      ui.toast(info.error.code === "permission-denied" ? "No permission to read live data" : "Couldn't load live data");
      return;
    }
    if (!info.initial) {
      if (col === "regions")
        info.changes.forEach((c) => {
          if (c.type !== "modified" || !c.from || c.from === c.doc.status) return;
          const name = c.doc.name;
          if (c.doc.status === "crit") notify("#f2565f", `Critical load on ${name}`, `Alert: <b>${esc(name)}</b> load is critical`);
          else if (c.from === "crit") notify("#3ed486", `${name} recovered`, `<b>${esc(name)}</b> recovered from critical load`);
        });
      if (col === "incidents")
        info.changes.forEach((c) => {
          if (c.type === "added" && c.doc.status !== "resolved") notify(sevColor(c.doc.severity), `New incident: ${c.doc.title}`);
          else if (c.type === "modified" && c.from && c.from !== "resolved" && c.doc.status === "resolved")
            notify("#3ed486", `Resolved: ${c.doc.title}`);
        });
    }
    renderData();
  });

  ui.initSearch((q) => {
    state.query = q;
    feed.setQuery(q);
    PG.views.setQuery(q);
    PG.panels.renderRegions(state.env, q, false);
  });
  ui.initNav();

  function paintClock() {
    const d = new Date();
    $("#clock").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    $("#lastSync").textContent = PG.store.ready() ? "Live" : "Connecting…";
  }

  $("#exportBtn").addEventListener("click", () => ui.toast(`Exported ${PG.panels.exportCsv()} regions to CSV`));
  PG.panels.initSort();

  applyRange(true);
  applyEnv(true);
  paintBadge();
  paintClock();
  kpi.intro();
  feed.init();
  PG.panels.updateHero();
  PG.views.init();
  PG.admin.init();
  PG.bot.init();
  ui.openFromHash();
  setInterval(paintClock, 1000);
  PG.settings.onChange(() => PG.panels.repaint());
})();