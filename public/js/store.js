/* Pulsegrid — live data from Firestore (regions, incidents, tickets) + numbers derived from it.
   Admins write these collections; the public status page reads regions and incidents. */
(function () {
  "use strict";
  const PG = window.Pulsegrid;
  const db = firebase.firestore();
  const COLS = ["regions", "incidents", "tickets"];
  const DAY = 864e5;
  const data = { regions: [], incidents: [], tickets: [] };
  const loaded = {};
  const prev = {}; // col -> { id: status } so we can report status changes
  const subs = [];
  const ms = (v) => (v && v.toMillis ? v.toMillis() : typeof v === "number" ? v : 0);

  const norm = (doc) => {
    const d = doc.data({ serverTimestamps: "estimate" });
    return { ...d, id: doc.id, startedAt: ms(d.startedAt), openedAt: ms(d.openedAt), resolvedAt: ms(d.resolvedAt) };
  };

  function listen(col) {
    let first = true;
    db.collection(col).onSnapshot(
      (snap) => {
        const old = prev[col] || {};
        const changes = first
          ? []
          : snap.docChanges().map((c) => {
              const doc = norm(c.doc);
              return { type: c.type, doc, from: old[doc.id] };
            });
        data[col] = snap.docs.map(norm);
        prev[col] = {};
        data[col].forEach((d) => (prev[col][d.id] = d.status));
        loaded[col] = true;
        const initial = first;
        first = false;
        subs.forEach((f) => f(col, { initial, changes }));
      },
      (error) => subs.forEach((f) => f(col, { error })),
    );
  }

  const toDb = (o) => {
    const out = { ...o };
    ["startedAt", "openedAt", "resolvedAt"].forEach((k) => {
      if (k in out) out[k] = out[k] ? firebase.firestore.Timestamp.fromMillis(out[k]) : null;
    });
    out.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    return out;
  };

  /* ---------- numbers derived from the data ---------- */
  const since = (days) => Date.now() - days * DAY;
  const derive = {
    incidents: (days) => data.incidents.filter((i) => i.startedAt >= since(days)),
    severity: (days) => {
      const list = derive.incidents(days);
      return PG.severityMeta.map((m) => ({ label: m.label, color: m.color, value: list.filter((i) => i.severity === m.key).length }));
    },
    tickets: (days) => {
      const list = data.tickets.filter((t) => t.openedAt >= since(days));
      const cat = (t) => (PG.categories.includes(t.category) ? t.category : "Other");
      return PG.categories.map((c) => ({ label: c, value: list.filter((t) => cat(t) === c).length }));
    },
    resolved: (days) => data.tickets.filter((t) => t.status === "resolved" && (t.resolvedAt || t.openedAt) >= since(days)).length,
    openTickets: () => data.tickets.filter((t) => t.status !== "resolved").length,
    openIncidents: () => data.incidents.filter((i) => i.status !== "resolved").length,
    // Daily uptime %: each incident's downtime minutes count against the day it started.
    uptimeSeries: (days) => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const t0 = start.getTime() - (days - 1) * DAY;
      const down = Array(days).fill(0);
      data.incidents.forEach((i) => {
        const idx = Math.floor((i.startedAt - t0) / DAY);
        if (idx >= 0 && idx < days) down[idx] += +i.downtime || 0;
      });
      return down.map((m) => Math.max(0, 100 - (m / 1440) * 100));
    },
  };

  PG.derive = derive;
  PG.store = {
    data,
    ready: () => COLS.every((c) => loaded[c]),
    on: (fn) => subs.push(fn),
    add: (col, o) => db.collection(col).add(toDb(o)),
    update: (col, id, o) => db.collection(col).doc(id).set(toDb(o), { merge: true }),
    remove: (col, id) => db.collection(col).doc(id).delete(),
  };
  COLS.forEach(listen);
})();