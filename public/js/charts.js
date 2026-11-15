(function () {
  "use strict";
  const PG = window.Pulsegrid;
  const $ = (s) => document.querySelector(s);

  function line(days, animate = true) {
    const svg = $("#lineChart");
    const tip = $("#lineTip");
    const pts = PG.derive.uptimeSeries(days);
    const W = 640, H = 200, PAD = 10, MAX = 100;
    const MIN = Math.min(99.9, Math.floor(Math.min(...pts) * 100) / 100 - 0.02);
    const step = (W - PAD * 2) / (pts.length - 1);
    const xy = pts.map((v, i) => [
      PAD + i * step,
      H - PAD - ((v - MIN) / (MAX - MIN)) * (H - PAD * 2),
    ]);
    const d = xy
      .map((c, i) => `${i ? "L" : "M"}${c[0].toFixed(1)} ${c[1].toFixed(1)}`)
      .join(" ");
    const grid = [0, 1, 2, 3]
      .map(
        (i) =>
          `<line x1="0" y1="${(H / 4) * i}" x2="${W}" y2="${(H / 4) * i}" stroke="#1a212c" vector-effect="non-scaling-stroke"/>`,
      )
      .join("");

    svg.innerHTML = `
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#45d8cb" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#45d8cb" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid}
      <path id="uptimeArea" d="${d} L${xy[xy.length - 1][0]} ${H} L${xy[0][0]} ${H} Z" fill="url(#areaGrad)" opacity="0"/>
      <path id="uptimeLine" d="${d}" fill="none" stroke="#45d8cb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <line id="guide" y1="0" y2="${H}" stroke="#45d8cb" stroke-opacity="0.4" vector-effect="non-scaling-stroke" visibility="hidden"/>`;

    const path = svg.querySelector("#uptimeLine");
    const area = svg.querySelector("#uptimeArea");
    if (PG.reduceMotion || !animate) {
      area.style.opacity = 1;
      area.setAttribute("opacity", 1);
    } else {
      const len = path.getTotalLength();
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
      path.getBoundingClientRect();
      path.style.transition = "stroke-dashoffset 1.2s cubic-bezier(.16,.84,.44,1)";
      area.style.transition = "opacity .8s ease .4s";
      requestAnimationFrame(() => {
        path.style.strokeDashoffset = 0;
        area.style.opacity = 1;
      });
    }

    const guide = svg.querySelector("#guide");
    const now = Date.now();
    svg.onpointermove = (e) => {
      const r = svg.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W;
      const i = PG.util.clamp(Math.round((x - PAD) / step), 0, pts.length - 1);
      const date = new Date(now - (pts.length - 1 - i) * 864e5).toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric" },
      );
      guide.setAttribute("x1", xy[i][0]);
      guide.setAttribute("x2", xy[i][0]);
      guide.setAttribute("visibility", "visible");
      tip.innerHTML = `<b>${pts[i].toFixed(2)}%</b><span>${date}</span>`;
      tip.hidden = false;
      tip.style.left = (xy[i][0] / W) * r.width + "px";
      tip.style.top = (xy[i][1] / H) * r.height + "px";
    };
    svg.onpointerleave = () => {
      guide.setAttribute("visibility", "hidden");
      tip.hidden = true;
    };

    return pts.reduce((a, b) => a + b, 0) / pts.length;
  }

  function donut(days) {
    const data = PG.derive.severity(days);
    const sum = data.reduce((a, b) => a + b.value, 0);
    const total = sum || 1;
    const R = 55, C = 70, CIRC = 2 * Math.PI * R;
    let acc = 0;

    const segs = data
      .map((d, i) => {
        const dash = (d.value / total) * CIRC;
        const s = `<circle class="donut-seg" data-i="${i}" cx="${C}" cy="${C}" r="${R}" fill="none"
          stroke="${d.color}" stroke-width="14" stroke-dasharray="${dash} ${CIRC - dash}"
          stroke-dashoffset="${-acc}" transform="rotate(-90 ${C} ${C})"/>`;
        acc += dash;
        return s;
      })
      .join("");

    const svg = $("#donutChart");
    const track = sum ? "" : `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="#1a212c" stroke-width="14"/>`;
    svg.innerHTML =
      track +
      segs +
      `<text class="donut-n" x="70" y="75" text-anchor="middle">${sum}</text>
       <text class="donut-l" x="70" y="91" text-anchor="middle">incidents</text>`;

    const n = svg.querySelector(".donut-n");
    const l = svg.querySelector(".donut-l");
    svg.querySelectorAll(".donut-seg").forEach((c, i) => {
      const d = data[i];
      c.onpointerenter = () => {
        n.textContent = d.value;
        l.textContent = d.label.toLowerCase();
      };
      c.onpointerleave = () => {
        n.textContent = sum;
        l.textContent = "incidents";
      };
      setTimeout(() => (c.style.opacity = 1), PG.reduceMotion ? 0 : 300 + i * 140);
    });

    $("#donutLegend").innerHTML = data
      .map(
        (d) => `
        <div class="legend-row">
          <div class="legend-key"><span class="legend-swatch" style="background:${d.color}"></span>${d.label}</div>
          <div class="legend-val">${d.value}</div>
        </div>`,
      )
      .join("");
  }

  function bars(days, delay = 60) {
    const data = PG.derive.tickets(days);
    const max = Math.max(1, ...data.map((d) => d.value));
    const el = $("#barChart");
    el.innerHTML = data
      .map(
        (d) => `
        <div class="bar-row">
          <div class="bar-label">${d.label}</div>
          <div class="bar-track"><div class="bar-fill" data-w="${((d.value / max) * 100).toFixed(1)}"></div></div>
          <div class="bar-num">${d.value}</div>
        </div>`,
      )
      .join("");
    setTimeout(() => {
      el.querySelectorAll(".bar-fill").forEach((b) => (b.style.width = b.dataset.w + "%"));
    }, delay);
    return data.reduce((a, b) => a + b.value, 0);
  }

  PG.charts = { line, donut, bars };
})();