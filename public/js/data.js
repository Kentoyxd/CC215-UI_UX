/* Pulsegrid — data + shared helpers.
   All numbers here are mock data. Replace with Firestore / API calls later. */
(function () {
  "use strict";
  const PG = (window.Pulsegrid = window.Pulsegrid || {});

  PG.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  PG.util = {
    pad: (n) => String(n).padStart(2, "0"),
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    jitter: (n) => (Math.random() * 2 - 1) * n,
    plural: (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`,
  };

  // Seeded PRNG so the uptime chart looks the same on every render.
  function seeded(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  PG.ranges = {
    7: { label: "7 days", factor: 0.25 },
    30: { label: "30 days", factor: 1 },
    90: { label: "90 days", factor: 2.9 },
  };

  PG.environments = {
    all: "All environments",
    prod: "Production",
    stg: "Staging",
  };

  PG.uptimeSeries = function (days) {
    const rand = seeded(days * 97);
    return Array.from({ length: days }, () =>
      rand() < 0.2 ? 99.82 + rand() * 0.12 : 99.93 + rand() * 0.07,
    );
  };

  PG.severity = [
    { label: "Critical", value: 2, color: "#f2565f" },
    { label: "High", value: 5, color: "#eeab3f" },
    { label: "Medium", value: 9, color: "#5b8fef" },
    { label: "Low", value: 6, color: "#45d8cb" },
  ];

  PG.tickets = [
    { label: "Network", value: 268 },
    { label: "Hardware", value: 191 },
    { label: "Software", value: 224 },
    { label: "Security", value: 132 },
    { label: "Access", value: 77 },
  ];

  PG.regions = [
    { name: "us-east-1", region: "N. Virginia", env: "prod", load: 72, latency: 38 },
    { name: "us-west-2", region: "Oregon", env: "prod", load: 54, latency: 41 },
    { name: "eu-central-1", region: "Frankfurt", env: "prod", load: 88, latency: 62 },
    { name: "ap-southeast-1", region: "Singapore", env: "prod", load: 35, latency: 97 },
    { name: "ap-northeast-1", region: "Tokyo", env: "prod", load: 96, latency: 110 },
    { name: "sa-east-1", region: "São Paulo", env: "prod", load: 47, latency: 88 },
    { name: "us-east-1-stg", region: "N. Virginia (staging)", env: "stg", load: 22, latency: 44 },
    { name: "eu-west-1-stg", region: "Ireland (staging)", env: "stg", load: 31, latency: 71 },
  ];

  PG.feedTemplates = [
    { dot: "#3ed486", text: "Deployment <b>api-gateway v2.4.1</b> completed successfully" },
    { dot: "#5b8fef", text: "Ticket <b>#4821</b> resolved by <b>M. Alvarez</b>" },
    { dot: "#eeab3f", text: "CPU threshold exceeded on <b>ap-northeast-1</b>" },
    { dot: "#45d8cb", text: "New host <b>web-node-114</b> registered" },
    { dot: "#f2565f", text: "Alert triggered: <b>disk usage 91%</b> on db-replica-3" },
    { dot: "#3ed486", text: "Backup job <b>nightly-snapshot</b> completed" },
    { dot: "#5b8fef", text: "SSL certificate renewed for <b>*.pulsegrid.io</b>" },
    { dot: "#eeab3f", text: "Incident <b>INC-1042</b> escalated to on-call" },
  ];

  PG.notifications = [
    { dot: "#f2565f", label: "Critical load on ap-northeast-1", meta: "2m ago" },
    { dot: "#eeab3f", label: "eu-central-1 latency degraded", meta: "14m ago" },
    { dot: "#5b8fef", label: "Ticket #4830 assigned to you", meta: "1h ago" },
  ];
})();
