(function () {
  "use strict";
  const PG = window.Pulsegrid;
  const ui = PG.ui;
  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const store = {
    get(k, d) {
      try {
        const v = JSON.parse(localStorage.getItem(k));
        return v == null ? d : v;
      } catch (_) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (_) {}
    },
  };
  const toCsv = (rows) => rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const initials = (n) => (n.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase();
  const pct = (v, t) => (t ? ((v / t) * 100).toFixed(1) + "%" : "0%");
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const stamp = () => new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  let query = "";

  const REPORTS = {
    uptime: {
      label: "Uptime summary",
      build(days) {
        const s = PG.derive.uptimeSeries(days);
        const now = Date.now();
        return {
          columns: ["Date", "Uptime %", "SLA (99.9%)"],
          rows: s.map((v, i) => [iso(now - (s.length - 1 - i) * 864e5), v.toFixed(2), v >= 99.9 ? "Met" : "Missed"]),
          summary: [
            ["Average", (sum(s) / s.length).toFixed(3) + "%"],
            ["Lowest day", Math.min(...s).toFixed(2) + "%"],
            ["Days below SLA", s.filter((v) => v < 99.9).length],
          ],
        };
      },
    },
    incidents: {
      label: "Incident summary",
      build(days) {
        const d = PG.derive.severity(days).map((x) => ({ l: x.label, v: x.value }));
        const t = sum(d.map((x) => x.v));
        return {
          columns: ["Severity", "Incidents", "Share"],
          rows: d.map((x) => [x.l, x.v, pct(x.v, t)]),
          summary: [["Total", t], ["Critical + High", d[0].v + d[1].v]],
        };
      },
    },
    tickets: {
      label: "Ticket summary",
      build(days) {
        const d = PG.derive.tickets(days).map((x) => ({ l: x.label, v: x.value }));
        const t = sum(d.map((x) => x.v));
        const top = d.reduce((a, b) => (b.v > a.v ? b : a));
        return {
          columns: ["Category", "Tickets", "Share"],
          rows: d.map((x) => [x.l, x.v, pct(x.v, t)]),
          summary: [["Total", t], ["Top category", top.l]],
        };
      },
    },
    infra: {
      label: "Infrastructure health (live)",
      build() {
        const r = PG.panels.snapshot();
        return {
          columns: ["Region", "Location", "Env", "Load %", "Latency ms", "Status"],
          rows: r.map((x) => [x.name, x.region, x.env, x.load, x.latency, x.status]),
          summary: [
            ["Regions", r.length],
            ["Average load", r.length ? Math.round(sum(r.map((x) => x.load)) / r.length) + "%" : "0%"],
            ["Not healthy", r.filter((x) => x.status !== "Healthy").length],
          ],
        };
      },
    },
  };
  const SCHEDULES = [
    ["weekly", "Weekly uptime digest", "Every Monday, 08:00"],
    ["monthly", "Monthly ticket summary", "1st of each month"],
    ["daily", "Daily incident roll-up", "Every day, 07:00"],
  ];
  const fileName = (m) => `pulsegrid-${m.type}-${m.type === "infra" ? "snapshot" : m.days + "d"}-${iso(Date.now())}.csv`;
  const periodText = (m) => (m.type === "infra" ? "live snapshot" : `last ${m.days} days`);

  function showReport(meta) {
    const rep = REPORTS[meta.type].build(meta.days);
    $("#repOut").innerHTML = `
      <div class="hint" style="margin-bottom:10px">${REPORTS[meta.type].label} · ${periodText(meta)} · generated ${stamp()}</div>
      <div class="chips">${rep.summary.map(([k, v]) => `<div class="chip">${k}<b>${esc(v)}</b></div>`).join("")}</div>
      <div class="table-scroll"><table class="table">
        <thead><tr>${rep.columns.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
        <tbody>${rep.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>
      <div class="form-row no-print" style="margin:14px 0 0">
        <button class="btn" id="repDl" type="button">Download CSV</button>
        <button class="btn ghost" id="repPrint" type="button">Print / Save as PDF</button>
      </div>`;
    $("#repDl").onclick = () => download(fileName(meta), toCsv([rep.columns, ...rep.rows]));
    $("#repPrint").onclick = () => window.print();
    return rep;
  }

  function initReports() {
    let history = store.get("pulsegrid:reports", []);
    let sched = store.get("pulsegrid:schedules", {});
    const v = $("#view-reports");
    v.innerHTML = `
      <div class="view-head"><h1>Reports</h1></div>
      <div class="grid-2">
        <div class="panel">
          <div class="section-head"><h2>Report builder</h2><span class="hint">CSV or print to PDF</span></div>
          <div class="form-row no-print">
            <label class="field">REPORT<select id="repType">${Object.entries(REPORTS).map(([k, r]) => `<option value="${k}">${r.label}</option>`).join("")}</select></label>
            <label class="field">PERIOD<select id="repDays">${Object.entries(PG.ranges).map(([k, r]) => `<option value="${k}"${k === "30" ? " selected" : ""}>Last ${r.label}</option>`).join("")}</select></label>
            <button class="btn" id="repGen" type="button">Generate</button>
          </div>
          <div id="repOut"><div class="empty">Choose a report and press Generate.</div></div>
        </div>
        <div>
          <div class="panel no-print" style="margin-bottom:14px">
            <div class="section-head"><h2>Scheduled reports</h2></div>
            ${SCHEDULES.map(([k, l, w]) => `<div class="row-between"><div>${l}<small>${w}</small></div><label class="switch"><input type="checkbox" data-k="${k}" aria-label="${l}"${sched[k] ? " checked" : ""}><span></span></label></div>`).join("")}
            <p class="note">Schedules are saved in this browser. Emailing them needs a backend (for example a Cloud Function).</p>
          </div>
          <div class="panel no-print">
            <div class="section-head"><h2>Recent reports</h2></div>
            <div id="repHist"></div>
          </div>
        </div>
      </div>`;

    const renderHistory = () => {
      $("#repHist").innerHTML = history.length
        ? history.map((h, i) => `<div class="row-between"><div>${REPORTS[h.type].label}<small>${periodText(h)} · ${h.at}</small></div><button class="btn ghost sm" data-i="${i}" type="button">Download</button></div>`).join("")
        : `<div class="empty">No reports yet</div>`;
    };
    renderHistory();

    $("#repType").addEventListener("change", (e) => ($("#repDays").disabled = e.target.value === "infra"));
    $("#repGen").addEventListener("click", () => {
      const meta = { type: $("#repType").value, days: +$("#repDays").value };
      showReport(meta);
      history = [{ ...meta, at: stamp() }, ...history].slice(0, 6);
      store.set("pulsegrid:reports", history);
      renderHistory();
      ui.toast("Report generated");
    });
    $("#repHist").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-i]");
      if (!b) return;
      const meta = history[+b.dataset.i];
      const rep = REPORTS[meta.type].build(meta.days);
      download(fileName(meta), toCsv([rep.columns, ...rep.rows]));
    });
    v.addEventListener("change", (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      sched[k] = e.target.checked;
      store.set("pulsegrid:schedules", sched);
      ui.toast(`${SCHEDULES.find((s) => s[0] === k)[1]} ${e.target.checked ? "scheduled" : "turned off"}`);
    });
  }

  const ROLES = ["SRE", "Network Engineer", "Security Analyst", "Sysadmin", "DevOps", "Helpdesk"];
  const CHIP = { online: ["ok", "Online"], away: ["warn", "Away"], offline: ["off", "Offline"] };
  const NEXT = { online: "away", away: "offline", offline: "online" };
  const members = () => PG.store.data.team.slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const openFor = (m) =>
    PG.store.data.tickets.filter((t) => t.status !== "resolved" && (t.assignee || "").trim().toLowerCase() === (m.name || "").trim().toLowerCase()).length;
  const teamFail = (err) => ui.toast(err && err.code === "permission-denied" ? "No permission. Publish the latest Firestore rules." : "Couldn't save the team change");

  function renderTeam() {
    if (!$("#teamList")) return;
    const team = members();
    const q = query.trim().toLowerCase();
    const list = team.filter((m) => !q || `${m.name} ${m.role}`.toLowerCase().includes(q));
    const oncall = team.find((m) => m.oncall);
    $("#teamStats").innerHTML = [
      ["Members", team.length],
      ["Online", team.filter((m) => m.status === "online").length],
      ["Open tickets", sum(team.map(openFor))],
      ["On call now", oncall ? esc(oncall.name) : "—"],
    ]
      .map(([l, v]) => `<div class="kpi-card"><div class="kpi-value"${typeof v === "string" ? ' style="font-size:18px;line-height:26px"' : ""}>${v}</div><div class="kpi-label">${l}</div></div>`)
      .join("");
    $("#teamHint").textContent = `${list.length} shown`;
    $("#teamList").innerHTML = list.length
      ? list.map((m) => {
          const [c, l] = CHIP[m.status] || CHIP.offline;
          return `<div class="team-row" data-id="${esc(m.id)}">
            <div class="person"><div class="avatar">${esc(initials(m.name || ""))}</div>${esc(m.name)}</div>
            <div>${esc(m.role)}</div>
            <div><button class="status-chip ${c}" data-act="status" type="button" title="Click to change status">${l}</button></div>
            <div>${openFor(m)}</div>
            <div class="team-actions">
              <button class="btn sm${m.oncall ? "" : " ghost"}" data-act="oncall" type="button">${m.oncall ? "On call ✓" : "Set on-call"}</button>
              <button class="btn ghost sm danger" data-act="remove" type="button" aria-label="Remove ${esc(m.name)}">✕</button>
            </div></div>`;
        }).join("")
      : `<div class="empty">${team.length ? "No team members match" : "No team members yet. Add one above."}</div>`;
  }

  function importOldTeam() {
    const old = store.get("pulsegrid:team", []);
    if (!old.length || PG.store.data.team.length) return;
    Promise.all(
      old.map((m) =>
        PG.store.set("team", String(m.id), {
          name: String(m.name || "").slice(0, 40),
          role: m.role || ROLES[0],
          status: CHIP[m.status] ? m.status : "online",
          oncall: !!m.oncall,
        }),
      ),
    ).then(
      () => {
        try {
          localStorage.removeItem("pulsegrid:team");
        } catch (_) {}
        ui.toast("Moved your team to the shared roster");
      },
      teamFail,
    );
  }

  function initTeam() {
    $("#view-team").innerHTML = `
      <div class="view-head"><h1>Team</h1></div>
      <div class="team-stats" id="teamStats"></div>
      <div class="panel">
        <div class="section-head"><h2>Team members</h2><span class="hint" id="teamHint"></span></div>
        <div class="team-row head"><div>MEMBER</div><div>ROLE</div><div>STATUS</div><div>TICKETS</div><div></div></div>
        <div id="teamList"></div>
        <div class="form-row no-print" style="margin:16px 0 0">
          <label class="field">NAME<input id="tmName" maxlength="40" placeholder="e.g. J. Santos" /></label>
          <label class="field">ROLE<select id="tmRole">${ROLES.map((r) => `<option>${r}</option>`).join("")}</select></label>
          <button class="btn" id="tmAdd" type="button">Add member</button>
        </div>
      </div>`;
    $("#teamList").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-act]");
      const row = e.target.closest(".team-row");
      if (!b || !row) return;
      const m = members().find((x) => x.id === row.dataset.id);
      if (!m) return;
      if (b.dataset.act === "status") {
        PG.store.update("team", m.id, { status: NEXT[m.status] || "online" }).catch(teamFail);
      } else if (b.dataset.act === "oncall") {
        const was = !!m.oncall;
        Promise.all(
          members()
            .filter((x) => x.oncall || x.id === m.id)
            .map((x) => PG.store.update("team", x.id, { oncall: x.id === m.id ? !was : false })),
        ).then(() => ui.toast(was ? `${m.name} is off call` : `${m.name} is now on call`), teamFail);
      } else if (b.dataset.act === "remove") {
        if (!confirm(`Remove ${m.name} from the team?`)) return;
        PG.store.remove("team", m.id).catch(teamFail);
      }
    });
    const add = () => {
      const name = $("#tmName").value.trim().slice(0, 40);
      if (!name) return ui.toast("Enter a name first");
      PG.store.add("team", { name, role: $("#tmRole").value, status: "online", oncall: false }).then(
        () => {
          $("#tmName").value = "";
          ui.toast(`${name} added`);
        },
        teamFail,
      );
    };
    $("#tmAdd").addEventListener("click", add);
    $("#tmName").addEventListener("keydown", (e) => e.key === "Enter" && add());
    renderTeam();
  }

  function initSettings() {
    const S = PG.settings;
    const sw = (id, label) => `<label class="switch"><input type="checkbox" id="${id}" aria-label="${label}"><span></span></label>`;
    const v = $("#view-settings");
    v.innerHTML = `
      <div class="view-head"><h1>Settings</h1></div>
      <div class="grid-2">
        <div>
          <div class="panel" style="margin-bottom:14px">
            <div class="section-head"><h2>Profile</h2></div>
            <label class="field">DISPLAY NAME<input id="stName" maxlength="40" /></label>
          </div>
          <div class="panel">
            <div class="section-head"><h2>Alert thresholds</h2><span class="hint">region load</span></div>
            <div class="row-between"><div>Degraded at<small>Load at or above this shows "Degraded"</small></div><div class="slider"><input type="range" id="stWarn" min="50" max="95" aria-label="Degraded threshold"><output id="stWarnV"></output>%</div></div>
            <div class="row-between"><div>Critical at<small>Load at or above this raises an alert</small></div><div class="slider"><input type="range" id="stCrit" min="60" max="99" aria-label="Critical threshold"><output id="stCritV"></output>%</div></div>
          </div>
        </div>
        <div>
          <div class="panel" style="margin-bottom:14px">
            <div class="section-head"><h2>Live data &amp; alerts</h2></div>
            <div class="row-between"><div>Pop-up alerts<small>Toast when a region turns critical</small></div>${sw("stToast", "Pop-up alerts")}</div>
            <div class="row-between"><div>Alerts in activity feed</div>${sw("stFeed", "Alerts in activity feed")}</div>
          </div>
          <div class="panel">
            <div class="section-head"><h2>Data</h2></div>
            <div class="form-row" style="margin:0">
              <button class="btn ghost" id="stReset" type="button">Reset settings</button>
              <button class="btn ghost danger" id="stClear" type="button">Clear all saved data</button>
            </div>
            <p class="note">Clearing removes your settings, reports and schedules stored in this browser. The shared team roster is not affected.</p>
          </div>
        </div>
      </div>`;

    const sync = () => {
      const s = S.get();
      $("#stName").value = s.name;
      $("#stWarn").value = s.warn;
      $("#stWarnV").textContent = s.warn;
      $("#stCrit").value = s.critical;
      $("#stCritV").textContent = s.critical;
      $("#stToast").checked = s.toasts;
      $("#stFeed").checked = s.feedAlerts;
      $("#avatar").textContent = initials(s.name);
      $("#avatar").title = s.name;
    };
    S.onChange(sync);
    sync();

    v.addEventListener("input", (e) => {
      const n = +e.target.value;
      if (e.target.id === "stWarn") S.set({ warn: n });
      else if (e.target.id === "stCrit") S.set({ critical: n, warn: Math.min(S.get().warn, n - 1) });
    });
    v.addEventListener("change", (e) => {
      const t = e.target;
      const map = {
        stName: () => S.set({ name: t.value.trim() }),
        stToast: () => S.set({ toasts: t.checked }),
        stFeed: () => S.set({ feedAlerts: t.checked }),
      };
      if (map[t.id]) map[t.id]();
    });
    v.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.id === "stReset") {
        S.reset();
        ui.toast("Settings reset");
      } else if (b.id === "stClear") {
        if (!confirm("Clear all saved Pulsegrid data in this browser?")) return;
        try {
          Object.keys(localStorage).filter((k) => k.startsWith("pulsegrid:")).forEach((k) => localStorage.removeItem(k));
        } catch (_) {}
        (PG.db ? PG.db.clearAll() : Promise.resolve()).then(() => location.reload());
      }
    });
  }

  PG.views = {
    init() {
      initReports();
      initTeam();
      let imported = false;
      PG.store.on((c, info) => {
        if (c === "team" && info.initial && !imported) {
          imported = true;
          importOldTeam();
        }
        if (c === "tickets" || c === "team") renderTeam();
      });
      initSettings();
    },
    setQuery(q) {
      query = q;
      renderTeam();
    },
    team: () => members().map((m) => ({ ...m, tickets: openFor(m) })),
  };
})();