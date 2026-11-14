/* Pulsegrid — shared constants and helpers.
   Live data (regions, incidents, tickets) comes from Firestore: see store.js. */
(function () {
  "use strict";
  const PG = (window.Pulsegrid = window.Pulsegrid || {});

  PG.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  PG.util = {
    pad: (n) => String(n).padStart(2, "0"),
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    jitter: (n) => (Math.random() * 2 - 1) * n,
    plural: (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`,
    esc: (s) =>
      String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]),
  };

  PG.ranges = {
    7: { label: "7 days" },
    30: { label: "30 days" },
    90: { label: "90 days" },
  };

  PG.environments = {
    all: "All environments",
    prod: "Production",
    stg: "Staging",
  };

  PG.severityMeta = [
    { key: "critical", label: "Critical", color: "#f2565f" },
    { key: "high", label: "High", color: "#eeab3f" },
    { key: "medium", label: "Medium", color: "#5b8fef" },
    { key: "low", label: "Low", color: "#45d8cb" },
  ];

  PG.categories = ["Network", "Hardware", "Software", "Security", "Access", "Other"];
})();