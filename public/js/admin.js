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
  const optsOf = (f) => (typeof f.opts === "function" ? f.opts() : f.opts);
  const isDynamic = (f) => typeof f.opts === "function";

  const ENV = [["prod", "Production"], ["stg", "Staging"]];
  const REGION_STATUS = [["auto", "Auto (from load)"], ["ok", "Healthy"], ["warn", "Degraded"], ["crit", "Critical"]];
  const SEV = PG.severityMeta.map((m) => [m.key, m.label]);
  const SEV_CLASS = { critical: "crit", high: "warn", medium: "info", low: "low" };
  const INCIDENT_STATUS = [["investigating", "Investigating"], ["identified", "Identified"], ["monitoring", "Monitoring"], ["resolved", "Resolved"]];
  const TICKET_STATUS = [["open", "Open"], ["resolved", "Resolved"]];
  const CATS = PG.categories.map((c) => [c, c]);

  const TEAM_OPTS = () => [["", "Unassigned"], ...(PG.views && PG.views.team ? PG.views.team() : []).map((m) => [m.name, m.name])];
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
      blurb: "Support requests handled by your team. Assignees are chosen from the Team page. Tickets are private to admins.",
      empty: "No tickets yet. Add your first one above.",
      fields: [
        { k: "title", label: "TITLE", type: "text", req: true, max: 120, ph: "VPN drops every hour" },
        { k: "category", label: "CATEGORY", type: "select", opts: CATS },
        { k: "status", label: "STATUS", type: "select", opts: TICKET_STATUS },
        { k: "assignee", label: "ASSIGNEE", type: "select", opts: TEAM_OPTS },
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
          ? `<select data-k="${f.k}">${optsOf(f).map(([val, l]) => `<option value="${esc(val)}">${esc(l)}</option>`).join("")}</select>`
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

    function fillDynamic(f, cur) {
      const el = dom(f.k);
      const opts = optsOf(f).slice();
      if (cur && !opts.some((o) => o[0] === cur)) opts.push([cur, `${cur} (not on team)`]);
      el.innerHTML = opts.map(([val, l]) => `<option value="${esc(val)}">${esc(l)}</option>`).join("");
      el.value = cur || opts[0][0];
    }
    function refreshDynamic() {
      spec.fields.filter(isDynamic).forEach((f) => fillDynamic(f, dom(f.k).value));
    }

    function reset() {
      editing = null;
      spec.fields.forEach((f) => {
        if (isDynamic(f)) return fillDynamic(f, "");
        dom(f.k).value = f.type === "datetime" ? toInput() : f.def != null ? f.def : f.type === "select" ? optsOf(f)[0][0] : "";
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
      refreshDynamic();
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
        if (isDynamic(f)) return fillDynamic(f, vals[f.k] || "");
        dom(f.k).value = f.type === "datetime" ? toInput(vals[f.k]) : vals[f.k] != null ? vals[f.k] : "";
      });
      title.textContent = `Edit ${spec.noun}`;
      save.textContent = "Save changes";
      cancel.hidden = false;
      v.querySelector(".crud-panel").scrollIntoView({ block: "nearest" });
      dom(spec.fields[0].k).focus();
    });

    if (spec.fields.some(isDynamic)) {
      document.addEventListener("click", (e) => e.target.closest(".nav-item") && refreshDynamic());
      spec.fields.filter(isDynamic).forEach((f) => dom(f.k).addEventListener("focus", refreshDynamic));
    }

    PG.store.on((col) => (col === spec.col || col === "regions") && paint());
    reset();
    paint();
  }

  function buildAdmins() {
    const fs = firebase.firestore();
    const stamp = firebase.firestore.FieldValue.serverTimestamp;
    const me = () => firebase.auth().currentUser || {};
    const ts = (x) => (x && x.toMillis ? x.toMillis() : 0);
    const EMAIL_RE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
    let admins = [];
    let invites = [];

    const v = document.createElement("div");
    v.className = "view";
    v.id = "view-admins";
    v.hidden = true;
    $("main").appendChild(v);

    const teamLink = [...document.querySelectorAll(".nav-item")].find((i) => i.textContent.trim() === "Team");
    const link = document.createElement("div");
    link.className = "nav-item";
    link.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2 3 7v6c0 5 4 8.5 9 9 5-.5 9-4 9-9V7z"/><circle cx="12" cy="11" r="2.4"/><path d="M8 17c.6-1.9 2.2-3 4-3s3.4 1.1 4 3"/></svg>Admins`;
    if (teamLink) teamLink.insertAdjacentElement("afterend", link);
    else document.querySelector(".sidebar .nav").appendChild(link);
    PG.ui.activate(link, () => PG.ui.navTo("Admins"));

    v.innerHTML = `
      <div class="view-head"><h1>Admins</h1><p>People who can sign in and manage this dashboard. Create an admin account directly, or invite someone by email.</p></div>
      <div class="panel crud-panel">
        <div class="section-head"><h2>Create an admin account</h2></div>
        <div class="crud-form">
          <label class="field">EMAIL<input id="caEmail" type="email" maxlength="120" placeholder="name@company.com" autocomplete="off" /></label>
          <label class="field">TEMPORARY PASSWORD<input id="caPass" type="text" minlength="6" maxlength="60" placeholder="at least 6 characters" autocomplete="off" /></label>
        </div>
        <div class="crud-bar"><button class="btn" id="caCreate" type="button">Create admin</button><span class="crud-msg" id="caMsg" role="status"></span></div>
        <p class="note">Creates the account and gives it admin access immediately. Share the email and temporary password with them privately. They can use "Forgot password?" on the sign-in screen to choose their own.</p>
      </div>
      <div class="panel crud-panel">
        <div class="section-head"><h2>Invite an admin</h2></div>
        <div class="crud-form"><label class="field wide">EMAIL<input id="adEmail" type="email" maxlength="120" placeholder="name@company.com" autocomplete="off" /></label></div>
        <div class="crud-bar"><button class="btn" id="adInvite" type="button">Invite admin</button><span class="crud-msg" id="adMsg" role="status"></span></div>
        <p class="note">No email is sent, so tell them to open the dashboard and sign in with this address. They can use Google sign-in, or an email and password they have verified. Use this for people who already have an account.</p>
      </div>
      <div class="panel crud-panel">
        <div class="section-head"><h2>Admins</h2><span class="hint" id="adCount"></span></div>
        <div class="table-scroll"><table class="table">
          <thead><tr><th>Admin</th><th>Added</th><th></th></tr></thead>
          <tbody id="adBody"></tbody>
        </table></div>
      </div>
      <div class="panel crud-panel">
        <div class="section-head"><h2>Pending invites</h2><span class="hint" id="inCount"></span></div>
        <div class="table-scroll"><table class="table">
          <thead><tr><th>Email</th><th>Invited by</th><th>Invited</th><th></th></tr></thead>
          <tbody id="inBody"></tbody>
        </table></div>
      </div>`;

    const msg = v.querySelector("#adMsg");
    const say = (t, bad) => {
      msg.textContent = t;
      msg.className = "crud-msg" + (bad ? " bad" : "");
    };
    const caMsg = v.querySelector("#caMsg");
    const sayCa = (t, bad) => {
      caMsg.textContent = t;
      caMsg.className = "crud-msg" + (bad ? " bad" : "");
    };
    const denied = (err) =>
      err && err.code === "permission-denied"
        ? "Permission denied. Publish the latest Firestore rules (firebase deploy --only firestore:rules)."
        : `Couldn't do that (${(err && (err.code || err.message)) || "unknown error"}).`;

    function paint() {
      const sorted = admins.slice().sort((a, b) => (a.email || a.id).localeCompare(b.email || b.id));
      v.querySelector("#adCount").textContent = `${sorted.length} total`;
      v.querySelector("#adBody").innerHTML = sorted.length
        ? sorted
            .map((a) => {
              const self = a.id === me().uid;
              return `<tr data-id="${esc(a.id)}">
                <td><b>${esc(a.email || "No email saved")}</b>${self ? ' <span class="status-chip ok">You</span>' : ""}<div class="dim">${esc(a.id)}</div></td>
                <td>${fmt(ts(a.createdAt))}</td>
                <td class="crud-actions"><button class="btn ghost sm danger" data-act="rm" type="button"${self ? ' disabled title="You can\'t remove yourself" style="opacity:.4;cursor:default"' : ""}>Remove</button></td></tr>`;
            })
            .join("")
        : `<tr><td colspan="3" class="empty">No admins found.</td></tr>`;

      const inv = invites.slice().sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
      v.querySelector("#inCount").textContent = `${inv.length} pending`;
      v.querySelector("#inBody").innerHTML = inv.length
        ? inv
            .map(
              (i) => `<tr data-id="${esc(i.id)}"><td><b>${esc(i.email || i.id)}</b></td><td>${esc(i.invitedBy || "—")}</td><td>${fmt(ts(i.createdAt))}</td>
                <td class="crud-actions"><button class="btn ghost sm" data-act="revoke" type="button">Revoke</button></td></tr>`,
            )
            .join("")
        : `<tr><td colspan="4" class="empty">No pending invites.</td></tr>`;
    }

    function invite() {
      say("");
      const email = v.querySelector("#adEmail").value.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return say("Enter a valid email address.", true);
      if (admins.some((a) => (a.email || "").toLowerCase() === email)) return say("That person is already an admin.", true);
      const btn = v.querySelector("#adInvite");
      btn.disabled = true;
      fs.collection("adminInvites")
        .doc(email)
        .set({ email, invitedBy: me().email || "", createdAt: stamp() })
        .then(() => {
          v.querySelector("#adEmail").value = "";
          PG.ui.toast(`Invite added for ${email}`);
        })
        .catch((err) => say(denied(err), true))
        .finally(() => (btn.disabled = false));
    }

    async function createAccount() {
      sayCa("");
      const email = v.querySelector("#caEmail").value.trim().toLowerCase();
      const pw = v.querySelector("#caPass").value;
      if (!EMAIL_RE.test(email)) return sayCa("Enter a valid email address.", true);
      if (pw.length < 6) return sayCa("Use a password with at least 6 characters.", true);
      if (admins.some((a) => (a.email || "").toLowerCase() === email)) return sayCa("That person is already an admin.", true);

      const btn = v.querySelector("#caCreate");
      btn.disabled = true;
      sayCa("Creating…");

      let app2;
      try {
        app2 = firebase.initializeApp(window.FIREBASE_CONFIG, "create-admin-" + Date.now());
        const cred = await app2.auth().createUserWithEmailAndPassword(email, pw);
        try {

          await fs.collection("admins").doc(cred.user.uid).set({ email, via: "admin", createdAt: stamp() });
        } catch (err) {
          sayCa("Account created, but granting access failed. " + denied(err), true);
          return;
        }
        fs.collection("adminInvites").doc(email).delete().catch(() => {});
        v.querySelector("#caEmail").value = "";
        v.querySelector("#caPass").value = "";
        sayCa("");
        PG.ui.toast(`Admin account created for ${email}`);
      } catch (err) {
        sayCa(
          err && err.code === "auth/email-already-in-use"
            ? 'That email already has an account. Use "Invite an admin" below instead.'
            : err && err.code === "auth/weak-password"
              ? "Use a stronger password (at least 6 characters)."
              : err && err.code === "auth/invalid-email"
                ? "Enter a valid email address."
                : err && err.code === "auth/operation-not-allowed"
                  ? "Email/password sign-in isn't enabled in the Firebase console."
                  : `Couldn't create the account (${(err && (err.code || err.message)) || "unknown error"}).`,
          true,
        );
      } finally {
        if (app2) {
          try {
            await app2.auth().signOut();
          } catch (_) {}
          app2.delete().catch(() => {});
        }
        btn.disabled = false;
      }
    }

    v.querySelector("#adInvite").addEventListener("click", invite);
    v.querySelector("#adEmail").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        invite();
      }
    });
    v.querySelector("#caCreate").addEventListener("click", createAccount);
    v.querySelector("#caPass").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createAccount();
      }
    });

    v.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn || btn.disabled) return;
      const id = btn.closest("tr").dataset.id;
      if (btn.dataset.act === "rm") {
        const a = admins.find((x) => x.id === id);
        if (!confirm(`Remove ${(a && a.email) || "this admin"}? They will lose access to the dashboard.`)) return;
        fs.collection("admins").doc(id).delete().then(() => PG.ui.toast("Admin removed"), (err) => PG.ui.toast(denied(err)));
      } else if (btn.dataset.act === "revoke") {
        fs.collection("adminInvites").doc(id).delete().then(() => PG.ui.toast("Invite revoked"), (err) => PG.ui.toast(denied(err)));
      }
    });

    const read = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    fs.collection("admins").onSnapshot((s) => ((admins = read(s)), paint()), (err) => say(denied(err), true));
    fs.collection("adminInvites").onSnapshot((s) => ((invites = read(s)), paint()), (err) => say(denied(err), true));
    paint();
  }

  PG.admin = {
    init: () => {
      SPECS.forEach(build);
      buildAdmins();
    },
  };
})();