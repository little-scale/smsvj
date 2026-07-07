// Geometry engine: every pattern is a distance field banded by the palette.
// A point's value = distance to a feature under some metric; floor(value/thickness)
// picks the CRAM band. Lattice period tiles it; rotation/spin twist it. Plus a few
// "cell" styles (weave/truchet/chevron) that don't reduce to a single metric.
//
// One `generate(params, w, h)` replaces all the hand-coded fill* functions, and the
// same params object drives the browser Generator panel.
window.SVJ = window.SVJ || {};
SVJ.generators = (function () {
  const idx = (v) => 1 + (((Math.floor(v) % 15) + 15) % 15);

  const METRICS = {
    euclidean: (x, y) => Math.hypot(x, y),                 // rings
    taxicab:   (x, y) => Math.abs(x) + Math.abs(y),        // diamonds
    chebyshev: (x, y) => Math.max(Math.abs(x), Math.abs(y)), // squares
    angular:   (x, y) => (Math.atan2(y, x) / (2 * Math.PI) + 0.5) * 64, // spokes/pie
  };
  const METRIC_KEYS = Object.keys(METRICS);
  const STYLES = ["metric", "weave", "truchet", "chevron", "wave", "grid", "plaid", "stripe", "brick"];

  // Cell styles ------------------------------------------------------------
  function weaveIdx(x, y, cell) {
    const over = (Math.floor(x / cell) + Math.floor(y / cell)) & 1;
    return idx((over ? (y % cell) : (x % cell)) + (over ? 0 : 7));
  }
  // Sine interference: sin(x) + sin(y) (with a slight freq offset -> moiré).
  function waveIdx(x, y, p) {
    const f = (2 * Math.PI) / (p.period || 32);
    const v = Math.sin(x * f) + Math.sin(y * f * 1.31 + p.spin);
    return idx(((v + 2) / 4) * 15 / (p.thickness || 1) * 4);
  }
  // Mesh: distance to the nearest grid line -> a woven lattice of bars.
  function gridIdx(x, y, p) {
    const per = p.period || 24, h = per / 2;
    const gx = Math.abs((x % per) - h), gy = Math.abs((y % per) - h);
    return idx(Math.min(gx, gy) / (p.thickness || 2));
  }
  // Plaid / tartan: warp + weft bands added where they cross. Tile-periodic.
  function plaidIdx(x, y, p) {
    const per = p.period || 24, th = p.thickness || 3;
    return idx(Math.floor((x % per) / th) + Math.floor((y % per) / th));
  }
  // Directional stripes (spin = 0 horiz, 1 vert, 2 diag, 3 anti-diag).
  function stripeIdx(x, y, p) {
    const per = p.period || 16, th = p.thickness || 2, dir = p.spin | 0;
    const pos = dir === 0 ? y : dir === 1 ? x : dir === 2 ? x + y : x - y + 512;
    return idx(Math.floor((((pos % per) + per) % per) / th));
  }
  // Offset brick wall with mortar lines. period = brick width, cell = height.
  function brickIdx(x, y, p) {
    const bw = p.period || 32, bh = p.cell || 16, th = p.thickness || 2;
    const off = (Math.floor(y / bh) & 1) * (bw >> 1);
    const cx = (((x + off) % bw) + bw) % bw, cy = y % bh;
    const ex = Math.min(cx, bw - 1 - cx), ey = Math.min(cy, bh - 1 - cy);
    return idx(Math.min(ex, ey) / th);
  }
  function truchetIdx(x, y, cell) {
    const cx = x % cell, cy = y % cell;
    const orient = (Math.floor(x / cell) ^ Math.floor(y / cell)) & 1;
    const d = orient
      ? Math.min(Math.hypot(cx, cy), Math.hypot(cell - cx, cell - cy))
      : Math.min(Math.hypot(cell - cx, cy), Math.hypot(cx, cell - cy));
    return idx(d / 1.4);
  }
  function chevronIdx(x, y, cell) {
    const v = Math.abs((x % (cell * 2)) - cell);
    return idx((y + v) / 3);
  }

  // params: { style, metric, period, thickness, rotation(deg), spin, cell }
  function defaults() {
    return { style: "metric", metric: "taxicab", period: 64, thickness: 3, rotation: 0, spin: 0, cell: 16 };
  }

  function generate(params, w, h) {
    const p = Object.assign(defaults(), params);
    const rot = (p.rotation * Math.PI) / 180;
    const cosr = Math.cos(rot), sinr = Math.sin(rot);
    const metric = METRICS[p.metric] || METRICS.taxicab;
    const px = [];
    for (let y = 0; y < h; y++) {
      const row = new Array(w);
      for (let x = 0; x < w; x++) {
        if (p.style === "weave") { row[x] = weaveIdx(x, y, p.cell); continue; }
        if (p.style === "truchet") { row[x] = truchetIdx(x, y, p.cell); continue; }
        if (p.style === "chevron") { row[x] = chevronIdx(x, y, p.cell); continue; }
        if (p.style === "wave") { row[x] = waveIdx(x, y, p); continue; }
        if (p.style === "grid") { row[x] = gridIdx(x, y, p); continue; }
        if (p.style === "plaid") { row[x] = plaidIdx(x, y, p); continue; }
        if (p.style === "stripe") { row[x] = stripeIdx(x, y, p); continue; }
        if (p.style === "brick") { row[x] = brickIdx(x, y, p); continue; }
        // metric style: optional lattice fold, then rotate coords, then measure.
        let px_ = x, py_ = y;
        if (p.period > 0) { px_ = (x % p.period) - p.period / 2; py_ = (y % p.period) - p.period / 2; }
        const rx = px_ * cosr - py_ * sinr;
        const ry = px_ * sinr + py_ * cosr;
        let d = metric(rx, ry);
        if (p.spin) d += p.spin * (Math.atan2(ry, rx) / (2 * Math.PI)); // -> spiral
        row[x] = idx(d / Math.max(0.5, p.thickness));
      }
      px.push(row);
    }
    return px;
  }

  return { generate, defaults, METRIC_KEYS, STYLES, idx };
})();
