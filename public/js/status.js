(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ms = (v) => (v && v.toMillis ? v.toMillis() : 0);
  const DAY = 864e5;
  const SEV = { critical: ["crit", "Critical"], high: ["warn", "High"], medium: ["info", "Medium"], low: ["low", "Low"] };
  const INC = { investigating: "Investigating", identified: "Identified", monitoring: "Monitoring", resolved: "Resolved" };
  const REG = { ok: ["ok", "Operational"], warn: ["warn", "Degraded"], crit: ["crit", "Outage"] };
  const when = (t) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const chip = (cls, t) => `<span class="chip ${cls}">${esc(t)}</span>`;

  const cfg = window.FIREBASE_CONFIG || {};
  if (!cfg.apiKey || /^YOUR_/.test(cfg.apiKey) || !window.firebase) {
    $("#bannerTitle").textContent = "Status page isn't configured yet";
    return;
  }
  firebase.initializeApp(cfg);
  const db = firebase.firestore();

  db.settings({
    experimentalForceLongPolling: !!navigator.brave,
    experimentalAutoDetectLongPolling: !navigator.brave,
  });
  const state = { regions: [], incidents: [], got: {}, error: false };

  function listen(col) {
    db.collection(col).onSnapshot(
      (snap) => {
        state[col] = snap.docs.map((d) => {
          const x = d.data();
          return { ...x, id: d.id, startedAt: ms(x.startedAt), resolvedAt: ms(x.resolvedAt) };
        });
        state.got[col] = true;
        state.error = false;
        render();
      },
      () => {
        state.error = true;
        render();
      },
    );
  }

  function render() {
    if (state.error) {
      $("#bannerTitle").textContent = "Couldn't load status";
      $("#bannerSub").textContent = "Please refresh in a moment.";
      return;
    }
    if (!state.got.regions || !state.got.incidents) return;
    const open = state.incidents.filter((i) => i.status !== "resolved").sort((a, b) => b.startedAt - a.startedAt);
    const crit = state.regions.filter((r) => r.status === "crit").length;
    const warn = state.regions.filter((r) => r.status === "warn").length;
    const major = crit || open.some((i) => i.severity === "critical");
    const partial = warn || open.length;
    const level = !state.regions.length && !open.length ? "none" : major ? "crit" : partial ? "warn" : "ok";
    const text = {
      none: ["No services published yet", "Check back soon."],
      ok: ["All systems operational", "Everything is running normally."],
      warn: ["Some systems are degraded", "We're aware and working on it."],
      crit: ["Service disruption", "We're working to restore service."],
    }[level];
    $("#banner").className = "banner " + level;
    $("#bannerTitle").textContent = text[0];
    $("#bannerSub").textContent = text[1];

    const cutoff = Date.now() - 30 * DAY;
    const down = state.incidents.filter((i) => i.startedAt >= cutoff).reduce((a, i) => a + (+i.downtime || 0), 0);
    $("#uptime").textContent = Math.max(0, 100 - (down / (30 * 1440)) * 100).toFixed(2) + "%";

    $("#active").innerHTML = open.length
      ? open
          .map(
            (i) => `<article class="item">
              <div class="item-head"><b>${esc(i.title)}</b>${chip(...(SEV[i.severity] || ["off", i.severity]))}</div>
              <div class="meta">${esc(INC[i.status] || i.status)} · started ${when(i.startedAt)}${i.region ? " · " + esc(i.region) : ""}</div>
              ${i.message ? `<p>${esc(i.message)}</p>` : ""}</article>`,
          )
          .join("")
      : `<div class="empty">No active incidents.</div>`;

    const regs = state.regions.slice().sort((a, b) => a.name.localeCompare(b.name));
    $("#regions").innerHTML = regs.length
      ? regs
          .map((r) => {
            const s = REG[r.status] || REG.ok;
            return `<div class="row"><div><b>${esc(r.name)}</b><div class="meta">${esc(r.region || "")}</div></div>
              <div class="row-r"><span class="meta">${+r.latency || 0} ms</span>${chip(s[0], s[1])}</div></div>`;
          })
          .join("")
      : `<div class="empty">No regions published yet.</div>`;

    const past = state.incidents
      .filter((i) => i.status === "resolved" && (i.resolvedAt || i.startedAt) >= cutoff)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 20);
    $("#past").innerHTML = past.length
      ? past
          .map(
            (i) => `<article class="item">
              <div class="item-head"><b>${esc(i.title)}</b>${chip(...(SEV[i.severity] || ["off", i.severity]))}</div>
              <div class="meta">${when(i.startedAt)} → ${when(i.resolvedAt || i.startedAt)}</div>
              ${i.message ? `<p>${esc(i.message)}</p>` : ""}</article>`,
          )
          .join("")
      : `<div class="empty">No incidents in the last 30 days.</div>`;
    $("#updated").textContent = "Last update received " + new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) + ".";
  }

  listen("regions");
  listen("incidents");
})();