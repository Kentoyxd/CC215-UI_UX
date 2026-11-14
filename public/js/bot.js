/* Pulsegrid — "Pulse", a personalised assistant. Runs in the browser:
   it reads live dashboard data, can change filters/settings for you, and
   remembers your name, recent chat and the topics you ask about most.
   Built-in rules answer common questions instantly; anything they don't
   understand is passed to Gemini (Firebase AI Logic) with the dashboard data. */
(function () {
  "use strict";
  const PG = window.Pulsegrid;
  const { plural } = PG.util;
  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

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

  const mem = Object.assign({ topics: {}, lastOpen: 0 }, read(MEM_KEY, {}));
  let log = read(CHAT_KEY, []);
  let busy = 0;
  let el = {};

  /* ---------- who the user is ---------- */
  const settings = () => PG.settings.get();
  const who = () => {
    const name = settings().name.trim();
    const first = name.split(/\s+/)[0];
    return /^\w\.?$/.test(first) && name !== first ? name : first; // "R. Jones" stays whole
  };
  const me = () => (PG.views.team() || []).find((m) => m.name.toLowerCase() === settings().name.trim().toLowerCase());

  /* ---------- memory: topics asked about most come first in the quick replies ---------- */
  const PROMPTS = {
    status: "How are things right now?",
    regions: "Which regions need attention?",
    latency: "Which region is slowest?",
    uptime: "How's uptime looking?",
    incidents: "Incidents by severity",
    tickets: "Ticket breakdown",
    team: "Who's on call?",
  };
  function topic(k) {
    mem.topics[k] = (mem.topics[k] || 0) + 1;
    write(MEM_KEY, mem);
  }
  function suggestions(exclude, n = 3) {
    return Object.keys(PROMPTS)
      .sort((a, b) => (mem.topics[b] || 0) - (mem.topics[a] || 0))
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

  function findRegion(t) {
    const stg = /\b(staging|stg)\b/.test(t);
    const city = (r) => (r.region || "").replace(/\(.*\)/, "").replace(/^n\.\s*/i, "").trim().toLowerCase();
    return regions()
      .filter((r) => stg === (r.env === "stg") || t.includes(r.name.toLowerCase()))
      .sort((a, b) => b.name.length - a.name.length)
      .find((r) => t.includes(r.name.toLowerCase()) || (city(r) && t.includes(city(r))));
  }

  /* ---------- Gemini (Firebase AI Logic) ----------
     Loaded lazily with the modular SDK on its own app instance, because the
     rest of the dashboard uses the compat SDK (which has no AI Logic).
     Setup: Firebase console → AI Logic → Get started → Gemini Developer API,
     then turn on App Check for this web app. */
  const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/12.0.0/"; // use the latest 12.x
  const GEMINI_MODEL = "gemini-2.5-flash"; // check the console for the current model name
  const RECAPTCHA_SITE_KEY = "6LcGPx8uAAAAAA4lAtNX_xIyuzfMVtoa_CcxJJ-y"; // public; safe in front-end code
  let modelPromise;

  function getModel() {
    if (!modelPromise) {
      modelPromise = (async () => {
        const { initializeApp } = await import(FIREBASE_SDK + "firebase-app.js");
        const { getAI, getGenerativeModel, GoogleAIBackend } = await import(FIREBASE_SDK + "firebase-ai.js");
        const app = initializeApp(window.FIREBASE_CONFIG, "gemini");
        // App Check: proves requests come from this site. Must run before getAI().
        const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import(FIREBASE_SDK + "firebase-app-check.js");
        if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true; // local testing only
        initializeAppCheck(app, {
          provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
          isTokenAutoRefreshEnabled: true,
        });
        const ai = getAI(app, { backend: new GoogleAIBackend() });
        return getGenerativeModel(ai, {
          model: GEMINI_MODEL,
          systemInstruction:
            "You are Pulse, an assistant inside an IT operations dashboard. " +
            "Answer briefly (max 4 sentences) using ONLY the JSON data provided. " +
            "If the data doesn't contain the answer, say so. Plain text, no markdown.",
        });
      })();
      modelPromise.catch(() => (modelPromise = null)); // allow a retry after a failed load
    }
    return modelPromise;
  }

  // Summary of the dashboard sent to Gemini. Ticket titles and assignees are left out on purpose.
  function dashboardContext() {
    const D = PG.derive;
    return JSON.stringify({
      user: settings().name,
      rangeDays: range(),
      thresholds: { degradedAt: settings().warn, criticalAt: settings().critical },
      regions: regions().map((r) => ({
        name: r.name,
        location: r.region,
        env: r.env,
        servers: r.servers,
        load: r.load,
        latency: r.latency,
        status: r.status,
      })),
      openIncidents: PG.store.data.incidents
        .filter((i) => i.status !== "resolved")
        .map((i) => ({ title: i.title, severity: i.severity, status: i.status, region: i.region })),
      incidentsBySeverity: D.severity(range()),
      ticketsByCategory: D.tickets(range()),
      openTickets: D.openTickets(),
      team: (PG.views.team() || []).map((m) => ({
        name: m.name,
        role: m.role,
        status: m.status,
        oncall: m.oncall,
        tickets: m.tickets,
      })),
    });
  }

  async function askGemini(text) {
    const model = await getModel();
    const res = await model.generateContent(`Dashboard data:\n${dashboardContext()}\n\nQuestion: ${text}`);
    // Messages are rendered as HTML, so escape the model's output.
    return esc(res.response.text().trim()).replace(/\n/g, "<br>");
  }

  /* ---------- answers (each returns { h, c? }) ---------- */
  function greeting() {
    const hr = new Date().getHours();
    const part = hr < 5 ? "Working late" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
    const rs = regions();
    const crit = rs.filter((r) => r.status === "Critical");
    const warn = rs.filter((r) => r.status === "Degraded");
    const mine = me();
    let h = `${part}, <b>${esc(who())}</b>.`;
    if (mine && mine.oncall) h += " You're on call right now.";
    h += "<br>";
    if (crit.length) h += `Heads-up: ${names(crit)} ${crit.length > 1 ? "are" : "is"} critical.`;
    else if (warn.length) h += `${plural(warn.length, "region")} degraded, nothing critical.`;
    else h += "All regions look healthy.";
    if (mine && mine.tickets) h += ` You have ${plural(mine.tickets, "open ticket")}.`;
    return { h, c: suggestions() };
  }

  function status() {
    topic("status");
    const rs = regions();
    const crit = rs.filter((r) => r.status === "Critical");
    const warn = rs.filter((r) => r.status === "Degraded");
    const k = PG.panels.kpi;
    let h = crit.length
      ? `<b>${plural(crit.length, "region")} critical</b>: ${names(crit)}.`
      : warn.length
        ? `No critical regions, but <b>${plural(warn.length, "region")} degraded</b>: ${names(warn)}.`
        : `All <b>${rs.length}</b> regions are healthy.`;
    h += `<br>Uptime ${k.get("uptime")}% · response ${Math.round(k.get("response"))}ms · ${plural(k.get("open"), "open ticket")}.`;
    return { h, c: suggestions("status") };
  }

  function attention() {
    topic("regions");
    const bad = regions()
      .filter((r) => r.status !== "Healthy")
      .sort((a, b) => b.load - a.load);
    if (!bad.length) {
      const top = regions().sort((a, b) => b.load - a.load)[0];
      return { h: `Nothing needs attention. The busiest region is ${rowOf(top)}.`, c: suggestions("regions") };
    }
    return { h: lines(bad.map(rowOf)), c: ["Export CSV", ...suggestions("regions", 2)] };
  }

  function latency() {
    topic("latency");
    const slow = regions().sort((a, b) => b.latency - a.latency).slice(0, 3);
    return {
      h: `Slowest regions:<br>${lines(slow.map(rowOf))}<br>Average response time is ${Math.round(PG.panels.kpi.get("response"))}ms.`,
      c: suggestions("latency"),
    };
  }

  function regionDetail(r) {
    topic("regions");
    const gap = settings().critical - r.load;
    const room = gap > 0 ? `${gap} points below your critical threshold (${settings().critical}%)` : `above your critical threshold (${settings().critical}%)`;
    return { h: `${rowOf(r)}<br>${esc(r.region)}, ${r.env === "prod" ? "production" : "staging"}. Load is ${room}.`, c: suggestions("regions") };
  }

  function uptime() {
    topic("uptime");
    const s = PG.derive.uptimeSeries(range());
    const avg = sum(s) / s.length;
    const below = s.filter((v) => v < 99.9).length;
    return {
      h: `Over the last ${range()} days, uptime averaged <b>${avg.toFixed(3)}%</b>. Lowest day: ${Math.min(...s).toFixed(2)}%. ${plural(below, "day")} below the 99.9% SLA.`,
      c: suggestions("uptime"),
    };
  }

  function incidents() {
    topic("incidents");
    const d = PG.derive.severity(range()).map((x) => ({ l: x.label, v: x.value }));
    return {
      h: `<b>${sum(d.map((x) => x.v))}</b> incidents in the last ${range()} days:<br>${lines(d.map((x) => `${x.l}: ${x.v}`))}<br>${PG.panels.kpi.get("incidents")} are active right now.`,
      c: suggestions("incidents"),
    };
  }

  function tickets() {
    topic("tickets");
    const d = PG.derive.tickets(range()).map((x) => ({ l: x.label, v: x.value }));
    const total = sum(d.map((x) => x.v));
    const top = d.reduce((a, b) => (b.v > a.v ? b : a));
    return {
      h: `<b>${total.toLocaleString("en-US")}</b> tickets in the last ${range()} days. ${total ? `${top.l} leads with ${top.v} (${Math.round((top.v / total) * 100)}%).` : "None have been logged yet."}`,
      c: suggestions("tickets"),
    };
  }

  function team() {
    topic("team");
    const t = PG.views.team() || [];
    const oncall = t.find((m) => m.oncall);
    const online = t.filter((m) => m.status === "online");
    const busy = t.slice().sort((a, b) => b.tickets - a.tickets)[0];
    let h = oncall ? `<b>${esc(oncall.name)}</b> is on call${oncall.name.toLowerCase() === settings().name.trim().toLowerCase() ? " (that's you)" : ""}.` : "Nobody is on call. You can set one on the Team page.";
    h += `<br>${online.length} of ${t.length} online.`;
    if (busy && busy.tickets) h += ` ${esc(busy.name)} has the most open tickets (${busy.tickets}).`;
    return { h, c: suggestions("team") };
  }

  function activity() {
    const items = PG.panels.feed.recent(4);
    return { h: lines(items.map((i) => `${i.time} · ${i.text}`)), c: suggestions() };
  }

  function aboutMe() {
    const mine = me();
    const top = Object.entries(mem.topics).sort((a, b) => b[1] - a[1])[0];
    let h = `You're <b>${esc(settings().name)}</b>.`;
    if (mine) h += ` Role: ${esc(mine.role)}${mine.oncall ? ", currently on call" : ""}, ${plural(mine.tickets, "open ticket")}.`;
    if (top) h += `<br>You ask about <b>${esc(top[0])}</b> most, so I list it first in quick replies.`;
    h += `<br>My memory of you stays in this browser. Say "clear chat" to wipe the conversation.`;
    h += `<br>For open-ended questions, a summary of your dashboard data is processed by an AI service to help me answer.`;
    return { h };
  }

  const HELP = {
    h: `Ask me about regions, latency, uptime, incidents, tickets or the team. You can also ask me other questions about your dashboard and I'll do my best to help. I can also do things:<br>
      · "Show last 7 days" or "switch to staging"<br>
      · "Open reports"<br>
      · "Set critical to 90"<br>
      · "Pause the feed" · "Export CSV" · "Refresh"<br>
      · "Call me Sam"`,
  };

  /* ---------- actions (may combine: "switch to staging and show 7 days") ---------- */
  function actions(text, t) {
    const notes = [];
    let m;
    let done = false; // the action is the whole answer; don't add a data summary
    const A = PG.actions;
    const S = PG.settings;

    if ((m = text.match(/\b(?:call me|my name is|i am called|i'm called)\s+([^.!?\n]{1,40})/i))) {
      S.set({ name: m[1].trim() });
      notes.push(`Got it, I'll call you <b>${esc(who())}</b>.`);
      done = true;
    }
    if (/\b(show|switch|change|set|use|view|select|filter)\b/.test(t) && (m = t.match(/\b(7|30|90)\s*-?\s*d|\b(week|month|quarter)\b/))) {
      const days = m[1] ? +m[1] : { week: 7, month: 30, quarter: 90 }[m[2]];
      A.setRange(days);
      notes.push(`Range set to the last <b>${days} days</b>.`);
    }
    if (/\b(show|switch|filter|view|use|only)\b/.test(t) && (m = t.match(/\b(prod(?:uction)?|staging|stg|all env\w*)/))) {
      const env = /^prod/.test(m[1]) ? "prod" : /^(staging|stg)/.test(m[1]) ? "stg" : "all";
      A.setEnv(env);
      notes.push(`Showing <b>${esc(PG.environments[env].toLowerCase())}</b>.`);
    }
    if ((m = t.match(/\b(?:go to|open|take me to|navigate to)\s+(?:the\s+)?(overview|infrastructure|incidents|tickets|reports|team|settings)/))) {
      PG.ui.navTo(m[1][0].toUpperCase() + m[1].slice(1));
      notes.push(`Opened <b>${esc(m[1])}</b>.`);
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
      notes.push(`${{ feedAlerts: "Alerts in the activity feed", live: "Live updates", toasts: "Pop-up alerts" }[key]} turned <b>${on ? "on" : "off"}</b>.`);
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
      notes.push("Dashboard refreshed. Data updates live.");
    }
    if (/\bexport\b|\bdownload\b.*\bcsv\b/.test(t)) {
      notes.push(`Exported <b>${PG.panels.exportCsv()}</b> regions to CSV.`);
    }
    return { notes, done };
  }

  /* ---------- routing ---------- */
  function answer(t) {
    let r;
    if (/\bhow are you\b/.test(t)) return { h: "Running smoothly. What do you want to check?", c: suggestions() };
    if (/\b(who am i|about me|what do you (know|remember))\b/.test(t)) return aboutMe();
    if (/\b(help|what can you|commands)\b/.test(t)) return { ...HELP, c: suggestions() };
    if (/^(thanks|thank you|thx|cheers)\b/.test(t)) return { h: `Any time, ${esc(who())}.`, c: suggestions() };
    if (/^(bye|goodbye|see you|cya)\b/.test(t)) return { h: `See you, ${esc(who())}. I'll flag anything critical while you're away.` };
    if (/^(hi|hello|hey|yo|good (morning|afternoon|evening))\b/.test(t) && t.length < 25) return greeting();
    if ((r = findRegion(t))) return regionDetail(r);
    if (/\b(status|health|how's|how is|summary|brief|catch me up|all good|everything ok|right now)\b/.test(t)) return status();
    if (/\b(critical|degraded|unhealthy|attention|worst|overload\w*|busiest|highest load|on fire)\b/.test(t)) return attention();
    if (/\b(latency|slow\w*|ping|response)\b/.test(t)) return latency();
    if (/\b(uptime|sla|availability)\b/.test(t)) return uptime();
    if (/\b(incident\w*|severity)\b/.test(t)) return incidents();
    if (/\b(ticket\w*|helpdesk|backlog)\b/.test(t)) return tickets();
    if (/\b(on[- ]?call|team|colleague\w*|who's|who is|online)\b/.test(t)) return team();
    if (/bandwidth/.test(t)) return { h: "I don't track bandwidth. Try regions, latency, uptime, incidents or tickets.", c: suggestions() };
    if (/\b(activity|feed|recent|latest|happened)\b/.test(t)) return activity();
    return null;
  }

  const NOT_UNDERSTOOD = () => ({
    h: `I didn't catch that. Try one of these, or say "help" for everything I can do.`,
    c: suggestions(null, 4),
  });

  // Synchronous part: rules and actions. Returns { ai: true } when nothing matched,
  // so the caller can hand the question to Gemini.
  function respond(text) {
    const t = text.toLowerCase();
    if (/\b(clear|reset|wipe)\b.*\b(chat|conversation|history)\b/.test(t)) {
      log = [];
      write(CHAT_KEY, log);
      return { h: "Conversation cleared.", c: suggestions(), cleared: true };
    }
    const { notes, done } = actions(text, t);
    const ans = done ? null : answer(t);
    if (notes.length) return { h: lines(notes) + (ans ? "<br><br>" + ans.h : ""), c: (ans && ans.c) || suggestions() };
    if (ans) return ans;
    return { ai: true, c: suggestions(null, 4) };
  }

  /* ---------- UI ---------- */
  function push(role, h, c) {
    log.push({ r: role, h, c: c || null });
    log = log.slice(-40);
    write(CHAT_KEY, log);
    renderLog(true);
    if (role === "b" && el.panel.hidden) el.dot.hidden = false;
  }

  // Keep the newest message in view. Glides when a message arrives, then re-pins
  // once the slide-in has finished (the DOM is rebuilt on every render, which can
  // cut a smooth scroll short, and a hidden panel has no height to scroll to).
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

  // animateLast: play the entrance animation on the newest message (and the typing bubble)
  function renderLog(animateLast) {
    const lastIdx = log.length - 1;
    el.log.innerHTML =
      log
        .map((m, i) => `<div class="bot-msg ${m.r === "u" ? "me" : "pulse"}${animateLast && i === lastIdx ? " in" : ""}">${m.h}</div>`)
        .join("") +
      (busy ? `<div class="bot-msg pulse typing in" aria-label="Pulse is typing"><i></i><i></i><i></i></div>` : "");
    scrollToEnd(animateLast);
    el.panel.classList.toggle("is-busy", busy > 0);
    const last = log[log.length - 1];
    el.chips.innerHTML =
      last && last.r === "b" && last.c && !busy
        ? last.c.map((c, i) => `<button class="bot-chip" type="button" style="--i:${i}">${esc(c)}</button>`).join("")
        : "";
  }

  function send(text) {
    text = text.trim();
    if (!text || busy) return;
    el.input.value = "";
    log.push({ r: "u", h: esc(text), c: null });
    busy++;
    renderLog(true);
    mem.lastOpen = Date.now();
    write(MEM_KEY, mem);
    setTimeout(
      async () => {
        let r;
        try {
          r = respond(text);
          if (r.ai) {
            try {
              r = { h: await askGemini(text), c: suggestions() };
            } catch (_) {
              r = NOT_UNDERSTOOD(); // Gemini unavailable (offline, not enabled, quota…)
            }
          }
        } catch (_) {
          r = { h: "Something went wrong while checking that. Try again." };
        }
        busy--;
        push("b", r.h, r.c);
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
      void el.panel.offsetWidth; // force a reflow so the animation restarts every time
      el.panel.classList.add("opening");
    } else if (!el.panel.hidden) {
      // play the close animation, then hide
      el.panel.classList.remove("opening");
      el.panel.classList.add("closing");
      closeTimer = setTimeout(
        () => {
          el.panel.hidden = true;
          el.panel.classList.remove("closing");
        },
        PG.reduceMotion ? 0 : 160,
      );
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
          <button class="bot-x" id="botClear" type="button" title="Clear conversation" aria-label="Clear conversation">Clear</button>
          <button class="bot-x" id="botClose" type="button" title="Close" aria-label="Close assistant">✕</button>
        </header>
        <div class="bot-log" id="botLog" role="log" aria-live="polite"></div>
        <div class="bot-chips" id="botChips"></div>
        <div class="bot-form">
          <input id="botInput" type="text" maxlength="200" autocomplete="off" placeholder="Ask about regions, uptime, tickets…" aria-label="Message Pulse" />
          <button class="btn" id="botSend" type="button">Send</button>
        </div>
      </section>`;
    document.body.append(...wrap.children);
    el = {
      fab: $("#botFab"), dot: $("#botDot"), panel: $("#botPanel"), sub: $("#botSub"),
      log: $("#botLog"), chips: $("#botChips"), input: $("#botInput"),
    };
    paintSub();
    PG.settings.onChange(paintSub);

    el.fab.addEventListener("click", () => setOpen(el.panel.hidden || el.panel.classList.contains("closing"), false));
    $("#botClose").addEventListener("click", () => setOpen(false, true));
    $("#botClear").addEventListener("click", () => {
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