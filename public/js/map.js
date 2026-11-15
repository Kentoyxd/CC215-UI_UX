(function () {
  "use strict";
  const PG = window.Pulsegrid;
  const W = 360, H = 140, TOP = 83, STEP = 2.5;
  const P = (s) => s.trim().split(/\s+/).map(Number);

  
  const LAND = [
    "-168 66 -162 70 -156 71.5 -141 70 -128 70 -115 68 -100 68 -95 72 -85 70 -82 67 -88 64 -94 60 -93 57 -85 55 -80 52 -79 57 -77 62 -70 61 -65 60 -62 57 -56 52 -60 48 -65 49 -65 45 -70 43 -70 41.5 -74 40 -76 37 -76 35 -81 31 -80 26 -81 25.5 -83 29 -85 30 -89 30 -94 29.5 -97 26 -97.5 22 -95 18.5 -91 18.5 -90 21 -87 21.5 -88 16 -84 15.5 -83 11 -80 9 -77.5 8.5 -78 7 -80 7.5 -83 8 -86 11 -88 13 -92 14.5 -95 16 -100 17 -105 20 -106 23 -110 27 -113 31 -115 30 -110 23 -112 25 -115 29 -117 32.5 -120 34.5 -124 40 -124 47 -127 50 -131 55 -137 59 -146 61 -152 59 -158 57 -164 55 -158 59 -162 60 -166 62 -165 64.5",
    "-73 78 -60 82 -30 83 -20 80 -20 72 -24 69 -40 65 -44 60 -50 62 -54 67 -58 75",
    "-80 73 -72 72 -62 67 -65 62 -72 63 -78 65 -90 70",
    "-118 71 -105 73 -100 70 -110 68.5",
    "-90 77 -75 79 -62 82 -85 83 -92 81",
    "-59 47.5 -53 47 -52.7 49.5 -56 51.5",
    "-85 22 -80 23 -74 20 -78 20",
    "-74.5 18.5 -72 20 -68.5 18.5 -71 17.7",
    "-77.5 8.5 -72 12 -64 10.5 -60 8 -52 5 -50 0 -44 -2 -35 -5 -35 -9 -39 -14 -39 -18 -41 -22 -48 -26 -49 -29 -53 -34 -57 -35 -57 -38 -62 -39 -65 -42 -66 -47 -69 -51 -68 -54 -72 -54 -74 -50 -74 -42 -72 -30 -70 -18 -76 -14 -81 -6 -80 -2 -78 2 -77 7",
    "-9 37 -9 43 -2 43.5 -1 46 -4.5 48.5 -1.5 49.5 2 51 5 53 8 54 8.5 57 10.5 57.5 10.5 54.5 14 54 19 54.5 21 57 24 59.5 30 60 23 60 21.5 63 25 65.5 22 65.8 17 62 18.5 59.5 16 56 13 55.5 11 58.5 8 58 5 59 5 62 14 67.5 20 70 28 71 40 67.5 44 68.5 54 68.5 60 69 68 69 73 72.5 80 73.5 90 76 104 77.5 113 74 130 71 140 72.5 160 70 170 70 180 68.5 180 65 179 62 170 60 163 58 160 54 156 51 155 57 145 59.5 137 54 141 52 140 48 135 43 130 42.5 129 36 126.5 34.5 126 37.5 125 39.5 121.5 39 122 37 119 37.5 119 34 121.5 31.5 122 29.5 119.5 25.5 116 22.8 110 21 108 21.5 106 19 109 15 109 11.5 105 8.7 104.5 10.5 100.5 13.5 99.5 10.5 100.3 6.5 103.5 1.5 101 3 98.5 8 98 15 97.5 17 94.5 16 94.3 19.5 92 21.5 90 22 86.5 20 80.2 15.5 80 10 77.5 8 76 10.5 73 17 72.8 21 70 21 68.5 23.5 66.5 25.4 61.5 25 57 25.8 56.5 27.2 52 27.5 50 30 48.5 30 50 26.5 51.5 24.5 54 24.2 56.2 26.3 56.5 24.5 59.5 22.5 55 17 52 16 45 12.7 43 13 39 21 35 28 34.5 29.5 34.8 32 36 35.5 36 36.8 32 36.2 28 36.8 26.5 38.5 26.2 40.2 24 40 23 38 22 36.5 21 38.5 19.5 41 16 43.5 13.5 45.5 12.5 44 16 41.5 18.5 40 16 38 15.7 40 12 42 10 44 7 43.5 3 43.2 3 41.5 0 39 -0.5 37.5 -2 36.7 -5.5 36",
    "-17 21 -16 28 -10 30 -6 35.8 10 37 11 33.5 20 31 25 32 32 31.2 32.5 30 33 27 35 24 37 21 39 16 43 12 51 12 48 5 41 -2 40 -10 40.5 -15 35 -20 35.5 -24 32.5 -28.5 27 -33.5 20 -34.8 18.5 -34 15 -27 12 -18 13.5 -12 12 -5 9 -1 9.5 4 5 6 -2 5 -8 4.5 -13 8 -17 14.5",
    "44 -25 47 -25 50 -15 49 -12 44 -16",
    "-5 50 1.5 51 1.7 53 -0.5 54.5 -2 57.5 -3 58.6 -5 58.5 -6 56.5 -5 55 -3 54.5 -4.5 53 -5 51.7",
    "-10 52 -6 52 -6 55 -8 55 -10 54",
    "-24 65 -22 66.5 -14 66 -14 64.5 -19 63.4",
    "130.5 33.5 132 35.5 136 36.5 140 40.5 142 40 141 36 140 35 137 34.5 135 33.5 132 33.8",
    "140 42 141 45.5 145 43.5 143 42",
    "120 22 121.5 25 122 24 121 22",
    "120 14 120.5 18.5 122 18.5 122 16 124 13.5 121 13.5",
    "122 10.5 124 11.5 125.5 11 124.5 10 123 9.5",
    "122 7 123 9.5 126 9.5 126.5 7 125.5 5.8 123 7",
    "95 5.5 98 4 104 -1.5 106 -5.8 102 -4 98 0 95.5 3",
    "109 1.5 111 2.5 115 5 117 7 119 5 117.5 1 116 -3.5 111 -3 110 -1.5",
    "105.5 -6.5 114.5 -7.5 114 -8.5 106 -7.5",
    "119 -5 120 1 125 1.5 121 -1 123 -5",
    "131 -1 135 -3.5 141 -2.5 147 -6 150 -10.5 143 -9 138 -8 134 -4",
    "80 9.8 81.8 7.5 80.5 6 79.8 8",
    "114 -22 122 -18 126 -14 130 -12 136 -12 136.5 -15 140 -17.5 142 -11 145 -15 146 -19 153 -25.5 153 -30 150.5 -37 146 -39 141 -38 138 -35.5 135 -34.5 131 -31.5 124 -33.5 115 -34.3 115 -30 113.5 -26",
    "172.5 -35 178 -37.5 175 -41.5 173 -39",
    "172.5 -40.5 174 -41.5 171 -44.5 168 -46.5 166.5 -46 170.5 -43",
  ].map(P);
  const WATER = [
    "28 41.5 28 44 30 46 33 46 35 45 38 47 41 43 41.5 41.5 36 41.8 32 42", // Black Sea
    "47 45 50 46.5 53 45.5 53 41 54 37 50 37 49 40 47.5 43", // Caspian
  ].map(P);

  function inside(x, y, p) {
    let c = false;
    for (let i = 0, j = p.length - 2; i < p.length; i += 2) {
      const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      j = i;
    }
    return c;
  }
  const isLand = (lon, lat) => LAND.some((p) => inside(lon, lat, p)) && !WATER.some((p) => inside(lon, lat, p));
  const px = (lon) => +(lon + 180).toFixed(1);
  const py = (lat) => +(TOP - lat).toFixed(1);

  function landPath() {
    let d = "";
    for (let lat = TOP - STEP / 2; lat > -57; lat -= STEP)
      for (let lon = -180 + STEP / 2; lon < 180; lon += STEP) if (isLand(lon, lat)) d += `M${px(lon)} ${py(lat)}h0`;
    return d;
  }

  
  const PLACES = {
    "us-east-1": [38.9, -77.4], "us-east-2": [40, -83], "us-west-1": [37.4, -122], "us-west-2": [45.6, -121.2],
    "ca-central-1": [45.5, -73.6], "sa-east-1": [-23.5, -46.6], "eu-west-1": [53.3, -6.3], "eu-west-2": [51.5, -0.1],
    "eu-west-3": [48.9, 2.4], "eu-central-1": [50.1, 8.7], "eu-north-1": [59.3, 18], "eu-south-1": [45.5, 9.2],
    "me-south-1": [26.2, 50.6], "me-central-1": [25.2, 55.3], "af-south-1": [-33.9, 18.4], "ap-south-1": [19.1, 72.9],
    "ap-southeast-1": [1.35, 103.8], "ap-southeast-2": [-33.9, 151.2], "ap-southeast-3": [-6.2, 106.8],
    "ap-northeast-1": [35.7, 139.7], "ap-northeast-2": [37.6, 127], "ap-northeast-3": [34.7, 135.5], "ap-east-1": [22.3, 114.2],
    virginia: [38.9, -77.4], ohio: [40, -83], oregon: [45.6, -121.2], california: [37.4, -122], "new york": [40.7, -74],
    texas: [32.8, -96.8], dallas: [32.8, -96.8], chicago: [41.9, -87.6], montreal: [45.5, -73.6], toronto: [43.7, -79.4],
    mexico: [19.4, -99.1], "sao paulo": [-23.5, -46.6], "são paulo": [-23.5, -46.6], santiago: [-33.4, -70.7],
    dublin: [53.3, -6.3], ireland: [53.3, -6.3], london: [51.5, -0.1], paris: [48.9, 2.4], frankfurt: [50.1, 8.7],
    stockholm: [59.3, 18], milan: [45.5, 9.2], madrid: [40.4, -3.7], amsterdam: [52.4, 4.9],
    bahrain: [26.2, 50.6], dubai: [25.2, 55.3], "tel aviv": [32.1, 34.8], cairo: [30, 31.2], lagos: [6.5, 3.4],
    nairobi: [-1.3, 36.8], johannesburg: [-26.2, 28], "cape town": [-33.9, 18.4],
    mumbai: [19.1, 72.9], delhi: [28.6, 77.2], bangalore: [13, 77.6], bengaluru: [13, 77.6], singapore: [1.35, 103.8],
    jakarta: [-6.2, 106.8], "hong kong": [22.3, 114.2], tokyo: [35.7, 139.7], osaka: [34.7, 135.5], seoul: [37.6, 127],
    manila: [14.6, 121], cebu: [10.3, 123.9], philippines: [12.9, 121.8], sydney: [-33.9, 151.2], melbourne: [-37.8, 145],
    auckland: [-36.9, 174.8],
    // Eastern Europe
    warsaw: [52.2, 21], prague: [50.1, 14.4], budapest: [47.5, 19], bucharest: [44.4, 26.1], sofia: [42.7, 23.3],
    belgrade: [44.8, 20.5], athens: [38, 23.7], istanbul: [41, 29], kyiv: [50.5, 30.5], kiev: [50.5, 30.5],
    vilnius: [54.7, 25.3], riga: [56.9, 24.1], tallinn: [59.4, 24.7], helsinki: [60.2, 25], minsk: [53.9, 27.6],
    // Russia
    moscow: [55.8, 37.6], "saint petersburg": [59.9, 30.3], "st petersburg": [59.9, 30.3], "st. petersburg": [59.9, 30.3],
    kaliningrad: [54.7, 20.5], kazan: [55.8, 49.1], yekaterinburg: [56.8, 60.6], novosibirsk: [55, 82.9],
    krasnoyarsk: [56, 92.9], irkutsk: [52.3, 104.3], vladivostok: [43.1, 131.9], russia: [55.8, 37.6],
  };
  const KEYS = Object.keys(PLACES).sort((a, b) => b.length - a.length);
  function locate(r) {
    if (Number.isFinite(+r.lat) && Number.isFinite(+r.lng) && r.lat !== "" && r.lng !== "" && r.lat != null && r.lng != null) return [+r.lat, +r.lng];
    const text = `${r.name} ${r.region || ""}`.toLowerCase();
    const k = KEYS.find((k) => text.includes(k));
    return k ? PLACES[k] : null;
  }

  let el = null, pins = [];
  const COLORS = () => Object.values(PG.panels.STATUS).reduce((o, s) => ((o[s.label] = s.color), o), {});

  function build() {
    const anchor = document.getElementById("panel-feed");
    if (!anchor) return false;
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.id = "panel-map";
    panel.innerHTML = `
      <div class="section-head"><h2>Global footprint</h2><span class="hint" id="mapHint"></span></div>
      <div class="chart-wrap map-wrap">
        <svg id="worldMap" viewBox="0 0 ${W} ${H}" role="img" aria-label="World map of regions">
          <path class="map-land" d="${landPath()}"/>
          <g id="mapPins"></g>
        </svg>
        <div class="tooltip" id="mapTip" hidden></div>
      </div>
      <div class="map-legend" id="mapLegend"></div>`;
    anchor.before(panel);
    el = {
      svg: panel.querySelector("#worldMap"),
      pins: panel.querySelector("#mapPins"),
      tip: panel.querySelector("#mapTip"),
      hint: panel.querySelector("#mapHint"),
      legend: panel.querySelector("#mapLegend"),
    };

    const show = (g) => {
      if (!g) return;
      const x = pins[g.dataset.i];
      if (!x) return;
      const { r, p } = x;
      el.tip.innerHTML = `<b>${PG.util.esc(r.name)}</b><span>${PG.util.esc(r.region || "")} · ${r.env === "prod" ? "production" : "staging"}</span><span>${r.load}% load · ${r.latency}ms · ${r.status}</span>`;
      el.tip.hidden = false;
      el.tip.style.left = (px(p[1]) / W) * 100 + "%";
      el.tip.style.top = (py(p[0]) / H) * 100 + "%";
    };
    const hide = () => (el.tip.hidden = true);
    el.pins.addEventListener("pointerover", (e) => {
      const g = e.target.closest(".map-pin");
      g ? show(g) : hide();
    });
    el.pins.addEventListener("pointerleave", hide);
    el.pins.addEventListener("focusin", (e) => show(e.target.closest(".map-pin")));
    el.pins.addEventListener("focusout", hide);
    PG.settings.onChange(render);
    return true;
  }

  function render() {
    if (!el && !build()) return;
    const env = (PG.getState && PG.getState().env) || "all";
    const rs = PG.panels.snapshot().filter((r) => env === "all" || r.env === env);
    const colors = COLORS();
    pins = [];
    const lost = [];
    rs.forEach((r) => {
      const p = locate(r);
      p ? pins.push({ r, p }) : lost.push(r);
    });
    el.pins.innerHTML = pins
      .map(({ r, p }, i) => {
        const cls = r.status === "Critical" ? "crit" : r.status === "Degraded" ? "warn" : "ok";
        const c = colors[r.status] || "#3ed486";
        const cx = px(p[1]), cy = py(p[0]);
        return `<g class="map-pin ${cls}" data-i="${i}" tabindex="0" role="img" style="color:${c}" aria-label="${PG.util.esc(r.name)}: ${r.status}, ${r.load}% load">
          <circle class="map-hit" cx="${cx}" cy="${cy}" r="6"/>
          <circle class="map-ring" cx="${cx}" cy="${cy}" r="2.4"/>
          <circle class="map-core" cx="${cx}" cy="${cy}" r="2.2"/></g>`;
      })
      .join("");
    const count = (s) => pins.filter((x) => x.r.status === s).length;
    el.legend.innerHTML =
      ["Healthy", "Degraded", "Critical"]
        .map((s) => `<span><i style="background:${colors[s]};box-shadow:0 0 6px ${colors[s]}"></i>${s} ${count(s)}</span>`)
        .join("") +
      (lost.length ? `<span class="map-lost">Can't place: ${lost.map((r) => PG.util.esc(r.name)).join(", ")}</span>` : "");
    el.hint.textContent = rs.length ? `${pins.length} of ${PG.util.plural(rs.length, "region")} placed` : "no regions yet";
  }

  PG.map = { render };
})();