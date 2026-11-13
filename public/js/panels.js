/* Pulsegrid — KPI cards, region list, hero status, live feed. */
(function () {
  "use strict";
  const PG = window.Pulsegrid;
  const { pad, plural } = PG.util;
  const $ = (s) => document.querySelector(s);

  /* ---------- KPIs ---------- */
  function animateTo(el, to, duration) {
    const decimals = +el.dataset.decimals || 0;
    const suffix = el.dataset.suffix || "";
    const from = el._cur || 0;
    const t0 = performance.now();
    const fmt = (v) =>
      v.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }) + suffix;

    cancelAnimationFrame(el._raf);
    if (PG.reduceMotion || !duration) {
      el._cur = to;
      el.textContent = fmt(to);
      return;
    }
    (function frame(now) {
      const p = Math.min((now - t0) / duration, 1);
      el._cur = from + (to - from) * (1 - Math.pow(1 - p, 3));
      el.textContent = fmt(el._cur);
      if (p < 1) el._raf = requestAnimationFrame(frame);
    })(t0);
  }

  const kpi = {
    el: (name) => $(`[data-kpi="${name}"]`),
    get: (name) => parseFloat(kpi.el(name).dataset.count),
    set(name, value, ms = 700) {
      const el = kpi.el(name);
      el.dataset.count = value;
      animateTo(el, value, ms);
    },
    intro() {
      document.querySelectorAll("[data-kpi]").forEach((el, i) =>
        setTimeout(() => animateTo(el, parseFloat(el.dataset.count), 1200), 150 + i * 60),
      );
    },
  };

  /* ---------- regions ---------- */
  const STATUS = {
    ok: { color: "#3ed486", label: "Healthy" },
    warn: { color: "#eeab3f", label: "Degraded" },
    crit: { color: "#f2565f", label: "Critical" },
  };
  const statusOf = (load) => {
    const s = PG.settings.get();
    return load >= s.critical ? "crit" : load >= s.warn ? "warn" : "ok";
  };
  const regions = PG.regions.map((r) => ({ ...r }));

  const sort = { key: null, dir: "desc" };
  const view = { env: "all", query: "" };
  const sortVal = { name: (r) => r.name, load: (r) => r.load, latency: (r) => r.latency, status: (r) => r.load };

  function visible() {
    const q = view.query.trim().toLowerCase();
    const list = regions.filter(
      (r) =>
        (view.env === "all" || r.env === view.env) &&
        (!q || `${r.name} ${r.region}`.toLowerCase().includes(q)),
    );
    if (sort.key) {
      const f = sortVal[sort.key];
      const s = sort.dir === "asc" ? 1 : -1;
      list.sort((a, b) => (f(a) > f(b) ? 1 : f(a) < f(b) ? -1 : 0) * s);
    }
    return list;
  }

  function paintRow(r) {
    const row = document.querySelector(`.server-row[data-name="${r.name}"]`);
    if (!row) return;
    const k = statusOf(r.load);
    const s = STATUS[k];
    const fill = row.querySelector(".load-fill");
    fill.style.width = r.load + "%";
    fill.style.background = s.color;
    row.querySelector(".load-track").title = `${r.load}% load`;
    const dot = row.querySelector(".dot");
    dot.style.background = s.color;
    dot.style.boxShadow = `0 0 6px ${s.color}`;
    row.querySelector(".server-region").textContent = r.latency + "ms";
    const chip = row.querySelector(".status-chip");
    chip.className = `status-chip ${k}`;
    chip.textContent = s.label;
  }

  function renderRegions(env, query, animate = true) {
    view.env = env;
    view.query = query;
    const list = visible();
    $("#serverList").innerHTML = list.length
      ? list
          .map(
            (r) => `
          <div class="server-row" data-name="${r.name}">
            <div class="server-name"><span class="dot"></span>${r.name}</div>
            <div class="load-track"><div class="load-fill"></div></div>
            <div class="server-region"></div>
            <div><span class="status-chip"></span></div>
          </div>`,
          )
          .join("")
      : `<div class="empty">No regions match your filters</div>`;
    $("#regionsHint").textContent = plural(list.length, "region");
    if (animate) setTimeout(() => list.forEach(paintRow), 80);
    else list.forEach(paintRow);
  }

  function driftRegions() {
    const { clamp, jitter } = PG.util;
    const changes = [];
    regions.forEach((r) => {
      const from = statusOf(r.load);
      r.load = Math.round(clamp(r.load + jitter(4), 8, 99));
      r.latency = Math.round(clamp(r.latency + jitter(3), 15, 220));
      const to = statusOf(r.load);
      if (from !== to) changes.push({ name: r.name, from, to });
      paintRow(r);
    });
    updateHero();
    return changes; // status transitions, used to raise alerts
  }

  /* ---------- hero status (derived from production regions) ---------- */
  function updateHero() {
    const prod = regions.filter((r) => r.env === "prod");
    const crit = prod.filter((r) => statusOf(r.load) === "crit").length;
    const warn = prod.filter((r) => statusOf(r.load) === "warn").length;
    $("#heroDot").className = "hero-status-dot" + (crit ? " crit" : warn ? " warn" : "");
    $("#heroTitle").textContent = crit
      ? `Critical load in ${plural(crit, "region")}`
      : warn
        ? `Degraded performance in ${plural(warn, "region")}`
        : "All systems operational";
    $("#heroSub").textContent =
      `${kpi.get("servers").toLocaleString("en-US")} hosts checked in across ${prod.length} regions`;
    document.title = `${crit ? "🔴" : warn ? "🟠" : "🟢"} ${$("#heroTitle").textContent} · Pulsegrid`;
  }

  /* ---------- sortable columns ---------- */
  function paintSortHeads() {
    document.querySelectorAll(".server-row.head > div").forEach((h) => {
      const on = h.dataset.key === sort.key;
      h.textContent = h.dataset.label + (on ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
    });
  }
  function initSort() {
    const keys = ["name", "load", "latency", "status"];
    document.querySelectorAll(".server-row.head > div").forEach((h, i) => {
      h.dataset.key = keys[i];
      h.dataset.label = h.textContent.trim();
      h.style.cursor = "pointer";
      h.title = "Click to sort";
      PG.ui.activate(h, () => {
        sort.dir = sort.key === keys[i] ? (sort.dir === "asc" ? "desc" : "asc") : keys[i] === "name" ? "asc" : "desc";
        sort.key = keys[i];
        paintSortHeads();
        renderRegions(view.env, view.query, false);
      });
    });
  }

  /* ---------- CSV export of the regions currently shown ---------- */
  function exportCsv() {
    const list = visible();
    const rows = [
      ["region_id", "location", "environment", "load_pct", "latency_ms", "status"],
      ...list.map((r) => [r.name, r.region, r.env, r.load, r.latency, STATUS[statusOf(r.load)].label]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `pulsegrid-regions-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return list.length;
  }

  /* ---------- live activity feed ---------- */
  const feedState = { items: [], paused: false, query: "", max: 6 };
  const plain = (html) => html.replace(/<[^>]+>/g, "");

  function renderFeed(animateFirst) {
    const q = feedState.query.trim().toLowerCase();
    const list = feedState.items
      .filter((it) => !q || plain(it.text).toLowerCase().includes(q))
      .slice(0, feedState.max);
    $("#feed").innerHTML = list.length
      ? list
          .map(
            (it, i) => `
          <div class="feed-row"${animateFirst && i === 0 ? "" : ' style="animation:none"'}>
            <div class="feed-time">${it.time}</div>
            <span class="feed-dot" style="background:${it.dot}; box-shadow:0 0 6px ${it.dot}"></span>
            <div class="feed-text">${it.text}</div>
          </div>`,
          )
          .join("")
      : `<div class="empty">No matching activity</div>`;
  }

  function pushFeed(offsetMs = 0, render = true, tpl) {
    const t = tpl || PG.feedTemplates[Math.floor(Math.random() * PG.feedTemplates.length)];
    const d = new Date(Date.now() - offsetMs);
    feedState.items.unshift({
      ...t,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    });
    feedState.items.length = Math.min(feedState.items.length, 60);
    if (render) renderFeed(true);
  }

  function setPaused(p) {
    feedState.paused = p;
    const h = $("#feedHint");
    h.textContent = p ? "paused · click to resume" : "streaming";
    h.title = p ? "Resume feed" : "Pause feed";
    h.setAttribute("aria-pressed", String(p));
  }

  const feed = {
    init() {
      for (let i = 4; i >= 0; i--) pushFeed(i * 4200, false);
      renderFeed(false);
      const h = $("#feedHint");
      const toggle = () => setPaused(!feedState.paused);
      h.addEventListener("click", toggle);
      h.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      });
      setInterval(() => {
        if (!feedState.paused && !document.hidden) pushFeed();
      }, 4200);
    },
    log(dot, text) {
      pushFeed(0, true, { dot, text });
    },
    setQuery(q) {
      feedState.query = q;
      renderFeed(false);
    },
    recent: (n) => feedState.items.slice(0, n),
    isPaused: () => feedState.paused,
    setPaused,
  };

  function repaint() {
    regions.forEach(paintRow);
    updateHero();
  }
  const snapshot = () => regions.map((r) => ({ ...r, status: STATUS[statusOf(r.load)].label }));

  PG.panels = { kpi, feed, renderRegions, driftRegions, updateHero, initSort, exportCsv, repaint, snapshot };
})(); 