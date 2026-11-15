(function () {
  "use strict";
  const PG = window.Pulsegrid;
  const { pad, plural, esc } = PG.util;
  const $ = (s) => document.querySelector(s);

  function animateTo(el, to, duration) {
    const decimals = +el.dataset.decimals || 0;
    const suffix = el.dataset.suffix || "";
    const from = el._cur || 0;
    const t0 = performance.now();
    const fmt = (v) =>
      v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;

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
      if (!el) return;
      el.dataset.count = value;
      animateTo(el, value, ms);
    },
    intro() {
      document.querySelectorAll("[data-kpi]").forEach((el, i) =>
        setTimeout(() => animateTo(el, parseFloat(el.dataset.count), 1200), 150 + i * 60),
      );
    },
  };

  function updateKpis(days) {
    const D = PG.derive;
    const rs = regions();
    const up = D.uptimeSeries(days);
    kpi.set("uptime", +(up.reduce((a, b) => a + b, 0) / up.length).toFixed(3));
    kpi.set("incidents", D.openIncidents());
    kpi.set("servers", rs.reduce((a, r) => a + (+r.servers || 0), 0));
    kpi.set("response", rs.length ? Math.round(rs.reduce((a, r) => a + (+r.latency || 0), 0) / rs.length) : 0);
    kpi.set("resolved", D.resolved(days));
    kpi.set("open", D.openTickets());
    const label = kpi.el("resolved") && kpi.el("resolved").nextElementSibling;
    if (label) label.textContent = `Tickets resolved (${days}d)`;
  }

  const STATUS = {
    ok: { color: "#3ed486", label: "Healthy" },
    warn: { color: "#eeab3f", label: "Degraded" },
    crit: { color: "#f2565f", label: "Critical" },
  };
  const RANK = { ok: 1, warn: 2, crit: 3 };
  const regions = () => PG.store.data.regions;
  const autoStatus = (load) => {
    const s = PG.settings.get();
    return load >= s.critical ? "crit" : load >= s.warn ? "warn" : "ok";
  };
  const statusOf = (r) => (STATUS[r.status] ? r.status : autoStatus(+r.load || 0));

  const sort = { key: null, dir: "desc" };
  const view = { env: "all", query: "" };
  const sortVal = {
    name: (r) => r.name.toLowerCase(),
    load: (r) => r.load,
    latency: (r) => r.latency,
    status: (r) => RANK[statusOf(r)],
  };

  function visible() {
    const q = view.query.trim().toLowerCase();
    const list = regions()
      .filter(
        (r) =>
          (view.env === "all" || r.env === view.env) &&
          (!q || `${r.name} ${r.region || ""}`.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    if (sort.key) {
      const f = sortVal[sort.key];
      const s = sort.dir === "asc" ? 1 : -1;
      list.sort((a, b) => (f(a) > f(b) ? 1 : f(a) < f(b) ? -1 : 0) * s);
    }
    return list;
  }

  function paintRow(r) {
    const row = document.querySelector(`.server-row[data-id="${r.id}"]`);
    if (!row) return;
    const k = statusOf(r);
    const s = STATUS[k];
    const fill = row.querySelector(".load-fill");
    fill.style.width = (+r.load || 0) + "%";
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
          <div class="server-row" data-id="${esc(r.id)}">
            <div class="server-name"><span class="dot"></span>${esc(r.name)}</div>
            <div class="load-track"><div class="load-fill"></div></div>
            <div class="server-region"></div>
            <div><span class="status-chip"></span></div>
          </div>`,
          )
          .join("")
      : `<div class="empty">${regions().length ? "No regions match your filters" : 'No regions yet. <button class="link-btn" type="button" data-go="Infrastructure">Add your first region</button>'}</div>`;
    $("#regionsHint").textContent = plural(list.length, "region");
    if (animate) setTimeout(() => list.forEach(paintRow), 80);
    else list.forEach(paintRow);
  }

  function updateHero() {
    const rs = regions();
    const prod = rs.filter((r) => r.env === "prod");
    const basis = prod.length ? prod : rs;
    const crit = basis.filter((r) => statusOf(r) === "crit").length;
    const warn = basis.filter((r) => statusOf(r) === "warn").length;
    const title = !rs.length
      ? "No regions added yet"
      : crit
        ? `Critical load in ${plural(crit, "region")}`
        : warn
          ? `Degraded performance in ${plural(warn, "region")}`
          : "All systems operational";
    $("#heroDot").className = "hero-status-dot" + (crit ? " crit" : warn ? " warn" : "");
    $("#heroTitle").textContent = title;
    $("#heroSub").textContent = rs.length
      ? `${basis.reduce((a, r) => a + (+r.servers || 0), 0).toLocaleString("en-US")} servers across ${plural(basis.length, "region")}`
      : "Add your first region under Infrastructure.";
    const side = $("#sideEnv");
    if (side) side.textContent = rs.length ? `${plural(rs.length, "region")} · ${plural(rs.reduce((a, r) => a + (+r.servers || 0), 0), "server")}` : "No regions yet";
    document.title = `${rs.length ? (crit ? "🔴" : warn ? "🟠" : "🟢") : "⚪"} ${title} · Pulsegrid`;
  }

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

  function exportCsv() {
    const list = visible();
    const rows = [
      ["region_id", "location", "environment", "servers", "load_pct", "latency_ms", "status"],
      ...list.map((r) => [r.name, r.region || "", r.env, r.servers || 0, r.load, r.latency, STATUS[statusOf(r)].label]),
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

  const feedState = { paused: false, query: "", max: 6, local: [] };
  const plain = (html) => html.replace(/<[^>]+>/g, "");
  const sevColor = (k) => (PG.severityMeta.find((m) => m.key === k) || {}).color || "#5b8fef";
  const sevLabel = (k) => (PG.severityMeta.find((m) => m.key === k) || {}).label || k;

  function fmtTime(ts) {
    const d = new Date(ts);
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return d.toDateString() === new Date().toDateString()
      ? `${hm}:${pad(d.getSeconds())}`
      : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${hm}`;
  }

  function events() {
    const { incidents, tickets } = PG.store.data;
    const out = feedState.local.slice();
    incidents.forEach((i) => {
      out.push({ ts: i.startedAt, dot: sevColor(i.severity), text: `Incident <b>${esc(i.title)}</b> opened · ${esc(sevLabel(i.severity))}` });
      if (i.resolvedAt) out.push({ ts: i.resolvedAt, dot: "#3ed486", text: `Incident <b>${esc(i.title)}</b> resolved` });
    });
    tickets.forEach((t) => {
      out.push({ ts: t.openedAt, dot: "#5b8fef", text: `Ticket <b>${esc(t.title)}</b> opened` });
      if (t.resolvedAt) out.push({ ts: t.resolvedAt, dot: "#3ed486", text: `Ticket <b>${esc(t.title)}</b> resolved` });
    });
    return out.filter((e) => e.ts).sort((a, b) => b.ts - a.ts).slice(0, 60);
  }

  function renderFeed(animateFirst) {
    const q = feedState.query.trim().toLowerCase();
    const all = events();
    const list = all.filter((e) => !q || plain(e.text).toLowerCase().includes(q)).slice(0, feedState.max);
    $("#feed").innerHTML = list.length
      ? list
          .map(
            (e, i) => `
          <div class="feed-row"${animateFirst && i === 0 ? "" : ' style="animation:none"'}>
            <div class="feed-time">${fmtTime(e.ts)}</div>
            <span class="feed-dot" style="background:${e.dot}; box-shadow:0 0 6px ${e.dot}"></span>
            <div class="feed-text">${e.text}</div>
          </div>`,
          )
          .join("")
      : `<div class="empty">${all.length ? "No matching activity" : "No activity yet. Incidents and tickets you add will appear here."}</div>`;
  }

  function setPaused(p) {
    feedState.paused = p;
    const h = $("#feedHint");
    h.textContent = p ? "paused · click to resume" : "live";
    h.title = p ? "Resume feed" : "Pause feed";
    h.setAttribute("aria-pressed", String(p));
    if (!p) renderFeed(false);
  }

  const feed = {
    init() {
      renderFeed(false);
      const h = $("#feedHint");
      h.textContent = "live";
      const toggle = () => setPaused(!feedState.paused);
      h.addEventListener("click", toggle);
      h.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      });
    },
    log(dot, text) {
      feedState.local.unshift({ ts: Date.now(), dot, text });
      feedState.local.length = Math.min(feedState.local.length, 20);
      if (!feedState.paused) renderFeed(true);
    },
    refresh() {
      if (!feedState.paused) renderFeed(false);
    },
    setQuery(q) {
      feedState.query = q;
      renderFeed(false);
    },
    recent: (n) => events().slice(0, n).map((e) => ({ time: fmtTime(e.ts), text: e.text })),
    isPaused: () => feedState.paused,
    setPaused,
  };

  function repaint() {
    renderRegions(view.env, view.query, false);
    updateHero();
  }
  const snapshot = () => regions().map((r) => ({ ...r, region: r.region || "", status: STATUS[statusOf(r)].label }));

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (b) PG.ui.navTo(b.dataset.go);
  });

  PG.panels = { kpi, feed, STATUS, autoStatus, renderRegions, updateHero, updateKpis, initSort, exportCsv, repaint, snapshot };
})();