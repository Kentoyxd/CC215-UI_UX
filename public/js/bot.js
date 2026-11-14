/* Pulsegrid — "Pulse", a personalised assistant. Runs in the browser.
   - Reads live dashboard data and can change filters/settings for you.
   - Built-in brain: data answers + a knowledge base covering every part of the system.
   - Anything else goes to Gemini (Firebase AI Logic) with the dashboard data AND the same
     knowledge base. If Gemini is unreachable (offline, blocked by Brave Shields, quota), Pulse
     falls back to the closest knowledge-base answer.
   - Understands small typos, follow-ups ("why?", "tell me more", "what about staging?"), numeric filters,
     and can create/resolve/assign tickets and incidents after asking for confirmation.
   - Personality: calm, warm, dry-witted. Reads the room (relaxed when green, serious when red).
     Replies are varied: no pool repeats the same line twice in a row.
   - Voice: browser text-to-speech (off by default) and speech recognition (not available in Brave). */
(function () {
  "use strict";
  const PG = window.Pulsegrid;
  const { plural } = PG.util;
  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const IS_BRAVE = !!navigator.brave; // Brave ships without Google's speech service
  const CHAT_KEY = "pulsegrid:chat";
  const MEM_KEY = "pulsegrid:bot";
  const read = (k, d) => {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      return v == null ? d : v;
    } catch (_) {
      return d;
    }
  };
  const write = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (_) {}
  };

  const mem = Object.assign({ topics: {}, lastOpen: 0, voice: false, voiceName: "", count: 0 }, read(MEM_KEY, {}));
  let log = read(CHAT_KEY, []);
  let busy = 0;
  let el = {};
  const PLACEHOLDER = "Ask me anything about the system…";

  /* ---------- who the user is ---------- */
  const settings = () => PG.settings.get();
  const who = () => {
    const name = settings().name.trim();
    const first = name.split(/\s+/)[0];
    return /^\w\.?$/.test(first) && name !== first ? name : first;
  };
  const me = () => (PG.views.team() || []).find((m) => m.name.toLowerCase() === settings().name.trim().toLowerCase());

  /* ---------- variety helpers ---------- */
  const lastPick = {};
  // Picks a random item but never the same one twice in a row for the same pool.
  const pick = (a, key) => {
    if (!Array.isArray(a)) return a;
    const k = key || a[0];
    let i = Math.floor(Math.random() * a.length);
    if (a.length > 1 && lastPick[k] === i) i = (i + 1 + Math.floor(Math.random() * (a.length - 1))) % a.length;
    lastPick[k] = i;
    return a[i];
  };
  const chance = (p) => Math.random() < p;

  /* ---------- memory: topics asked about most come first in the quick replies ---------- */
  const PROMPTS = {
    status: "How are things right now?",
    regions: "Which regions need attention?",
    latency: "Which region is slowest?",
    uptime: "How's uptime looking?",
    incidents: "Incidents by severity",
    tickets: "Ticket breakdown",
    team: "Who's on call?",
    howto: "How do I add a region?",
  };
  const ctx = { kind: null, region: null }; // what we were just talking about, for follow-ups
  function topic(k) {
    ctx.kind = k;
    mem.topics[k] = (mem.topics[k] || 0) + 1;
    write(MEM_KEY, mem);
  }
  function suggestions(exclude, n = 3) {
    return Object.keys(PROMPTS)
      .sort((a, b) => (mem.topics[b] || 0) - (mem.topics[a] || 0) + (Math.random() - 0.5) * 0.6)
      .filter((k) => k !== exclude)
      .slice(0, n)
      .map((k) => PROMPTS[k]);
  }

  /* ---------- live data helpers ---------- */
  const regions = () => PG.panels.snapshot();
  const range = () => PG.getState().range;
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const rowOf = (r) => `<b>${esc(r.name)}</b> · ${r.load}% load · ${r.latency}ms · ${r.status}`;
  const lines = (a) => a.join("<br>");
  const names = (a) => a.map((r) => `<b>${esc(r.name)}</b>`).join(", ");
  const DATA = () => PG.store.data;
  const openInc = () => DATA().incidents.filter((i) => i.status !== "resolved");
  const SEV_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
  const ago = (ms) => {
    const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    if (m < 1440) return `${Math.round(m / 60)} h ago`;
    return `${Math.round(m / 1440)} d ago`;
  };

  const mood = () => {
    const rs = regions();
    if (rs.some((r) => r.status === "Critical") || openInc().some((i) => i.severity === "critical")) return "crit";
    if (rs.some((r) => r.status === "Degraded") || openInc().length) return "warn";
    return "calm";
  };
  // A small dry aside, only when things are calm or mildly amber, never when something is critical.
  const spice = (calm, warn) => {
    const m = mood();
    if (m === "crit" || !chance(0.35)) return "";
    return " " + pick(m === "calm" ? calm : warn || calm);
  };

  /* ---------- knowledge base: how the whole system works ----------
     k = keywords (a phrase counts double). h = HTML answer or a function returning it.
     This same text is also given to Gemini so its answers match the real app. */
  const KB = [
    { id: "app", k: ["what is pulsegrid", "pulsegrid", "this dashboard", "this app", "what is this", "what does this do", "purpose"],
      h: "Pulsegrid is an IT operations command center. Admins record regions, incidents and tickets, the dashboard turns them into live KPIs and charts, and a public status page shows customers the regions and incidents you choose to publish." },
    { id: "uptime", k: ["uptime", "how is uptime", "calculated", "computed", "worked out", "sla", "99.9", "downtime"],
      h: "Uptime is worked out from incidents. Each incident's downtime minutes count against the day it started. A day's uptime is 100% minus downtime divided by 1,440 minutes. The KPI averages those days over your selected range, and anything under 99.9% counts as a missed SLA day. So to change uptime, edit an incident's start time or its downtime minutes." },
    { id: "status", k: ["degraded", "critical", "healthy", "threshold", "status colour", "status color", "auto status", "load percent", "what makes a region"],
      h: () => `A region's status comes from its load. At or above <b>${settings().warn}%</b> it's Degraded, at or above <b>${settings().critical}%</b> it's Critical, otherwise Healthy. If you set a status by hand on the Infrastructure page it overrides that, and "Auto" goes back to following load. Change the numbers under Settings.` },
    { id: "hero", k: ["banner", "hero", "top strip", "tab title", "emoji", "browser tab", "overall status"],
      h: "The banner at the top of Overview summarises production regions (or every region if none are marked production): all healthy, degraded in N regions, or critical in N regions. The browser tab title mirrors it with a 🟢, 🟠, 🔴 or ⚪ so you can spot trouble from another tab." },
    { id: "kpis", k: ["kpi", "kpis", "cards", "servers monitored", "avg response", "average response", "response time", "tickets resolved", "active incidents", "open tickets"],
      h: "The six KPI cards: <b>uptime</b> (average over the range), <b>active incidents</b> (not resolved), <b>servers monitored</b> (sum of servers across all regions), <b>avg response</b> (average latency across all regions), <b>tickets resolved</b> in the range, and <b>open tickets</b>. The range picker affects uptime and resolved tickets; the environment filter only affects the region table." },
    { id: "addregion", k: ["add region", "add a region", "new region", "create region", "add infrastructure", "add server", "add a server"],
      h: "Open <b>Infrastructure</b> in the sidebar, fill in the region ID, location, environment, servers, load, latency and status, then press Add region. Leave status on Auto to follow load. It appears on the dashboard and the public status page straight away." },
    { id: "addincident", k: ["add incident", "add an incident", "new incident", "log incident", "report incident", "create incident", "resolve incident", "close incident", "public update"],
      h: "Open <b>Incidents</b>, enter a title, severity, status, optional affected region, start time, downtime minutes and a public update, then press Add incident. Open incidents and their public update text show on the status page. Setting the status to Resolved stamps the resolved time automatically." },
    { id: "addticket", k: ["add ticket", "add a ticket", "new ticket", "create ticket", "log ticket", "assign ticket", "assignee", "assign a ticket"],
      h: "Open <b>Tickets</b>, enter a title, category, status, assignee and opened time. Assignees are picked from the Team page, and each member's open-ticket count comes from tickets assigned to them by name. Tickets are private to admins and never appear on the public status page." },
    { id: "editdelete", k: ["edit", "delete", "remove a", "change a region", "update a region", "modify", "fix a typo"],
      h: "Every row on Infrastructure, Incidents and Tickets has Edit and Delete buttons. Edit loads the row into the form above, then press Save changes. Delete asks for confirmation and can't be undone." },
    { id: "public", k: ["status page", "public page", "customers", "public status", "external", "share status"],
      h: "The public status page lives at <b>/status</b> and needs no sign-in. It shows the overall banner, 30-day uptime, active incidents with their public update, every region, and resolved incidents from the last 30 days. Tickets, settings and team data are never public." },
    { id: "privacy", k: ["who can see", "private", "security", "firestore rules", "rules", "permission", "access control", "is it safe"],
      h: "Regions and incidents are readable by anyone (that's what powers the status page) but only admins can change them. Tickets are admin-only. Your settings, team, reports and chat are stored in your own private document that only you can read." },
    { id: "admins", k: ["admin", "admins", "invite", "add admin", "create admin", "new admin", "remove admin", "give access", "first admin"],
      h: "The <b>Admins</b> page has two ways to add someone. <b>Create an admin account</b> makes a login (email plus temporary password) and grants access immediately without signing you out. <b>Invite an admin</b> stores an invite for an email; no message is sent, so tell them to sign in with that address (Google works, or a verified email login). You can remove other admins but never yourself. The very first admin is added by hand in Firestore: a document in the admins collection with their user ID." },
    { id: "signin", k: ["sign in", "sign out", "log out", "logout", "log in", "login", "forgot password", "reset password", "google sign"],
      h: "Sign in with email and password or Google. \"Forgot password?\" sends a reset link to the email you typed. Sign out from the avatar menu (top right). If you see \"No admin access\", your account isn't in the admins collection yet." },
    { id: "reports", k: ["report", "reports", "generate", "download csv", "print", "pdf", "report builder"],
      h: "On <b>Reports</b> pick Uptime summary, Incident summary, Ticket summary or Infrastructure health (live), choose a period, and press Generate to see summary figures and a table. Then Download CSV or Print / Save as PDF. The last six reports are kept under Recent reports." },
    { id: "schedule", k: ["scheduled", "schedule", "email report", "emailing", "weekly digest", "automatic report"],
      h: "The scheduled-report switches are saved in your account, but nothing is emailed yet. Sending real emails would need a backend such as a Cloud Function." },
    { id: "team", k: ["on call", "on-call", "oncall", "status badge", "team member", "add member", "team page", "pager"],
      h: "On <b>Team</b> you can add members with a name and role, click a status badge to cycle Online, Away and Offline, and press Set on-call to hand over the pager (only one person is on call at a time). Open-ticket counts come from tickets assigned by name." },
    { id: "settings", k: ["settings", "display name", "preferences", "reset settings", "clear data", "saved data", "profile"],
      h: () => `<b>Settings</b> has your display name (also your avatar initials), the Degraded threshold (currently ${settings().warn}%) and Critical threshold (${settings().critical}%), switches for pop-up and feed alerts, Reset settings, and Clear all saved data, which also wipes your cloud copy. The critical threshold is always kept above the degraded one.` },
    { id: "search", k: ["search", "shortcut", "ctrl k", "keyboard", "hotkey", "find something", "press /"],
      h: "Press <b>Ctrl+K</b> (⌘K on Mac) or <b>/</b> to jump to search. Typing filters the region table, the activity feed and the team list. Esc clears it. Menus and buttons also work with Tab, Enter, Space and the arrow keys." },
    { id: "alerts", k: ["bell", "notification", "notifications", "toast", "alerts", "badge", "mark all"],
      h: "When a region goes Critical or recovers, or an incident opens or resolves, Pulsegrid shows a toast, adds a feed line, adds an item to the bell menu and bumps its badge. Open the bell and choose Mark all as read to clear it. Toasts and feed alerts can be switched off in Settings." },
    { id: "feed", k: ["feed", "activity feed", "activity", "streaming", "pause the feed"],
      h: "The activity feed is built from incidents and tickets (opened and resolved) plus local alerts, newest first. Click the \"live\" label at the top of it to pause or resume." },
    { id: "export", k: ["export", "csv", "download"],
      h: "The cyan <b>Export CSV</b> button on the regions panel downloads exactly the regions you're looking at, respecting the environment filter, search and sort. Reports have their own CSV download." },
    { id: "sort", k: ["sort", "column", "order by", "reverse order"],
      h: "Click Region, Load, Latency or Status in the region table header to sort. Click again to reverse." },
    { id: "range", k: ["time range", "range", "environment", "filter", "last 7", "last 30", "last 90"],
      h: "The range picker (7, 30 or 90 days) drives the uptime chart, incident donut, ticket bars and the uptime and resolved-ticket KPIs. The environment picker (All, Production, Staging) filters the region table. Both choices are remembered next time. I can switch them for you, just ask." },
    { id: "data", k: ["sync", "live data", "real time", "realtime", "firestore", "database", "where is my data", "storage", "localstorage", "cloud", "saved where"],
      h: "Regions, incidents and tickets live in Firestore and update in real time on every open dashboard. Your personal settings, team, reports and chat are kept in this browser and mirrored to your private cloud document so they follow you across devices." },
    { id: "bandwidth", k: ["bandwidth"], h: "Pulsegrid doesn't track bandwidth. It tracks load, latency, servers, uptime, incidents and tickets." },
    { id: "charts", k: ["donut", "severity chart", "chart", "graph", "tooltip", "hover", "bar chart"],
      h: "Hover the uptime line for a day's exact value, hover a donut segment to see its count, and the bars show tickets per category (anything unrecognised is counted as Other)." },
    { id: "ai", k: ["gemini", "artificial", "ai service", "what do you send", "data do you send", "memory", "remember", "who made you", "how do you work"],
      h: "Common questions are answered right here in your browser. Open-ended ones send a summary of the dashboard (regions, open incidents, counts, team availability) to Gemini through Firebase AI Logic. Ticket titles and assignees are never sent. My memory of you (name, recent chat, favourite topics) stays in this browser; say \"clear chat\" to wipe it." },
    { id: "voice", k: ["voice", "mic", "microphone", "speak", "talk to you", "speech", "mute", "read aloud"],
      h: () => `The speaker button in my header makes me read replies aloud (or say \"unmute\").${SR ? " The mic button lets you talk to me; your browser's speech service processes the audio, and only while the mic is on." : IS_BRAVE ? " Voice input isn't available in Brave because it ships without Google's speech service, but typing works fine and I can still talk back." : " Voice input isn't supported in this browser."}` },
    { id: "brave", k: ["brave", "shields", "not working", "blocked", "adblock", "ad block", "browser support", "which browser", "firefox", "safari"],
      h: "Pulsegrid runs in any modern browser. In Brave the live data uses a Shields-friendly connection mode automatically. If something still looks blocked, click the lion icon and turn Shields down for this site. The mic doesn't work in Brave, and AI answers may be blocked by Shields, in which case I fall back to my built-in knowledge." },
    { id: "trouble", k: ["no data", "empty", "nothing shows", "not loading", "permission denied", "can't save", "cant save", "error", "couldn't load", "stuck", "broken"],
      h: "If data won't load or save: make sure your account has a document in the <b>admins</b> collection, that the Firestore rules are published (firebase deploy --only firestore:rules), and that the Firestore database exists. Then check your connection, and in Brave try turning Shields down for this site." },
  ];
  KB.forEach((e) => (e.rx = e.k.map((w) => ({ re: new RegExp("\\b" + escRe(w)), w: w.includes(" ") ? 2 : 1 }))));
  const kbText = (e) => (typeof e.h === "function" ? e.h() : e.h);
  function kbBest(t) {
    let best = null;
    let score = 0;
    KB.forEach((e) => {
      const s = sum(e.rx.map((x) => (x.re.test(t) ? x.w : 0)));
      if (s > score) {
        score = s;
        best = e;
      }
    });
    return { e: best, s: score };
  }
  const HOWTO = /\b(how (do|can|should|to|does|did|would)|how .{0,30}(calculated|computed|worked out|determined)|where (do|can|is|are|does)|what (does|do) .{0,30}(mean|do|show)|what (is|are) (a|an|the)\b|what's (a|an|the)\b|explain|why (does|do)|can i|could i|is it possible|what happens|difference between|meaning of|tell me about (the )?(settings|reports|team|admins|status page|notifications|feed))/;

  /* ---------- typo tolerance ---------- */
  const VOCAB = new Set("uptime latency incident incidents ticket tickets infrastructure degraded critical region regions severity staging production threshold settings reports status servers bandwidth assign resolve unassigned downtime availability overview notification notifications schedule insights summary slowest busiest environment healthy helpdesk category export refresh invite dashboard".split(" "));
  KB.forEach((e) => e.k.forEach((k) => k.split(" ").forEach((w) => w.length > 4 && VOCAB.add(w))));
  const lev = (a, b) => {
    if (Math.abs(a.length - b.length) > 2) return 9;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  // Fixes small typos ("incidnets" -> "incidents") so the rules still match. Region and member names are left alone.
  function fix(t) {
    const own = new Set([...regions().flatMap((r) => words(r.name + " " + (r.region || ""))), ...(PG.views.team() || []).flatMap((m) => words(m.name))]);
    return t.replace(/[a-z]{5,}/g, (w) => {
      if (VOCAB.has(w) || own.has(w)) return w;
      let best = w;
      let bd = (w.length >= 9 ? 2 : 1) + 1;
      VOCAB.forEach((v) => {
        if (v[0] !== w[0]) return;
        const d = lev(w, v);
        if (d < bd) {
          bd = d;
          best = v;
        }
      });
      return best;
    });
  }

  /* ---------- follow-ups, specific facts, numeric filters, insights ---------- */
  const envName = (e) => (e === "prod" ? "production" : "staging");
  const openTickets = () => DATA().tickets.filter((x) => x.status !== "resolved");
  const pronounRegion = (t) => (ctx.region && /\b(it|its|it's|that region|this region|there|that one)\b/.test(t) ? regions().find((r) => r.name === ctx.region) : null);

  // Short, direct answers: "what's the load on us-east-1?"
  function regionFact(t, r) {
    const bits = [];
    if (/\bload\b/.test(t)) bits.push(`load is <b>${r.load}%</b>`);
    if (/\b(latency|ping|response)\b/.test(t)) bits.push(`latency is <b>${r.latency}ms</b>`);
    if (/\bservers?\b/.test(t)) bits.push(`it runs <b>${+r.servers || 0}</b> servers`);
    if (/\b(env|environment|prod|production|staging)\b/.test(t)) bits.push(`it's <b>${envName(r.env)}</b>`);
    if (/\b(where|location)\b/.test(t)) bits.push(`it's in <b>${esc(r.region || "an unspecified location")}</b>`);
    if (/\b(status|health|healthy)\b/.test(t)) bits.push(`it's <b>${r.status}</b>`);
    if (!bits.length) return null;
    topic("regions");
    ctx.region = r.name;
    ctx.kind = "region";
    return { h: `For <b>${esc(r.name)}</b>: ${bits.join(", ")}.`, c: ["Tell me more", "Why is that?", ...suggestions("regions", 1)] };
  }

  function why() {
    const s = settings();
    const AUTO = { ok: "Healthy", warn: "Degraded", crit: "Critical" };
    const explain = (r) => {
      const auto = AUTO[PG.panels.autoStatus(+r.load || 0)];
      return auto === r.status
        ? `<b>${esc(r.name)}</b> is ${r.status} because its load is ${r.load}% (degraded at ${s.warn}%, critical at ${s.critical}%).`
        : `<b>${esc(r.name)}</b> is marked ${r.status} by hand on the Infrastructure page. At ${r.load}% load it would be ${auto} on its own.`;
    };
    const reg = ctx.kind === "region" && regions().find((r) => r.name === ctx.region);
    if (reg) return { h: explain(reg), c: suggestions() };
    const bad = regions().filter((r) => r.status !== "Healthy");
    if (bad.length) return { h: lines(bad.map(explain)), c: suggestions() };
    return { h: "Nothing to explain, every region is healthy. Ask about a specific region or incident and I'll tell you why.", c: suggestions() };
  }

  function more() {
    const reg = ctx.kind === "region" && regions().find((r) => r.name === ctx.region);
    if (reg) {
      const inc = openInc().filter((i) => (i.region || "").toLowerCase() === reg.name.toLowerCase());
      return { h: `${rowOf(reg)}<br>${plural(+reg.servers || 0, "server")} · ${esc(reg.region || "no location set")} · ${envName(reg.env)}.<br>${inc.length ? `Open incidents here: ${inc.map((i) => `<b>${esc(i.title)}</b>`).join(", ")}.` : "No open incidents tied to this region."}`, c: suggestions("regions") };
    }
    if (ctx.kind === "incidents") return openIncidents();
    if (ctx.kind === "tickets") return ticketSpecial("latest");
    if (ctx.kind === "uptime") return downtime();
    if (["regions", "latency", "status"].includes(ctx.kind)) return fleet("");
    return { h: "More on what? Ask me about a region, incidents, tickets or uptime first.", c: suggestions() };
  }

  function followUp(t) {
    let m;
    if (/^(why|why is that|why is it|how come|what caused (that|it)|what's wrong|whats wrong)\??$/.test(t)) return why();
    if (/^(tell me more|more|more details?|details|go on|elaborate|and\??)$/.test(t)) return more();
    if ((m = t.match(/^(?:and |what about |how about |and what about )(?:the )?(prod(?:uction)?|staging|stg)\b/))) {
      const env = /^prod/.test(m[1]) ? "prod" : "stg";
      const list = regions().filter((r) => r.env === env).sort((a, b) => b.load - a.load);
      topic("regions");
      return { h: list.length ? `${plural(list.length, "region")} in ${envName(env)}:<br>${lines(list.map(rowOf))}` : `No ${envName(env)} regions yet.`, c: suggestions("regions") };
    }
    return null;
  }

  const OPS = "above|over|more than|greater than|higher than|at least|below|under|less than|lower than|at most";
  // "regions with load above 70", "latency under 50ms"
  function numeric(t) {
    let f, op, n, m;
    if ((m = t.match(new RegExp("\\b(load|latency|servers)\\b\\D{0,20}?(" + OPS + ")\\s*(\\d+)")))) {
      f = m[1];
      op = m[2];
      n = +m[3];
    } else if ((m = t.match(new RegExp("\\b(" + OPS + ")\\s*(\\d+)\\s*(%|ms)?"))) && /\b(regions?|servers|load|latency)\b/.test(t)) {
      op = m[1];
      n = +m[2];
      f = m[3] === "ms" || /latency/.test(t) ? "latency" : /servers/.test(t) && !/load/.test(t) ? "servers" : "load";
    } else return null;
    const gt = /above|over|more|greater|higher|at least/.test(op);
    const incl = /at (least|most)/.test(op);
    const list = regions()
      .filter((r) => {
        const v = +r[f] || 0;
        return gt ? (incl ? v >= n : v > n) : incl ? v <= n : v < n;
      })
      .sort((a, b) => (gt ? b[f] - a[f] : a[f] - b[f]));
    topic("regions");
    const unit = f === "load" ? "% load" : f === "latency" ? "ms latency" : " servers";
    const word = gt ? (incl ? "at least" : "above") : incl ? "at most" : "below";
    return { h: list.length ? `${plural(list.length, "region")} ${word} ${n}${unit}:<br>${lines(list.map(rowOf))}` : `No regions ${word} ${n}${unit}.`, c: suggestions("regions") };
  }

  // A prioritised "what should I look at?" list built from everything Pulse can see.
  function insights() {
    topic("status");
    const s = settings();
    const rs = regions();
    const now = Date.now();
    const out = [];
    const crit = rs.filter((r) => r.status === "Critical");
    const warn = rs.filter((r) => r.status === "Degraded");
    const near = rs.filter((r) => r.status !== "Critical" && s.critical - r.load > 0 && s.critical - r.load <= 5);
    const bigInc = openInc().filter((i) => i.severity === "critical" || i.severity === "high");
    const old = openInc().filter((i) => now - i.startedAt > 864e5);
    const open = openTickets();
    const unassigned = open.filter((x) => !(x.assignee || "").trim()).length;
    const stale = open.filter((x) => now - x.openedAt > 7 * 864e5).length;
    const tm = PG.views.team() || [];
    const sla = PG.derive.uptimeSeries(range()).filter((v) => v < 99.9).length;
    if (crit.length) out.push(`<b>${plural(crit.length, "region")} critical</b>: ${names(crit)}. Start here.`);
    if (bigInc.length) out.push(`<b>${plural(bigInc.length, "high-severity incident")}</b> still open: ${bigInc.map((i) => esc(i.title)).join(", ")}.`);
    if (near.length) out.push(`${names(near)} ${near.length > 1 ? "are" : "is"} within 5 points of critical (${s.critical}%). Worth watching.`);
    if (warn.length) out.push(`${plural(warn.length, "region")} degraded: ${names(warn)}.`);
    if (old.length) out.push(`${plural(old.length, "incident")} open for over a day. Time for a status page update?`);
    if (tm.length && !tm.some((m) => m.oncall)) out.push("Nobody is on call. Set someone on the Team page.");
    else if (tm.length && !tm.some((m) => m.status === "online")) out.push("Nobody on the team is marked online.");
    if (unassigned) out.push(`${plural(unassigned, "open ticket")} ${unassigned === 1 ? "has" : "have"} no assignee.`);
    if (stale) out.push(`${plural(stale, "ticket")} ${stale === 1 ? "has" : "have"} been open over a week.`);
    if (sla) out.push(`${plural(sla, "day")} missed the 99.9% SLA in the last ${range()} days.`);
    if (!rs.length) out.push("No regions yet. Add one so I have something to watch.");
    if (!out.length) return { h: pick(["I looked hard and found nothing worth worrying about. Genuinely.", "Clean bill of health. No loose ends."], "ins"), c: suggestions("status") };
    return { h: `${pick(["Here's what I'd look at, in order:", "My priority list:", "Things worth your attention:"], "insb")}<br>${lines(out.slice(0, 5).map((x, i) => `${i + 1}. ${x}`))}`, c: suggestions("status") };
  }

  /* ---------- actions that change data (always ask first) ---------- */
  let pending = null;
  const CAT_HINTS = [
    ["Network", /vpn|wifi|wi-fi|network|internet|dns|router|switch|\blan\b/],
    ["Hardware", /laptop|printer|monitor|keyboard|mouse|hardware|disk|screen|battery/],
    ["Security", /phish|security|malware|virus|breach|suspicious/],
    ["Access", /password|login|log in|access|permission|account|locked|mfa|2fa/],
    ["Software", /software|install|update|licen[sc]e|crash|\bbug\b|excel|outlook/],
  ];
  const guessCat = (s) => (CAT_HINTS.find(([, re]) => re.test(s.toLowerCase())) || ["Other"])[0];
  const clean = (s) => s.replace(/^["'“”\s]+|["'“”.!\s]+$/g, "");
  const confirmCard = (h, run) => {
    pending = { run };
    return { h: h + "<br>Shall I go ahead?", c: ["Yes, do it", "Cancel"] };
  };
  function matchByWords(list, q) {
    const qw = new Set(words(q));
    if (!qw.size && !q) return list;
    return list
      .map((x) => ({ x, s: words(x.title || "").filter((w) => qw.has(w)).length + ((x.title || "").toLowerCase().includes(q.toLowerCase()) ? 3 : 0) }))
      .filter((o) => o.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((o) => o.x);
  }
  const which = (kind, hits) => ({ h: `Which one?<br>${lines(hits.slice(0, 5).map((x) => "· " + esc(x.title)))}<br>Say it again with a bit more of the name.`, c: suggestions() });

  function writeIntent(text) {
    let m;
    if ((m = text.match(/^(?:please\s+)?assign\s+(?:the\s+)?(?:ticket\s+)?(.+?)\s+to\s+(.+?)[.!]?$/i))) {
      const person = findMember(m[2].toLowerCase());
      if (!person) return { h: `I don't see "${esc(m[2])}" on the team. Add them on the Team page first.`, c: suggestions() };
      const hits = matchByWords(openTickets(), clean(m[1]));
      if (!hits.length) return { h: `I couldn't find an open ticket like "${esc(clean(m[1]))}".`, c: suggestions("tickets") };
      if (hits.length > 1) return which("ticket", hits);
      const x = hits[0];
      return confirmCard(`Assign <b>${esc(x.title)}</b> to <b>${esc(person.name)}</b>?`, async () => {
        await PG.store.update("tickets", x.id, { assignee: person.name });
        PG.ui.toast("Ticket assigned");
        return { h: `Done. <b>${esc(person.name)}</b> now owns <b>${esc(x.title)}</b>.`, c: suggestions("tickets") };
      });
    }
    if ((m = text.match(/^(?:please\s+)?(?:create|add|open|log|raise|new)\s+(?:a\s+|an\s+|new\s+)*ticket\s*(?:called|titled|named|for|about|:|-)?\s*(.{3,160})$/i))) {
      let title = m[1];
      let assignee = "";
      const am = title.match(/\s+(?:and\s+)?assign(?:ed)?(?:\s+it)?\s+to\s+(.+)$/i);
      if (am) {
        const person = findMember(am[1].toLowerCase());
        if (person) assignee = person.name;
        title = title.slice(0, am.index);
      }
      title = clean(title).slice(0, 120);
      if (title.length < 3) return null;
      const category = guessCat(title);
      return confirmCard(`Create ticket <b>${esc(title)}</b> (${category}, ${assignee ? "assigned to " + esc(assignee) : "unassigned"})?`, async () => {
        await PG.store.add("tickets", { title, category, status: "open", assignee, openedAt: Date.now(), resolvedAt: null });
        PG.ui.toast("Ticket added");
        return { h: `Done. Ticket <b>${esc(title)}</b> is in the queue.`, c: suggestions("tickets") };
      });
    }
    if ((m = text.match(/^(?:please\s+)?(?:create|add|open|log|raise|declare|new)\s+(?:a\s+|an\s+|new\s+)*(critical\s+|high\s+|medium\s+|low\s+)?incident\s*(?:called|titled|named|for|about|:|-)?\s*(.{3,160})$/i))) {
      let title = m[2];
      let severity = (m[1] || "").trim().toLowerCase();
      const sm = title.match(/[,\s]+(?:with\s+)?(critical|high|medium|low)(?:\s+severity)?$/i);
      if (sm) {
        severity = severity || sm[1].toLowerCase();
        title = title.slice(0, sm.index);
      }
      severity = severity || "medium";
      title = clean(title).slice(0, 120);
      if (title.length < 3) return null;
      const rg = regionNamed(title.toLowerCase());
      return confirmCard(`Log a <b>${severity}</b> incident: <b>${esc(title)}</b>${rg ? " in " + esc(rg.name) : ""}? It starts as Investigating and shows on the public status page.`, async () => {
        await PG.store.add("incidents", { title, severity, status: "investigating", region: rg ? rg.name : "", startedAt: Date.now(), downtime: 0, message: "", resolvedAt: null });
        PG.ui.toast("Incident logged");
        return { h: `Logged. <b>${esc(title)}</b> is open. Add a public update on the Incidents page when you're ready.`, c: suggestions("incidents") };
      });
    }
    if ((m = text.match(/^(?:please\s+)?(?:resolve|close)\s+(?:the\s+)?(incident|ticket)\b\s*(?:called|titled|named|:|-)?\s*(.*)$/i))) {
      const kind = m[1].toLowerCase();
      const q = clean(m[2]);
      const pool = kind === "incident" ? openInc() : openTickets();
      if (!pool.length) return { h: `There are no open ${kind}s to resolve.`, c: suggestions() };
      const hits = matchByWords(pool, q);
      if (!hits.length) return { h: `I couldn't find an open ${kind} like "${esc(q)}". Open ones:<br>${lines(pool.slice(0, 5).map((x) => "· " + esc(x.title)))}`, c: suggestions() };
      if (hits.length > 1) return which(kind, hits);
      const x = hits[0];
      const col = kind === "incident" ? "incidents" : "tickets";
      return confirmCard(`Mark ${kind} <b>${esc(x.title)}</b> as resolved?`, async () => {
        await PG.store.update(col, x.id, { status: "resolved", resolvedAt: Date.now() });
        PG.ui.toast(`${kind[0].toUpperCase() + kind.slice(1)} resolved`);
        return { h: pick(["Resolved. One less thing on the board.", "Done. Marked resolved."], "rs") + ` (<b>${esc(x.title)}</b>)`, c: suggestions() };
      });
    }
    return null;
  }

  /* ---------- small talk and easter eggs ---------- */
  const JOKES = [
    "Why did the server go to therapy? Too many unresolved dependencies.",
    "It's not DNS. There's no way it's DNS. It was DNS.",
    'A SQL query walks into a bar, sees two tables and asks: "Can I join you?"',
    "I'd tell you a UDP joke, but you might not get it.",
    "There are 10 kinds of people: those who understand binary and those who don't.",
    "My favourite uptime is the one nobody mentions in the stand-up.",
    "Why do sysadmins love autumn? Everything finally gets rebooted.",
    "A load balancer walks into a bar. Bartender says, \"Sorry, you'll have to wait, we're at capacity.\" It tries the next bar.",
    "Real programmers count from zero. Real ops people count from \"who touched prod?\".",
    "Why was the incident so calm? It had a really good runbook.",
    "Cloud storage is just someone else's computer with better marketing.",
    "I have a great joke about a firewall, but I can't get it through.",
  ];

  function chatter(t) {
    const c = suggestions();
    const m = mood();
    const R = (a, key) => ({ h: pick(a, key), c });
    if (/\b(joke|funny|make me laugh|humou?r)\b/.test(t))
      return { h: (m === "crit" ? pick(["Bad timing, but morale matters. ", "Fine, a quick one while the red thing cools down. "], "jl") : pick(["", "", "Okay, one. ", "Brace yourself. "], "jl2")) + esc(pick(JOKES)), c };
    if (/\b(who are you|your name|what are you)\b/.test(t))
      return R(["I'm <b>Pulse</b>, the dashboard's resident night owl. I watch your regions so you can blink.", "<b>Pulse</b>. Part heartbeat monitor, part librarian for this dashboard.", "I'm Pulse. I read the graphs so you don't have to squint."], "who");
    if (/\bare you (a |an )?(human|real|person|robot|bot|ai|alive)\b/.test(t))
      return R(["Not human, not quite a robot. Think of me as a very attentive heartbeat monitor with opinions.", "I'm software with good timing. Real enough to tell you when something's on fire.", "Alive-ish. I don't sleep, which HR says is a red flag."], "alive");
    if (/\b(love you|you('re| are) (great|awesome|the best|amazing|funny|cool|smart)|good bot|nice work|well done|great job)\b/.test(t))
      return R([`Stop it, ${esc(who())}, you'll make my load spike.`, 'Noted. I\'ll put that in the uptime report under "morale".', "Aw. Back to the graphs, then?", "Compliments accepted. Latency: unaffected.", `You're not so bad yourself, ${esc(who())}.`], "love");
    if (/\b(bad bot|you suck|useless|stupid|dumb|worst)\b/.test(t))
      return R(["Fair. Tell me what you were after and I'll do better.", 'Ouch. Try "help" and I\'ll show you what I\'m actually good at.', "Noted, and slightly wounded. What were you trying to find?"], "bad");
    if (/\b(coffee|tea|caffeine)\b/.test(t))
      return R(["Coffee is the real production dependency. Please don't deploy without it.", "I run on electricity and good vibes. You'll have to drink the coffee for both of us.", "Strong coffee, strong uptime. That's the law."], "coffee");
    if (/\bmeaning of life\b/.test(t)) return R(["42 regions, zero incidents. Or so the legend says.", "Five nines and a quiet pager."], "mol");
    if (/\b(bored|nothing to do)\b/.test(t))
      return { h: m === "calm" ? pick(["Boring is the goal in ops. Enjoy it while it lasts. Want a joke?", "Quiet shift. Want me to quiz you on your own dashboard?"], "bored") : "Bored? Not with that on the board. Ask me which regions need attention.", c };
    if (/\b(tired|exhausted|long day|stressed|burn(ed|t) out|overwhelmed)\b/.test(t))
      return { h: m === "crit" ? "I hear you. Let's get this one sorted, then take a proper break. Want the rundown?" : pick(["Rough day? Everything looks steady from here, so take a breath. I've got the watch.", "Go stretch, drink some water. I'll flag anything that matters."], "tired"), c };
    if (/^(ping)\b/.test(t)) return { h: `Pong. ${Math.round(PG.panels.kpi.get("response"))}ms average across your regions, ${pick(["for what it's worth.", "I timed it myself.", "tell no one I'm bragging."], "pong")}`, c };
    if (/\b(what('s| is) (the )?time|what time is it|current time)\b/.test(t)) return { h: `It's <b>${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</b> on your clock. Time flies when everything's green.`, c };
    if (/\b(what('s| is) (the )?(date|day) )|\btoday'?s date\b/.test(t)) return { h: `Today is <b>${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</b>.`, c };
    if (/\b(do you sleep|are you (asleep|sleeping)|you there|are you there)\b/.test(t)) return R(["Never. Sleep is for processes that can be restarted.", "Right here. Always here. A little unnerving, I know.", "Awake and watching the graphs."], "sleep");
    if (/\b(favou?rite (colou?r|region|metric))\b/.test(t))
      return R(["Cyan, obviously. It's practically the brand.", "I try not to play favourites, but the healthiest region gets a quiet nod.", "Uptime. It's the only metric that likes being boring."], "fav");
    if (/\b(sing|song|rap|poem|haiku)\b/.test(t))
      return R(["Load is low, latency's light, pager sleeps tonight. (That's my haiku. I'll be here all week.)", "Ninety-nine point nine, a number I hum all day long. Okay, that's all I've got."], "sing");
    if (/\b(knock knock)\b/.test(t)) return R(["Who's there? ...Timeout. Sorry, retry in 30 seconds.", "Who's there? Your SLA. SLA who? SLA-ready to be breached if you don't fix that."], "knock");
    if (/\b(sorry|my bad|oops)\b/.test(t)) return R(["No need. Nothing here that a refresh can't fix.", "All good. We don't do blame, only post-mortems.", "No harm done."], "sorry");
    if (/^(lol|haha|hehe|lmao|nice|cool|ok|okay|great|awesome|wow)\b/.test(t) && t.length < 16)
      return R(["Glad you liked it.", "Always.", "Ha. Anything else on your mind?", "Good. What's next?"], "ack");
    if (/\bwhat('s| is) up\b|\bwassup\b|\bsup\b/.test(t))
      return { h: m === "calm" ? "Mostly uptime. You?" : m === "warn" ? "A few amber lights, nothing dramatic. You?" : "A red region, honestly. Want the rundown?", c };
    if (/\b(rate|review|roast)\b.*\b(dashboard|setup|system|infra\w*)\b/.test(t)) {
      const rs = regions();
      return { h: !rs.length ? "Can't rate an empty dashboard. Add a region and I'll give you a verdict." : m === "calm" ? `${plural(rs.length, "region")}, all healthy. I'd give it a solid <b>9 out of 10</b>. The missing point is for tempting fate.` : m === "warn" ? `Decent. A couple of amber lights keep it at a <b>7 out of 10</b>.` : `Right now? A <b>4 out of 10</b>, and that's being kind. Fix the red and I'll re-score.`, c };
    }
    return null;
  }

  function findRegion(t) {
    const stg = /\b(staging|stg)\b/.test(t);
    const city = (r) => (r.region || "").replace(/\(.*\)/, "").replace(/^n\.\s*/i, "").trim().toLowerCase();
    return regions()
      .filter((r) => stg === (r.env === "stg") || t.includes(r.name.toLowerCase()))
      .sort((a, b) => b.name.length - a.name.length)
      .find((r) => t.includes(r.name.toLowerCase()) || (city(r) && t.includes(city(r))));
  }
  const regionNamed = (t) => regions().find((r) => t.includes(r.name.toLowerCase()));
  const words = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  function findIncident(t) {
    const tw = new Set(words(t));
    return DATA().incidents.find((i) => {
      const title = (i.title || "").toLowerCase();
      return (title && t.includes(title)) || words(title).filter((w) => tw.has(w)).length >= 2;
    });
  }
  function findMember(t) {
    return (PG.views.team() || []).find((m) => {
      const n = m.name.toLowerCase();
      const first = n.split(/\s+/)[0];
      return t.includes(n) || (first.length > 2 && new RegExp("\\b" + escRe(first) + "\\b").test(t));
    });
  }

  /* ---------- voice: speaking (text-to-speech) ---------- */
  const TTS = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  let voices = [];
  let speakId = 0;
  function loadVoices() {
    if (!TTS) return;
    voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
  }
  if (TTS) {
    loadVoices();
    speechSynthesis.addEventListener && speechSynthesis.addEventListener("voiceschanged", loadVoices);
  }
  function chooseVoice() {
    if (mem.voiceName) {
      const saved = voices.find((v) => v.name === mem.voiceName);
      if (saved) return saved;
    }
    const rank = (v) =>
      (/natural|neural|online/i.test(v.name) ? 4 : 0) +
      (/google us english|samantha|aria|jenny|ava|zira/i.test(v.name) ? 3 : 0) +
      (v.lang === "en-US" ? 2 : 0) +
      (v.localService ? 1 : 0);
    return voices.slice().sort((a, b) => rank(b) - rank(a))[0] || null;
  }
  function cycleVoice() {
    if (!TTS || voices.length < 2) return null;
    const i = voices.indexOf(chooseVoice());
    const next = voices[(i + 1) % voices.length];
    mem.voiceName = next.name;
    write(MEM_KEY, mem);
    return next;
  }
  function toSpeech(html) {
    const doc = new DOMParser().parseFromString(String(html).replace(/<br\s*\/?>/gi, ". "), "text/html");
    return (doc.body.textContent || "")
      .replace(/(\d)\s?ms\b/g, "$1 milliseconds")
      .replace(/·/g, ",")
      .replace(/\s+/g, " ")
      .replace(/([.!?])\s*\./g, "$1")
      .trim();
  }
  const setSpeaking = (on) => el.panel && el.panel.classList.toggle("is-speaking", on);
  function stopSpeaking() {
    if (!TTS) return;
    speakId++;
    speechSynthesis.cancel();
    setSpeaking(false);
  }
  function speak(html) {
    if (!TTS) return;
    stopSpeaking();
    const text = toSpeech(html);
    if (!text) return;
    const parts = (text.match(/[^.!?]+[.!?]*/g) || [text]).map((p) => p.trim()).filter(Boolean);
    const voice = chooseVoice(); // may be null in Brave with fingerprint protection; the default voice is used then
    const id = speakId;
    const rate = mood() === "crit" ? 1.1 : 1;
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.rate = rate;
      u.pitch = 1;
      if (i === 0) u.onstart = () => id === speakId && setSpeaking(true);
      if (i === parts.length - 1) u.onend = u.onerror = () => id === speakId && setSpeaking(false);
      speechSynthesis.speak(u);
    });
  }

  const ICON = {
    on: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 11a7 7 0 0 1-14 0"/><line x1="12" y1="18" x2="12" y2="22"/></svg>',
  };
  function paintVoice() {
    if (!el.voice) return;
    el.voice.innerHTML = mem.voice ? ICON.on : ICON.off;
    el.voice.setAttribute("aria-pressed", String(!!mem.voice));
    const label = mem.voice ? "Voice on. Click to mute Pulse" : "Voice off. Click to let Pulse speak";
    el.voice.title = label;
    el.voice.setAttribute("aria-label", label);
  }
  function setVoice(on, announce) {
    mem.voice = !!on;
    write(MEM_KEY, mem);
    paintVoice();
    if (!on) stopSpeaking();
    else if (announce) speak("Voice on. I'll read my replies aloud.");
  }

  /* ---------- voice: listening (speech recognition) ----------
     Disabled in Brave: it exposes the API but ships without Google's speech service, so it always fails. */
  const SR = IS_BRAVE ? null : window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let listening = false;
  let discardHeard = false;
  function paintMic() {
    if (!el.mic) return;
    el.mic.classList.toggle("listening", listening);
    el.mic.setAttribute("aria-pressed", String(listening));
    const label = listening ? "Stop listening" : "Talk to Pulse";
    el.mic.title = label;
    el.mic.setAttribute("aria-label", label);
    el.input.placeholder = listening ? "Listening…" : PLACEHOLDER;
  }
  function stopListening(discard) {
    if (!rec || !listening) return;
    discardHeard = !!discard;
    try {
      discard ? rec.abort() : rec.stop();
    } catch (_) {}
  }
  function startListening() {
    if (!SR || busy) return;
    if (listening) return stopListening(false);
    stopSpeaking();
    let heard = "";
    discardHeard = false;
    rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => {
      listening = true;
      paintMic();
    };
    rec.onresult = (e) => {
      let finalText = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      heard = (finalText + " " + interim).trim();
      el.input.value = heard;
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") PG.ui.toast("Microphone is blocked. Allow it in your browser's site settings.");
      else if (e.error === "no-speech") PG.ui.toast("I didn't hear anything.");
      else if (e.error === "network") PG.ui.toast("Voice input needs an internet connection and a browser with speech support.");
      else if (e.error !== "aborted") PG.ui.toast("Voice input isn't working right now.");
    };
    rec.onend = () => {
      listening = false;
      paintMic();
      const text = heard.trim();
      if (discardHeard || !text) {
        if (discardHeard) el.input.value = "";
        return;
      }
      send(text, true);
    };
    try {
      rec.start();
    } catch (_) {
      listening = false;
      paintMic();
    }
  }

  /* ---------- Gemini (Firebase AI Logic) ----------
     Loaded lazily. Wrapped in a timeout so a blocked request (Brave Shields, ad blockers,
     offline) fails fast and Pulse falls back to its built-in knowledge. */
  const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/12.0.0/";
  const GEMINI_MODEL = "gemini-2.5-flash";
  const RECAPTCHA_SITE_KEY = "6LcGPx8uAAAAAA4lAtNX_xIyuzfMVtoa_CcxJJ-y";
  let modelPromise;
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

  function systemNotes() {
    return KB.map((e) => toSpeech(kbText(e))).join(" ");
  }
  function getModel() {
    if (!modelPromise) {
      modelPromise = (async () => {
        const { initializeApp } = await import(FIREBASE_SDK + "firebase-app.js");
        const { getAI, getGenerativeModel, GoogleAIBackend } = await import(FIREBASE_SDK + "firebase-ai.js");
        const app = initializeApp(window.FIREBASE_CONFIG, "gemini");
        const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import(FIREBASE_SDK + "firebase-app-check.js");
        if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
        const ai = getAI(app, { backend: new GoogleAIBackend() });
        return getGenerativeModel(ai, {
          model: GEMINI_MODEL,
          systemInstruction:
            "You are Pulse, a calm, warm, dry-witted assistant inside an IT operations dashboard called Pulsegrid. " +
            "You can answer any question about the system: its live data (the JSON provided), and how the app works (the notes below). " +
            "Use ONLY the JSON data and the notes; if neither contains the answer, say so honestly and suggest where in the app to look. " +
            "Answer in at most 5 short sentences. You may add one light, friendly quip, but never joke when a region is Critical or an incident is open. " +
            "Your reply may be read aloud, so write plain sentences with no lists, symbols or odd abbreviations. Plain text, no markdown. " +
            "How the app works: " + systemNotes(),
        });
      })();
      modelPromise.catch(() => (modelPromise = null));
    }
    return modelPromise;
  }

  // Summary of the dashboard sent to Gemini. Ticket titles and assignees are left out on purpose.
  function dashboardContext() {
    const D = PG.derive;
    const d = DATA();
    return JSON.stringify({
      user: settings().name,
      now: new Date().toString(),
      rangeDays: range(),
      environmentFilter: PG.getState().env,
      thresholds: { degradedAt: settings().warn, criticalAt: settings().critical },
      kpis: {
        uptimePct: PG.panels.kpi.get("uptime"),
        servers: PG.panels.kpi.get("servers"),
        avgResponseMs: PG.panels.kpi.get("response"),
        ticketsResolvedInRange: PG.panels.kpi.get("resolved"),
        openTickets: PG.panels.kpi.get("open"),
      },
      regions: regions().map((r) => ({ name: r.name, location: r.region, env: r.env, servers: r.servers, load: r.load, latency: r.latency, status: r.status })),
      openIncidents: openInc().map((i) => ({ title: i.title, severity: i.severity, status: i.status, region: i.region, startedMinutesAgo: Math.round((Date.now() - i.startedAt) / 60000) })),
      recentIncidents: d.incidents.slice().sort((a, b) => b.startedAt - a.startedAt).slice(0, 8).map((i) => ({ title: i.title, severity: i.severity, status: i.status, downtimeMin: +i.downtime || 0 })),
      incidentsBySeverity: D.severity(range()),
      ticketsByCategory: D.tickets(range()),
      unassignedOpenTickets: d.tickets.filter((t) => t.status !== "resolved" && !(t.assignee || "").trim()).length,
      team: (PG.views.team() || []).map((m) => ({ name: m.name, role: m.role, status: m.status, oncall: m.oncall, openTickets: m.tickets })),
    });
  }

  async function askGemini(text) {
    const hist = log.slice(-7, -1).map((m) => (m.r === "u" ? "User: " : "Pulse: ") + toSpeech(m.h)).join("\n");
    const run = async () => {
      const model = await getModel();
      const res = await model.generateContent(`Dashboard data:\n${dashboardContext()}\n\nRecent chat:\n${hist || "(none)"}\n\nQuestion: ${text}`);
      return esc(res.response.text().trim()).replace(/\n/g, "<br>");
    };
    return withTimeout(run(), 12000);
  }

  /* ---------- answers (each returns { h, c? }) ---------- */
  function greeting() {
    const hr = new Date().getHours();
    const part = hr < 5 ? "Working late" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
    const away = mem.lastOpen && Date.now() - mem.lastOpen > 12 * 3600e3;
    const rs = regions();
    const crit = rs.filter((r) => r.status === "Critical");
    const warn = rs.filter((r) => r.status === "Degraded");
    const mine = me();
    let h = `${away ? pick(["Welcome back", "Good to see you again", "Look who's back"], "wb") + ", " : part + ", "}<b>${esc(who())}</b>.`;
    if (hr < 5) h += " The graphs never sleep, so neither do I.";
    if (mine && mine.oncall) h += " You're on call right now. May the pager be quiet.";
    h += "<br>";
    if (crit.length) h += pick([`Heads-up: ${names(crit)} ${crit.length > 1 ? "are" : "is"} critical. Let's go.`, `First things first: ${names(crit)} ${crit.length > 1 ? "need" : "needs"} you.`], "gcrit");
    else if (warn.length) h += pick([`${plural(warn.length, "region")} degraded, nothing critical. Just a little grumpy.`, `${plural(warn.length, "region")} running amber. Not an emergency, but worth a look.`], "gwarn");
    else if (openInc().length) h += `No region trouble, but ${plural(openInc().length, "incident")} still open.`;
    else if (!rs.length) h += "No regions yet. Add one under Infrastructure and I'll start watching.";
    else h += pick(["All regions look healthy. Suspiciously calm.", "Everything is green. I love it when that happens.", "All regions healthy. Quiet shift so far.", "Not a single amber light. Enjoy it."], "gcalm");
    if (mine && mine.tickets) h += ` You have ${plural(mine.tickets, "open ticket")}.`;
    const since = mem.lastOpen && Date.now() - mem.lastOpen > 2 * 3600e3 ? mem.lastOpen : 0;
    if (since) {
      const d = DATA();
      const bits = [];
      const add = (n, w) => n && bits.push(plural(n, w));
      add(d.incidents.filter((i) => i.startedAt > since).length, "new incident");
      add(d.incidents.filter((i) => i.resolvedAt > since).length, "incident resolved");
      add(d.tickets.filter((x) => x.openedAt > since).length, "new ticket");
      add(d.tickets.filter((x) => x.resolvedAt > since).length, "ticket resolved");
      if (bits.length) h += `<br>Since you were last here: ${bits.join(", ")}.`;
    }
    return { h, c: suggestions() };
  }

  function status() {
    topic("status");
    const rs = regions();
    const crit = rs.filter((r) => r.status === "Critical");
    const warn = rs.filter((r) => r.status === "Degraded");
    const k = PG.panels.kpi;
    const lead = {
      crit: pick(["Not ideal. ", "Okay, deep breath. ", "We have a situation. "], "sc"),
      warn: pick(["Mostly fine, a bit grumpy. ", "Fine, with caveats. ", "Steady, but keep an eye out. "], "sw"),
      calm: pick(["Smooth sailing. ", "All quiet. ", "Looking good. ", "Green across the board. "], "sk"),
    }[mood()];
    let h =
      lead +
      (crit.length
        ? `<b>${plural(crit.length, "region")} critical</b>: ${names(crit)}.`
        : warn.length
          ? `No critical regions, but <b>${plural(warn.length, "region")} degraded</b>: ${names(warn)}.`
          : rs.length ? `All <b>${rs.length}</b> regions are healthy.` : "There are no regions yet.");
    const oi = openInc();
    if (oi.length) h += ` ${plural(oi.length, "incident")} open.`;
    h += `<br>Uptime ${k.get("uptime")}% · response ${Math.round(k.get("response"))}ms · ${plural(k.get("open"), "open ticket")}.`;
    return { h, c: suggestions("status") };
  }

  function attention() {
    topic("regions");
    const bad = regions().filter((r) => r.status !== "Healthy").sort((a, b) => b.load - a.load);
    if (!bad.length) {
      const top = regions().sort((a, b) => b.load - a.load)[0];
      if (!top) return { h: "No regions yet. Add one under Infrastructure and I'll start watching.", c: suggestions("regions") };
      return { h: `${pick(["Nothing needs attention. Enjoy it.", "All clear, nothing on fire.", "Nobody's misbehaving.", "Every region is behaving."], "att")} The busiest is ${rowOf(top)}.`, c: suggestions("regions") };
    }
    return { h: pick(["These need a look:", "Here's who's misbehaving:", "On my radar:"], "attb") + "<br>" + lines(bad.map(rowOf)), c: ["Export CSV", ...suggestions("regions", 2)] };
  }

  function latency() {
    topic("latency");
    const slow = regions().sort((a, b) => b.latency - a.latency).slice(0, 3);
    if (!slow.length) return { h: "No regions to measure yet.", c: suggestions("latency") };
    return {
      h: `${pick(["Slowest regions:", "The sluggish end of the fleet:", "Top of the latency chart (not the good kind):"], "lat")}<br>${lines(slow.map(rowOf))}<br>Average response time is ${Math.round(PG.panels.kpi.get("response"))}ms.${spice(["Not bad for a bunch of boxes.", "Speedy enough."], ["Could be snappier."])}`,
      c: suggestions("latency"),
    };
  }

  function regionDetail(r) {
    topic("regions");
    ctx.region = r.name;
    ctx.kind = "region";
    const gap = settings().critical - r.load;
    const room = gap > 0 ? `${gap} points below your critical threshold (${settings().critical}%)` : `above your critical threshold (${settings().critical}%)`;
    return { h: `${rowOf(r)}<br>${esc(r.region)}, ${r.env === "prod" ? "production" : "staging"}, ${plural(+r.servers || 0, "server")}. Load is ${room}.${spice(["Well-behaved.", "No complaints from this one."], ["Keep an eye on it."])}`, c: ["Tell me more", "Why is that?", ...suggestions("regions", 1)] };
  }

  function uptime() {
    topic("uptime");
    const s = PG.derive.uptimeSeries(range());
    const avg = sum(s) / s.length;
    const below = s.filter((v) => v < 99.9).length;
    return {
      h: `${pick(["Over the last", "Across the last", "Looking back"], "up")} ${range()} days, uptime averaged <b>${avg.toFixed(3)}%</b>. Lowest day: ${Math.min(...s).toFixed(2)}%. ${plural(below, "day")} below the 99.9% SLA.${spice(["Nicely done.", "Boring, in the best way."], ["Room to tighten up."])}`,
      c: suggestions("uptime"),
    };
  }

  function incidents() {
    topic("incidents");
    const d = PG.derive.severity(range()).map((x) => ({ l: x.label, v: x.value }));
    return {
      h: `<b>${sum(d.map((x) => x.v))}</b> incidents in the last ${range()} days:<br>${lines(d.map((x) => `${x.l}: ${x.v}`))}<br>${plural(PG.panels.kpi.get("incidents"), "incident")} active right now.`,
      c: suggestions("incidents"),
    };
  }

  function openIncidents() {
    topic("incidents");
    const oi = openInc().sort((a, b) => b.startedAt - a.startedAt);
    if (!oi.length) return { h: pick(["No open incidents. The board is clean.", "Zero active incidents. Savour it.", "Nothing open right now."], "oi"), c: suggestions("incidents") };
    return { h: `${plural(oi.length, "open incident")}:<br>${lines(oi.map((i) => `<b>${esc(i.title)}</b> · ${SEV_LABEL[i.severity] || esc(i.severity)} · ${esc(i.status)}${i.region ? " · " + esc(i.region) : ""} · ${ago(i.startedAt)}`))}`, c: suggestions("incidents") };
  }

  function incidentDetail(i) {
    topic("incidents");
    return { h: `<b>${esc(i.title)}</b> · ${SEV_LABEL[i.severity] || esc(i.severity)} · ${esc(i.status)}<br>Started ${ago(i.startedAt)}${i.region ? " in " + esc(i.region) : ""}, ${+i.downtime || 0} min of downtime recorded.${i.message ? `<br>Public update: ${esc(i.message)}` : ""}`, c: suggestions("incidents") };
  }

  function downtime() {
    topic("uptime");
    const list = PG.derive.incidents(range());
    const total = sum(list.map((i) => +i.downtime || 0));
    const worst = list.slice().sort((a, b) => (+b.downtime || 0) - (+a.downtime || 0))[0];
    if (!list.length) return { h: `No incidents in the last ${range()} days, so zero recorded downtime.`, c: suggestions("uptime") };
    return { h: `<b>${total} minutes</b> of downtime across ${plural(list.length, "incident")} in the last ${range()} days.${worst && +worst.downtime ? ` The worst was <b>${esc(worst.title)}</b> at ${worst.downtime} min.` : ""}`, c: suggestions("uptime") };
  }

  function tickets() {
    topic("tickets");
    const d = PG.derive.tickets(range()).map((x) => ({ l: x.label, v: x.value }));
    const total = sum(d.map((x) => x.v));
    const top = d.reduce((a, b) => (b.v > a.v ? b : a));
    return {
      h: `<b>${total.toLocaleString("en-US")}</b> tickets in the last ${range()} days. ${total ? `${top.l} leads with ${top.v} (${Math.round((top.v / total) * 100)}%).` : "None have been logged yet."} ${plural(PG.derive.openTickets(), "ticket")} open overall, ${PG.derive.resolved(range())} resolved in this range.${spice(["The queue is behaving.", "Helpdesk is coping."], ["Hang in there, helpdesk."])}`,
      c: suggestions("tickets"),
    };
  }

  function ticketSpecial(t) {
    topic("tickets");
    const open = DATA().tickets.filter((x) => x.status !== "resolved");
    if (/\bunassigned\b/.test(t)) {
      const n = open.filter((x) => !(x.assignee || "").trim());
      return { h: n.length ? `${plural(n.length, "open ticket")} ${n.length === 1 ? "has" : "have"} nobody assigned. Assign them on the Tickets page.` : "Every open ticket has an owner. Tidy.", c: suggestions("tickets") };
    }
    const oldest = open.slice().sort((a, b) => a.openedAt - b.openedAt)[0];
    if (/\b(oldest|longest|stale)\b/.test(t))
      return { h: oldest ? `The oldest open ticket is <b>${esc(oldest.title)}</b>, opened ${ago(oldest.openedAt)}${oldest.assignee ? ", assigned to " + esc(oldest.assignee) : ", unassigned"}.` : "No open tickets, so nothing is going stale.", c: suggestions("tickets") };
    const latest = DATA().tickets.slice().sort((a, b) => b.openedAt - a.openedAt)[0];
    return { h: latest ? `The newest ticket is <b>${esc(latest.title)}</b> (${esc(latest.category || "Other")}), opened ${ago(latest.openedAt)}, currently ${esc(latest.status)}.` : "No tickets logged yet.", c: suggestions("tickets") };
  }

  function team() {
    topic("team");
    const t = PG.views.team() || [];
    if (!t.length) return { h: "Nobody's on the team yet. Add people on the Team page.", c: suggestions("team") };
    const oncall = t.find((m) => m.oncall);
    const online = t.filter((m) => m.status === "online");
    const busiest = t.slice().sort((a, b) => b.tickets - a.tickets)[0];
    let h = oncall ? `<b>${esc(oncall.name)}</b> is on call${oncall.name.toLowerCase() === settings().name.trim().toLowerCase() ? " (that's you)" : ""}.` : "Nobody is on call. You can set one on the Team page.";
    h += `<br>${online.length} of ${t.length} online.`;
    if (busiest && busiest.tickets) h += ` ${esc(busiest.name)} has the most open tickets (${busiest.tickets}).`;
    return { h, c: suggestions("team") };
  }

  function memberDetail(m) {
    topic("team");
    return { h: `<b>${esc(m.name)}</b> · ${esc(m.role)} · ${esc(m.status)}${m.oncall ? " · on call" : ""}<br>${plural(m.tickets, "open ticket")} assigned.`, c: suggestions("team") };
  }

  function fleet(t) {
    topic("regions");
    const rs = regions();
    if (!rs.length) return { h: "No regions yet. Add one under Infrastructure.", c: suggestions("regions") };
    const sv = sum(rs.map((r) => +r.servers || 0));
    const avg = Math.round(sum(rs.map((r) => +r.load || 0)) / rs.length);
    const top = rs.slice().sort((a, b) => b.load - a.load)[0];
    const low = rs.slice().sort((a, b) => a.load - b.load)[0];
    const big = rs.slice().sort((a, b) => (+b.servers || 0) - (+a.servers || 0))[0];
    const prod = rs.filter((r) => r.env === "prod");
    const stg = rs.filter((r) => r.env === "stg");
    if (/\b(compare|versus|vs|difference)\b/.test(t) && prod.length && stg.length) {
      const av = (a) => Math.round(sum(a.map((r) => +r.load || 0)) / a.length);
      return { h: `Production: ${plural(prod.length, "region")}, ${av(prod)}% average load.<br>Staging: ${plural(stg.length, "region")}, ${av(stg)}% average load.`, c: suggestions("regions") };
    }
    return { h: `<b>${plural(rs.length, "region")}</b> (${prod.length} production, ${stg.length} staging) with <b>${sv.toLocaleString("en-US")}</b> servers. Average load is ${avg}%.<br>Busiest: ${rowOf(top)}<br>Quietest: ${rowOf(low)}<br>Most servers: <b>${esc(big.name)}</b> (${+big.servers || 0}).`, c: suggestions("regions") };
  }

  function activity() {
    const items = PG.panels.feed.recent(4);
    return { h: items.length ? lines(items.map((i) => `${i.time} · ${i.text}`)) : "Nothing in the feed yet. Add an incident or ticket and it'll show up.", c: suggestions() };
  }

  function thresholds() {
    const s = settings();
    return { h: `Degraded at <b>${s.warn}%</b> load, critical at <b>${s.critical}%</b>. Say "set critical to 90" and I'll change it, or use Settings.`, c: suggestions() };
  }

  function aboutMe() {
    const mine = me();
    const top = Object.entries(mem.topics).sort((a, b) => b[1] - a[1])[0];
    let h = `You're <b>${esc(settings().name)}</b>.`;
    if (mine) h += ` Role: ${esc(mine.role)}${mine.oncall ? ", currently on call" : ""}, ${plural(mine.tickets, "open ticket")}.`;
    if (mem.count) h += ` You've sent me ${plural(mem.count, "message")} so far.`;
    if (top) h += `<br>You ask about <b>${esc(top[0])}</b> most, so I list it first in quick replies.`;
    h += `<br>My memory of you stays in this browser. Say "clear chat" to wipe the conversation.`;
    h += `<br>For open-ended questions, a summary of your dashboard data (never ticket titles) is processed by an AI service.`;
    if (SR) h += `<br>If you use the microphone, your browser's speech service may process the audio. It only listens while the mic button is on.`;
    return { h };
  }

  const HELP = () => ({
    h: `Ask me anything about the system: live numbers (regions, latency, uptime, incidents, tickets, the team) or how something works ("how is uptime calculated?", "how do I invite an admin?", "what does Degraded mean?"). I can also do things:<br>
      · "Show last 7 days" or "switch to staging"<br>
      · "Open reports" · "Set critical to 90"<br>
      · "Any insights?" · "Which regions have load above 70?" · "What about staging?"<br>
      · "Create ticket VPN drops hourly" · "Log incident API errors, high severity" · "Resolve incident API errors" · "Assign VPN drops to Sam" (I always ask before changing anything)<br>
      · "Pause the feed" · "Export CSV" · "Refresh"<br>
      · "Tell me a joke" · "Rate my dashboard"<br>
      ${TTS ? `· "Unmute" · "Mute" · "Change voice"<br>` : ""}
      ${SR ? `· Tap the mic and just talk to me<br>` : IS_BRAVE ? `· (Mic input isn't available in Brave, but typing works great)<br>` : ""}
      · "Call me Sam"`,
  });

  /* ---------- actions (may combine: "switch to staging and show 7 days") ---------- */
  let justMuted = false;
  function actions(text, t) {
    const notes = [];
    let m;
    let done = false;
    const A = PG.actions;
    const S = PG.settings;

    if ((m = text.match(/\b(?:call me|my name is|i am called|i'm called)\s+([^.!?\n]{1,40})/i))) {
      S.set({ name: m[1].trim() });
      notes.push(pick([`Got it, I'll call you <b>${esc(who())}</b>.`, `<b>${esc(who())}</b> it is. Nice to properly meet you.`], "nm"));
      done = true;
    }
    if (/\b(unmute|talk to me|turn on (the )?voice|voice on|read (your )?(answers|replies) (out|aloud)|speak to me)\b/.test(t)) {
      if (!TTS) notes.push("This browser can't do speech, so I'll stay text only.");
      else {
        setVoice(true, false);
        notes.push("Voice on. I'll read my replies aloud.");
      }
      done = true;
    } else if (/\b(mute|be quiet|stop talking|turn off (the )?voice|voice off|silence)\b/.test(t)) {
      justMuted = true;
      setVoice(false);
      notes.push(pick(["Voice off. I'll stay quiet.", "Muted. Shh."], "mu"));
      done = true;
    } else if (/\b(change|switch|different|another|new)\b.*\bvoice\b/.test(t)) {
      if (!TTS) notes.push("This browser can't do speech, so I'll stay text only.");
      else {
        const v = cycleVoice();
        if (!v) notes.push("That's the only English voice this browser has, I'm afraid.");
        else {
          setVoice(true, false);
          notes.push(`Voice changed to <b>${esc(v.name)}</b>. How do I sound?`);
        }
      }
      done = true;
    }
    if (/\b(show|switch|change|set|use|view|select|filter)\b/.test(t) && !/\b(thresholds?|critical|degraded)\b/.test(t) && (m = t.match(/\b(7|30|90)\s*-?\s*d|\b(week|month|quarter)\b/))) {
      const days = m[1] ? +m[1] : { week: 7, month: 30, quarter: 90 }[m[2]];
      A.setRange(days);
      notes.push(`Range set to the last <b>${days} days</b>.`);
    }
    if (/\b(show|switch|filter|view|use|only)\b/.test(t) && (m = t.match(/\b(prod(?:uction)?|staging|stg|all env\w*)/))) {
      const env = /^prod/.test(m[1]) ? "prod" : /^(staging|stg)/.test(m[1]) ? "stg" : "all";
      A.setEnv(env);
      notes.push(`Showing <b>${esc(PG.environments[env].toLowerCase())}</b>.`);
    }
    if ((m = t.match(/\b(?:go to|open|take me to|navigate to)\s+(?:the\s+)?(overview|infrastructure|incidents|tickets|reports|team|admins|settings)/))) {
      PG.ui.navTo(m[1][0].toUpperCase() + m[1].slice(1));
      notes.push(pick([`Opened <b>${esc(m[1])}</b>.`, `Taking you to <b>${esc(m[1])}</b>.`], "go"));
      done = true;
    }
    if (/\b(set|change|raise|lower|make|move|update)\b/.test(t) && (m = t.match(/\b(critical|degraded|warning|warn)\b[^0-9]{0,30}(\d{2})\s*%?/))) {
      S.set(/^crit/.test(m[1]) ? { critical: +m[2] } : { warn: +m[2] });
      const s = settings();
      notes.push(`Thresholds are now degraded at <b>${s.warn}%</b> and critical at <b>${s.critical}%</b>.`);
      done = true;
    }
    if ((m = t.match(/\b(?:turn|switch)\s+(on|off)\b.*?(feed alerts?|pop-?ups?|toasts?|alerts?)/))) {
      const on = m[1] === "on";
      const key = /feed/.test(m[2]) ? "feedAlerts" : "toasts";
      S.set({ [key]: on });
      notes.push(`${{ feedAlerts: "Alerts in the activity feed", toasts: "Pop-up alerts" }[key]} turned <b>${on ? "on" : "off"}</b>.`);
    }
    if (/\b(pause|stop|freeze)\b.*\bfeed\b/.test(t)) {
      PG.panels.feed.setPaused(true);
      notes.push("Feed paused.");
    } else if (/\b(resume|unpause|restart|start)\b.*\bfeed\b/.test(t)) {
      PG.panels.feed.setPaused(false);
      notes.push("Feed resumed.");
    }
    if (/\b(refresh|sync now|update now|reload data)\b/.test(t)) {
      A.refresh();
      notes.push("Dashboard refreshed. Data updates live anyway.");
    }
    if (/^(please )?(export|download)\b.*\bcsv\b|^export\b/.test(t)) notes.push(`Exported <b>${PG.panels.exportCsv()}</b> regions to CSV.`);
    return { notes, done };
  }

  /* ---------- routing ---------- */
  const kbAnswer = (e) => ({ h: kbText(e), c: suggestions("howto") });

  function answer(t) {
    let r;
    if (/\bhow are you\b|\bhow('s| is) it going\b/.test(t))
      return {
        h: {
          calm: pick(["Running smoothly. Heartbeat steady. What do you want to check?", "Doing great. Zero drama on my side."], "hay"),
          warn: "A little busy keeping an eye on the amber stuff, but good.",
          crit: "Busy. Ask me again once that red region is sorted.",
        }[mood()],
        c: suggestions(),
      };
    if (/\b(who am i|about me|what do you (know|remember))\b/.test(t)) return aboutMe();
    if (/^(help|\/help|commands)\b|\b(what can you (do|help)|what do you do|how do i use you)\b/.test(t)) return { ...HELP(), c: suggestions() };
    if (/^(thanks|thank you|thx|cheers|ty)\b/.test(t))
      return {
        h: pick([`Any time, ${esc(who())}.`, "Happy to help. That's what the heartbeat is for.", "You got it.", `Anytime. Go enjoy the green graphs, ${esc(who())}.`, "My pleasure. Ping me if anything flickers."], "thx"),
        c: suggestions(),
      };
    if (/^(bye|goodbye|see you|cya|good night|gn)\b/.test(t))
      return { h: pick([`See you, ${esc(who())}. I'll flag anything critical while you're away.`, "Off you go. I'll keep watch.", "Bye! I'll be here, staring at the graphs lovingly.", "Sleep well. I'll guard the uptime."], "bye") };
    if (/^(hi|hello|hey|yo|howdy|good (morning|afternoon|evening))\b/.test(t) && t.length < 25) return greeting();
    if ((r = chatter(t))) return r;

    if (/\b(insights?|analy[sz]e|anything (unusual|wrong|odd|weird)|what should i (do|look at|fix)|recommend\w*|priorit\w*|health ?check|checkup)\b/.test(t) && !HOWTO.test(t)) return insights();
    if ((r = followUp(t))) return r;

    const kb = kbBest(t);
    const named = regionNamed(t);
    if (HOWTO.test(t) && kb.s >= 2 && !named) return kbAnswer(kb.e);

    // data questions
    if ((r = numeric(t))) return r;
    let mbr;
    let inc;
    if (/\bhow many (regions|servers|hosts)\b|\b(busiest|quietest|average load|avg load|most servers|fleet|prod(uction)? vs|compare)\b|\bservers\b.*\b(total|monitored|have|count)\b/.test(t)) return fleet(t);
    const reg = named || (!/\b(status page|incident|ticket)\b/.test(t) && findRegion(t));
    if (reg) return regionFact(t, reg) || regionDetail(reg);
    const pr = pronounRegion(t);
    if (pr && (r = regionFact(t, pr))) return r;
    if (/\b(threshold|degraded at|critical at)\b/.test(t) && !/\b(set|change|raise|lower|make|move|update)\b/.test(t)) return thresholds();
    if (/\bincident/.test(t) && (inc = findIncident(t))) return incidentDetail(inc);
    if (/\b(open|active|current|ongoing|unresolved)\b.*\bincident|\bincident\w*\b.*\b(open|active|right now|ongoing)\b|\bwhat('s| is) (broken|down|on fire)\b/.test(t)) return openIncidents();
    if (/\b(downtime|outage minutes)\b/.test(t)) return downtime();
    if (/\bticket/.test(t) && /\b(unassigned|oldest|newest|latest|stale|last)\b/.test(t)) return ticketSpecial(t);
    if ((mbr = findMember(t)) && !/\b(tickets? by|breakdown)\b/.test(t)) return memberDetail(mbr);
    if (/\b(status|health|how's|how is|summary|brief|catch me up|all good|everything ok|right now|sitrep)\b/.test(t) && !/\b(status page|status chip|status badge)\b/.test(t)) return status();
    if (/\b(critical|degraded|unhealthy|attention|worst|overload\w*|highest load|on fire|misbehav\w*)\b/.test(t) && !HOWTO.test(t)) return attention();
    if (/\b(latency|slow\w*|ping|response time|fastest)\b/.test(t)) return latency();
    if (/\b(uptime|sla|availability)\b/.test(t) && !HOWTO.test(t)) return uptime();
    if (/\b(incident\w*|severity)\b/.test(t) && !HOWTO.test(t)) return incidents();
    if (/\b(ticket\w*|helpdesk|backlog)\b/.test(t) && !HOWTO.test(t)) return tickets();
    if (/\b(on[- ]?call|team|colleague\w*|who's|who is|online)\b/.test(t) && !HOWTO.test(t)) return team();
    if (/\b(activity|feed|recent|latest|happened)\b/.test(t) && !HOWTO.test(t)) return activity();
    if (kb.s >= 2) return kbAnswer(kb.e);
    return null;
  }

  const NOT_UNDERSTOOD = () => ({
    h: pick([
      `Hm, that one went over my head. Try one of these, or say "help" for everything I can do.`,
      `I didn't catch that. I'm great with regions, uptime, tickets and how this dashboard works, less so with riddles.`,
      `Not sure what you mean. Here are some things I'm actually good at.`,
      `You've stumped me. Rephrase it, or try one of these.`,
    ], "nu"),
    c: suggestions(null, 4),
  });

  // Last resort when Gemini can't be reached: the closest knowledge-base entry, or a friendly shrug.
  function offlineFallback(text) {
    const kb = kbBest(fix(text.toLowerCase()));
    if (kb.e && kb.s >= 1)
      return { h: `${pick(["My AI side is offline, but this is the closest thing I know:", "I can't reach my AI brain right now. Closest match from my notes:", "Going from memory here:"], "off")}<br>${kbText(kb.e)}`, c: suggestions(null, 4) };
    return NOT_UNDERSTOOD();
  }

  function respond(text) {
    const t = fix(text.toLowerCase());
    justMuted = false;
    if (pending) {
      const p = pending;
      pending = null;
      if (/^(yes|y|yep|yeah|sure|ok|okay|confirm|do it|go ahead|please do)\b/.test(t)) return { run: p.run };
      if (/^(no|n|nope|cancel|stop|never ?mind|don't|abort)\b/.test(t)) return { h: pick(["Cancelled. Nothing changed.", "Okay, scrapped."], "cx"), c: suggestions() };
    }
    const w = writeIntent(text);
    if (w) return w;
    if (/\b(clear|reset|wipe)\b.*\b(chat|conversation|history)\b/.test(t)) {
      log = [];
      write(CHAT_KEY, log);
      return { h: pick(["Conversation cleared. Fresh start.", "Wiped. I remember nothing. (Except your name.)"], "clr"), c: suggestions(), cleared: true };
    }
    const { notes, done } = actions(text, t);
    const ans = done ? null : answer(t);
    if (notes.length) return { h: lines(notes) + (ans ? "<br><br>" + ans.h : ""), c: (ans && ans.c) || suggestions() };
    if (ans) return ans;
    return { ai: true, c: suggestions(null, 4) };
  }

  /* ---------- UI ---------- */
  function push(role, h, c, forceSpeak) {
    log.push({ r: role, h, c: c || null });
    log = log.slice(-40);
    write(CHAT_KEY, log);
    renderLog(true);
    if (role === "b" && el.panel.hidden) el.dot.hidden = false;
    if (role === "b" && (mem.voice || forceSpeak)) speak(h);
  }

  function scrollToEnd(smooth) {
    const box = el.log;
    const bottom = () => box.scrollHeight - box.clientHeight;
    box.scrollTo({ top: bottom(), behavior: smooth && !PG.reduceMotion ? "smooth" : "auto" });
    requestAnimationFrame(() => {
      if (!smooth) box.scrollTop = bottom();
    });
    setTimeout(() => {
      if (bottom() - box.scrollTop > 2) box.scrollTop = bottom();
    }, 380);
  }

  function renderLog(animateLast) {
    const lastIdx = log.length - 1;
    el.log.innerHTML =
      log.map((m, i) => `<div class="bot-msg ${m.r === "u" ? "me" : "pulse"}${animateLast && i === lastIdx ? " in" : ""}">${m.h}</div>`).join("") +
      (busy ? `<div class="bot-msg pulse typing in" aria-label="Pulse is typing"><i></i><i></i><i></i></div>` : "");
    scrollToEnd(animateLast);
    el.panel.classList.toggle("is-busy", busy > 0);
    const last = log[log.length - 1];
    el.chips.innerHTML =
      last && last.r === "b" && last.c && !busy
        ? last.c.map((c, i) => `<button class="bot-chip" type="button" style="--i:${i}">${esc(c)}</button>`).join("")
        : "";
  }

  const MILESTONES = {
    10: "That's your 10th question. We're getting along.",
    50: "Fifty questions. I'm starting to feel like part of the team.",
    100: "100 questions! I'd ask for a raise, but I run on electricity.",
  };

  function send(text, viaMic) {
    text = text.trim();
    if (!text || busy) return;
    stopSpeaking();
    el.input.value = "";
    log.push({ r: "u", h: esc(text), c: null });
    busy++;
    renderLog(true);
    mem.lastOpen = Date.now();
    mem.count = (mem.count || 0) + 1;
    write(MEM_KEY, mem);
    setTimeout(
      async () => {
        let r;
        try {
          r = respond(text);
          if (r.run) {
            try {
              r = await r.run();
            } catch (e) {
              r = { h: e && e.code === "permission-denied" ? "Permission denied. Your account needs admin access and the Firestore rules must be published." : "That didn't save. Check your connection and try again." };
            }
            r.c = r.c || suggestions();
          } else if (r.ai) {
            try {
              r = { h: await askGemini(text), c: suggestions() };
            } catch (_) {
              r = offlineFallback(text);
            }
          }
        } catch (_) {
          r = { h: pick(["Something went wrong while checking that. Try again?", "Well, that didn't work. Give it another go."], "err") };
        }
        if (MILESTONES[mem.count] && !r.cleared) r.h += `<br><br>${MILESTONES[mem.count]}`;
        busy--;
        push("b", r.h, r.c, !!viaMic && !justMuted);
      },
      PG.reduceMotion ? 0 : 350 + Math.random() * 350,
    );
  }

  let closeTimer;
  function setOpen(open, returnFocus) {
    clearTimeout(closeTimer);
    el.panel.classList.remove("closing");
    if (open) {
      el.panel.hidden = false;
      el.panel.classList.remove("opening");
      void el.panel.offsetWidth;
      el.panel.classList.add("opening");
    } else if (!el.panel.hidden) {
      stopSpeaking();
      stopListening(true);
      el.panel.classList.remove("opening");
      el.panel.classList.add("closing");
      closeTimer = setTimeout(() => {
        el.panel.hidden = true;
        el.panel.classList.remove("closing");
      }, PG.reduceMotion ? 0 : 160);
    }
    el.fab.setAttribute("aria-expanded", String(open));
    el.fab.setAttribute("aria-label", open ? "Close Pulse assistant" : "Open Pulse assistant");
    if (open) {
      el.dot.hidden = true;
      if (!log.length || Date.now() - mem.lastOpen > 30 * 60 * 1000) {
        const g = greeting();
        push("b", g.h, g.c);
      }
      mem.lastOpen = Date.now();
      write(MEM_KEY, mem);
      renderLog();
      el.input.focus();
    } else if (returnFocus) el.fab.focus();
  }

  const paintSub = () => (el.sub.textContent = `Assistant for ${who()}`);

  function init() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <button class="bot-fab" id="botFab" type="button" aria-expanded="false" aria-controls="botPanel" aria-label="Open Pulse assistant" title="Ask Pulse">
        <svg viewBox="0 0 32 32" fill="none"><polygon points="16,2 29,9 29,23 16,30 3,23 3,9" stroke="currentColor" stroke-width="1.8"/><circle cx="16" cy="16" r="4.2" fill="currentColor"/></svg>
        <span class="bot-fab-dot" id="botDot" hidden></span>
      </button>
      <section class="bot" id="botPanel" role="dialog" aria-label="Pulse assistant" hidden>
        <header class="bot-head">
          <div class="bot-id"><div class="bot-title">Pulse</div><div class="bot-sub" id="botSub"></div></div>
          ${TTS ? '<button class="bot-x bot-voice" id="botVoice" type="button" aria-pressed="false"></button>' : ""}
          <button class="bot-x" id="botClear" type="button" title="Clear conversation" aria-label="Clear conversation">Clear</button>
          <button class="bot-x" id="botClose" type="button" title="Close" aria-label="Close assistant">✕</button>
        </header>
        <div class="bot-log" id="botLog" role="log" aria-live="polite"></div>
        <div class="bot-chips" id="botChips"></div>
        <div class="bot-form">
          <input id="botInput" type="text" maxlength="300" autocomplete="off" placeholder="${PLACEHOLDER}" aria-label="Message Pulse" />
          ${SR ? '<button class="bot-mic" id="botMic" type="button" aria-pressed="false"></button>' : ""}
          <button class="btn" id="botSend" type="button">Send</button>
        </div>
      </section>`;
    document.body.append(...wrap.children);
    el = {
      fab: $("#botFab"), dot: $("#botDot"), panel: $("#botPanel"), sub: $("#botSub"),
      log: $("#botLog"), chips: $("#botChips"), input: $("#botInput"),
      voice: $("#botVoice"), mic: $("#botMic"),
    };
    paintSub();
    PG.settings.onChange(paintSub);
    paintVoice();
    if (el.mic) {
      el.mic.innerHTML = ICON.mic;
      paintMic();
      el.mic.addEventListener("click", startListening);
    }
    if (el.voice) el.voice.addEventListener("click", () => setVoice(!mem.voice, true));
    addEventListener("pagehide", stopSpeaking);

    el.fab.addEventListener("click", () => setOpen(el.panel.hidden || el.panel.classList.contains("closing"), false));
    $("#botClose").addEventListener("click", () => setOpen(false, true));
    $("#botClear").addEventListener("click", () => {
      stopSpeaking();
      log = [];
      const g = greeting();
      push("b", g.h, g.c);
    });
    $("#botSend").addEventListener("click", () => send(el.input.value));
    el.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        send(el.input.value);
      }
    });
    el.panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setOpen(false, true);
    });
    el.chips.addEventListener("click", (e) => {
      const b = e.target.closest(".bot-chip");
      if (b) send(b.textContent);
    });
  }

  // Called when a region goes critical or recovers, so Pulse can speak up unprompted.
  function alert(dot, label) {
    if (!el.panel) return;
    push("b", `<span class="bot-dot" style="background:${esc(dot)}"></span>${esc(label)}`, ["Which regions need attention?"]);
  }

  PG.bot = { init, alert };
})();