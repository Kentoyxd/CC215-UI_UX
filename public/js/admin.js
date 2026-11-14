/* Pulsegrid — admin data entry: Infrastructure (regions), Incidents, Tickets.
   Each page is a form + table that writes to Firestore through PG.store. */
(function () {
  "use strict";
  const PG = window.Pulsegrid;
  const { pad, esc } = PG.util;
  const $ = (s) => document.querySelector(s);

  const fmt = (ms) =>
    ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const toInput = (ms) => {
    const d = new Date(ms || Date.now());
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const chip = (cls, text) => `<span class="status-chip ${cls}">${esc(text)}</span>`;
  const labelOf = (opts, v) => (opts.find((o) => o[0] === v) || [v, v || "—"])[1];

  const ENV = [["prod", "Production"], ["stg", "Staging"]];
  const REGION_STATUS = [["auto", "Auto (from load)"], ["ok", "Healthy"], ["warn", "Degraded"], ["crit", "Critical"]];
  const SEV = PG.severityMeta.map((m) => [m.key, m.label]);
  const SEV_CLASS = { critical: "crit", high: "warn", medium: "info", low: "low" };
  const INCIDENT_STATUS = [["investigating", "Investigating"], ["identified", "Identified"], ["monitoring", "Monitoring"], ["resolved", "Resolved"]];
  const TICKET_STATUS = [["open", "Open"], ["resolved", "Resolved"]];
  const CATS = PG.categories.map((c) => [c, c]);
  const withResolved = (v, ex) => ({ ...v, resolvedAt: v.status === "resolved" ? (ex && ex.resolvedAt) || Date.now() : null });

  const SPECS = [
    {
      view: "infra", col: "regions", noun: "region", title: "Infrastructure",
      blurb: "The regions you monitor. They appear on the dashboard and on the public status page.",
      empty: "No regions yet. Add your first one above.",
      fields: [
        { k: "name", label: "REGION ID", type: "text", req: true, max: 40, ph: "us-east-1" },
        { k: "region", label: "LOCATION", type: "text", max: 60, ph: "N. Virginia" },
        { k: "env", label: "ENVIRONMENT", type: "select", opts: ENV },
        { k: "servers", label: "SERVERS", type: "number", min: 0, max: 100000, def: 0 },
        { k: "load", label: "LOAD %", type: "number", min: 0, max: 100, def: 0 },
        { k: "latency", label: "LATENCY (MS)", type: "number", min: 0, max: 10000, def: 0 },
        { k: "status", label: "STATUS", type: "select", opts: REGION_STATUS, def: "auto" },
      ],
      cols: [
        { h: "Region", cell: (r) => `<b>${esc(r.name)}</b><div class="dim">${esc(r.region || "")}</div>` },
        { h: "Env", cell: (r) => esc(labelOf(ENV, r.env)) },
        { h: "Servers", cell: (r) => r.servers || 0 },
        { h: "Load", cell: (r) => `${r.load}%` },
        { h: "Latency", cell: (r) => `${r.latency}ms` },
        {
          h: "Status",
          cell: (r) => {
            const k = PG.panels.STATUS[r.status] ? r.status : PG.panels.autoStatus(+r.load || 0);
            return chip(k, PG.panels.STATUS[k].label);
          },
        },
      ],
      sort: (a, b) => a.name.localeCompare(b.name),
      before: (v) => ({ ...v, status: v.status === "auto" ? PG.panels.autoStatus(v.load) : v.status }),
      edit: (r) => ({ ...r, status: "auto" }),
    },
    {
      view: "incidents", col: "incidents", noun: "incident", title: "Incidents",
      blurb: "Anything affecting service. Open incidents and their update text are shown on the public status page.",
      empty: "No incidents logged. That's a good sign.",
      datalist: true,
      fields: [
        { k: "title", label: "TITLE", type: "text", req: true, max: 120, ph: "Elevated API errors" },
        { k: "severity", label: "SEVERITY", type: "select", opts: SEV, def: "medium" },
        { k: "status", label: "STATUS", type: "select", opts: INCIDENT_STATUS },
        { k: "region", label: "AFFECTED REGION", type: "text", max: 60, list: "dlRegions", ph: "optional" },
        { k: "startedAt", label: "STARTED", type: "datetime" },
        { k: "downtime", label: "DOWNTIME (MIN)", type: "number", min: 0, max: 100000, def: 0 },
        { k: "message", label: "PUBLIC UPDATE", type: "textarea", max: 500, wide: true, ph: "What users should know. Shown on the status page." },
      ],
      cols: [
        { h: "Incident", cell: (r) => `<b>${esc(r.title)}</b>${r.region ? `<div class="dim">${esc(r.region)}</div>` : ""}` },
        { h: "Severity", cell: (r) => chip(SEV_CLASS[r.severity] || "off", labelOf(SEV, r.severity)) },
        { h: "Status", cell: (r) => esc(labelOf(INCIDENT_STATUS, r.status)) },
        { h: "Started", cell: (r) => fmt(r.startedAt) },
        { h: "Downtime", cell: (r) => `${r.downtime || 0} min` },
      ],
      sort: (a, b) => b.startedAt - a.startedAt,
      before: withResolved,
      edit: (r) => r,
    },
    {
      view: "tickets", col: "tickets", noun: "ticket", title: "Tickets",
      blurb: "Support requests handled by your team. Tickets are private to admins.",
      empty: "No tickets yet. Add your first one above.",
      fields: [
        { k: "title", label: "TITLE", type: "text", req: true, max: 120, ph: "VPN drops every hour" },
        { k: "category", label: "CATEGORY", type: "select", opts: CATS },
        { k: "status", label: "STATUS", type: "select", opts: TICKET_STATUS },
        { k: "assignee", label: "ASSIGNEE", type: "text", max: 60, ph: "optional" },
        { k: "openedAt", label: "OPENED", type: "datetime" },
      ],
      cols: [
        { h: "Ticket", cell: (r) => `<b>${esc(r.title)}</b>` },
        { h: "Category", cell: (r) => esc(r.category || "Other") },
        { h: "Status", cell: (r) => chip(r.status === "resolved" ? "ok" : "info", labelOf(TICKET_STATUS, r.status)) },
        { h: "Assignee", cell: (r) => esc(r.assignee || "—") },
        { h: "Opened", cell: (r) => fmt(r.openedAt) },
      ],
      sort: (a, b) => b.openedAt - a.openedAt,
      before: withResolved,
      edit: (r) => r,
    },
  ];

  function build(spec) {
    const v = $("#view-" + spec.view);
    if (!v) return;
    let editing = null;
    const cap = spec.noun[0].toUpperCase() + spec.noun.slice(1);

    const field = (f) => {
      const ph = esc(f.ph || "");
      const input =
        f.type === "select"
          ? `<select data-k="${f.k}">${f.opts.map(([val, l]) => `<option value="${esc(val)}">${esc(l)}</option>`).join("")}</select>`
          : f.type === "textarea"
            ? `<textarea data-k="${f.k}" rows="3" maxlength="${f.max || 500}" placeholder="${ph}"></textarea>`
            : `<input data-k="${f.k}" type="${f.type === "datetime" ? "datetime-local" : f.type}" placeholder="${ph}"
                ${f.req ? "required" : ""} ${f.type === "text" ? `maxlength="${f.max}"` : ""}
                ${f.type === "number" ? `min="${f.min}" max="${f.max}" step="1"` : ""} ${f.list ? `list="${f.list}"` : ""} />`;
      return `<label class="field${f.wide ? " wide" : ""}">${f.label}${input}</label>`;
    };

    v.innerHTML = `
      <div class="view-head"><h1>${spec.title}</h1><p>${spec.blurb}</p></div>
      <div class="panel crud-panel">
        <div class="section-head"><h2 class="crud-title">Add ${spec.noun}</h2></div>
        <div class="crud-form">${spec.fields.map(field).join("")}</div>
        ${spec.datalist ? '<datalist id="dlRegions"></datalist>' : ""}
        <div class="crud-bar">
          <button class="btn crud-save" type="button">Add ${spec.noun}</button>
          <button class="btn ghost crud-cancel" type="button" hidden>Cancel</button>
          <span class="crud-msg" role="status"></span>
        </div>
      </div>
      <div class="panel crud-panel">
        <div class="section-head"><h2>${spec.title}</h2><span class="hint crud-count"></span></div>
        <div class="table-scroll"><table class="table">
          <thead><tr>${spec.cols.map((c) => `<th>${c.h}</th>`).join("")}<th></th></tr></thead>
          <tbody class="crud-body"></tbody>
        </table></div>
      </div>`;

    const dom = (k) => v.querySelector(`[data-k="${k}"]`);
    const save = v.querySelector(".crud-save");
    const cancel = v.querySelector(".crud-cancel");
    const title = v.querySelector(".crud-title");
    const msg = v.querySelector(".crud-msg");
    const say = (t, bad) => {
      msg.textContent = t;
      msg.className = "crud-msg" + (bad ? " bad" : "");
    };

    function reset() {
      editing = null;
      spec.fields.forEach((f) => {
        dom(f.k).value = f.type === "datetime" ? toInput() : f.def != null ? f.def : f.type === "select" ? f.opts[0][0] : "";
      });
      title.textContent = `Add ${spec.noun}`;
      save.textContent = `Add ${spec.noun}`;
      cancel.hidden = true;
    }

    function read() {
      const out = {};
      for (const f of spec.fields) {
        const el = dom(f.k);
        if (!el.checkValidity()) {
          el.reportValidity();
          return null;
        }
        let val = el.value;
        if (f.type === "number") val = Math.round(Number(val) || 0);
        else if (f.type === "datetime") val = new Date(val).getTime() || Date.now();
        else val = val.trim();
        out[f.k] = val;
      }
      return out;
    }

    function submit() {
      say("");
      const vals = read();
      if (!vals) return say("Fill in the highlighted field first.", true);
      const doc = spec.before(vals, editing);
      const wasEditing = !!editing;
      const p = wasEditing ? PG.store.update(spec.col, editing.id, doc) : PG.store.add(spec.col, doc);
      save.disabled = true;
      say("Saving…");
      const slow = setTimeout(
        () => say("Still saving… check your connection, and that the Firestore database is created in the Firebase console.", true),
        8000,
      );
      p.then(() => {
        clearTimeout(slow);
        say("");
        PG.ui.toast(`${cap} ${wasEditing ? "saved" : "added"}`);
        reset();
      })
        .catch((err) => {
          clearTimeout(slow);
          say(
            err && err.code === "permission-denied"
              ? "Permission denied. Your user ID must be in the admins collection and the Firestore rules must be published."
              : `Couldn't save (${(err && (err.code || err.message)) || "unknown error"}).`,
            true,
          );
        })
        .finally(() => (save.disabled = false));
    }

    function paint() {
      const list = PG.store.data[spec.col].slice().sort(spec.sort);
      v.querySelector(".crud-count").textContent = `${list.length} total`;
      v.querySelector(".crud-body").innerHTML = list.length
        ? list
            .map(
              (r) => `<tr data-id="${esc(r.id)}">${spec.cols.map((c) => `<td>${c.cell(r)}</td>`).join("")}
              <td class="crud-actions"><button class="btn ghost sm" data-act="edit" type="button">Edit</button>
              <button class="btn ghost sm" data-act="del" type="button">Delete</button></td></tr>`,
            )
            .join("")
        : `<tr><td colspan="${spec.cols.length + 1}" class="empty">${spec.empty}</td></tr>`;
      const dl = v.querySelector("#dlRegions");
      if (dl) dl.innerHTML = PG.store.data.regions.map((r) => `<option value="${esc(r.name)}"></option>`).join("");
    }

    save.addEventListener("click", submit);
    cancel.addEventListener("click", reset);
    v.querySelectorAll("input").forEach((i) =>
      i.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      }),
    );
    v.querySelector(".crud-body").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const rec = PG.store.data[spec.col].find((r) => r.id === btn.closest("tr").dataset.id);
      if (!rec) return;
      if (btn.dataset.act === "del") {
        const name = rec.name || rec.title;
        if (confirm(`Delete ${spec.noun} "${name}"? This can't be undone.`))
          PG.store.remove(spec.col, rec.id).then(() => PG.ui.toast(`${cap} deleted`), () => PG.ui.toast("Couldn't delete"));
        return;
      }
      editing = rec;
      const vals = spec.edit(rec);
      spec.fields.forEach((f) => {
        dom(f.k).value = f.type === "datetime" ? toInput(vals[f.k]) : vals[f.k] != null ? vals[f.k] : "";
      });
      title.textContent = `Edit ${spec.noun}`;
      save.textContent = "Save changes";
      cancel.hidden = false;
      v.querySelector(".crud-panel").scrollIntoView({ block: "nearest" });
      dom(spec.fields[0].k).focus();
    });

    PG.store.on((col) => (col === spec.col || col === "regions") && paint());
    reset();
    paint();
  }

  PG.admin = { init: () => SPECS.forEach(build) };
})();