// Geometry engine: every pattern is a distance field banded by the palette.
// A point's value = distance to a feature under some metric; floor(value/thickness)
// picks the CRAM band. Lattice period tiles it; rotation/spin twist it. Plus a few
// "cell" styles (weave/truchet/chevron) that don't reduce to a single metric.
//
// One `generate(params, w, h)` replaces all the hand-coded fill* functions, and the
// same params object drives the browser Generator panel.
//
// The four "universal" dials reach as many styles as sensibly possible:
//   rotation - rotates the sample coordinates about the centre for EVERY style.
//   thickness - band-width divisor honoured by every style.
//   spin      - per-style twist (spiral / phase / petals / shear / stripe direction).
//   cell/period - the tiling scale (cell for cell styles, period for lattice styles).
window.SVJ = window.SVJ || {};
SVJ.generators = (function () {
  const idx = (v) => 1 + (((Math.floor(v) % 15) + 15) % 15);
  const mod = (a, b) => ((a % b) + b) % b;          // safe for the fractional coords rotation produces
  const th_ = (p, d) => Math.max(0.5, p.thickness || d);

  const METRICS = {
    euclidean: (x, y) => Math.hypot(x, y),                 // rings
    taxicab:   (x, y) => Math.abs(x) + Math.abs(y),        // diamonds
    chebyshev: (x, y) => Math.max(Math.abs(x), Math.abs(y)), // squares
    angular:   (x, y) => (Math.atan2(y, x) / (2 * Math.PI) + 0.5) * 64, // spokes/pie
  };
  const METRIC_KEYS = Object.keys(METRICS);
  const STYLES = ["metric", "weave", "truchet", "chevron", "wave", "grid", "plaid", "stripe", "brick", "star"];

  // Cell styles ------------------------------------------------------------
  // Over/under basketweave. cell = weave size, thickness = band width,
  // spin = diagonal phase shift between the two thread directions.
  function weaveIdx(x, y, p) {
    const cell = p.cell || 16, th = th_(p, 4) * 0.5;
    const over = (Math.floor(x / cell) + Math.floor(y / cell)) & 1;
    const shift = (p.spin || 0) / 45;
    const v = (over ? mod(y, cell) : mod(x, cell) + shift) + (over ? 0 : cell / 2);
    return idx(v / th);
  }
  // Sine interference: sin(x) + sin(y) (with a slight freq offset -> moiré).
  // period = wavelength, spin = phase of the second axis, thickness = band width,
  // cell = detune of the second axis (higher = tighter moiré).
  function waveIdx(x, y, p) {
    const f = (2 * Math.PI) / (p.period || 32);
    const detune = 1 + ((p.cell || 16) - 16) / 64;
    const v = Math.sin(x * f) + Math.sin(y * f * detune + p.spin);
    return idx(((v + 2) / 4) * 15 / th_(p, 1) * 4);
  }
  // Mesh: distance to the nearest grid line -> a woven lattice of bars.
  // period = spacing, thickness = bar width, spin = shear (parallelogram cells).
  function gridIdx(x, y, p) {
    const per = p.period || 24, h = per / 2, sh = (p.spin || 0) / 90;
    const gx = Math.abs(mod(x + y * sh, per) - h), gy = Math.abs(mod(y, per) - h);
    return idx(Math.min(gx, gy) / th_(p, 2));
  }
  // Plaid / tartan: warp + weft bands added where they cross. Tile-periodic.
  // period = block size, thickness = band step, spin = shear.
  function plaidIdx(x, y, p) {
    const per = p.period || 24, th = Math.max(1, p.thickness || 3), sh = (p.spin || 0) / 90;
    return idx(Math.floor(mod(x + y * sh, per) / th) + Math.floor(mod(y, per) / th));
  }
  // Directional stripes (spin = 0 horiz, 1 vert, 2 diag, 3 anti-diag).
  function stripeIdx(x, y, p) {
    const per = p.period || 16, th = Math.max(1, p.thickness || 2), dir = p.spin | 0;
    const pos = dir === 0 ? y : dir === 1 ? x : dir === 2 ? x + y : x - y + 512;
    return idx(Math.floor(mod(pos, per) / th));
  }
  // Star / flower: concentric bands whose radius is modulated by the angle, so
  // rings bulge into petals. spin = petal count, period = petal depth,
  // thickness = ring spacing, cell = swirl (rotates petals with radius).
  function starIdx(x, y, p) {
    const a = Math.atan2(y + 0.5, x + 0.5);
    const r = Math.hypot(x, y);
    const swirl = ((p.cell || 16) - 16) / 32 * r;
    return idx((r + Math.cos(a * (p.spin || 6) + swirl) * (p.period || 8)) / th_(p, 4));
  }
  // Offset brick wall with mortar lines. period = brick width, cell = height,
  // thickness = mortar bevel.
  function brickIdx(x, y, p) {
    const bw = p.period || 32, bh = p.cell || 16, th = th_(p, 2);
    const off = (Math.floor(y / bh) & 1) * (bw >> 1);
    const cx = mod(x + off, bw), cy = mod(y, bh);
    const ex = Math.min(cx, bw - 1 - cx), ey = Math.min(cy, bh - 1 - cy);
    return idx(Math.min(ex, ey) / th);
  }
  // Truchet arcs. cell = tile size, thickness = arc width.
  function truchetIdx(x, y, p) {
    const cell = p.cell || 16, th = th_(p, 3) * 0.5;
    const cx = mod(x, cell), cy = mod(y, cell);
    const orient = (Math.floor(x / cell) ^ Math.floor(y / cell)) & 1;
    const d = orient
      ? Math.min(Math.hypot(cx, cy), Math.hypot(cell - cx, cell - cy))
      : Math.min(Math.hypot(cell - cx, cy), Math.hypot(cx, cell - cy));
    return idx(d / th);
  }
  // Zig-zag chevrons. cell = zig width, thickness = band height, period = extra rise.
  function chevronIdx(x, y, p) {
    const cell = p.cell || 16, th = Math.max(1, p.thickness || 3);
    const v = Math.abs(mod(x, cell * 2) - cell) * (1 + (p.period || 0) / 64);
    return idx((y + v) / th);
  }

  const CELL_FN = {
    weave: weaveIdx, truchet: truchetIdx, chevron: chevronIdx, wave: waveIdx,
    grid: gridIdx, plaid: plaidIdx, stripe: stripeIdx, brick: brickIdx, star: starIdx,
  };

  // params: { style, metric, period, thickness, rotation(deg), spin, cell }
  function defaults() {
    return { style: "metric", metric: "taxicab", period: 64, thickness: 3, rotation: 0, spin: 0, cell: 16 };
  }

  function generate(params, w, h) {
    const p = Object.assign(defaults(), params);
    const rot = (p.rotation * Math.PI) / 180;
    const cosr = Math.cos(rot), sinr = Math.sin(rot);
    const metric = METRICS[p.metric] || METRICS.taxicab;
    const cx = w / 2, cy = h / 2;
    const fn = CELL_FN[p.style];
    const px = [];
    for (let y = 0; y < h; y++) {
      const row = new Array(w);
      for (let x = 0; x < w; x++) {
        if (p.style === "metric") {
          // metric keeps its own fold-then-rotate (rotation twists within the cell).
          let px_ = x, py_ = y;
          if (p.period > 0) { px_ = (x % p.period) - p.period / 2; py_ = (y % p.period) - p.period / 2; }
          const rx = px_ * cosr - py_ * sinr, ry = px_ * sinr + py_ * cosr;
          let d = metric(rx, ry);
          if (p.spin) d += p.spin * (Math.atan2(ry, rx) / (2 * Math.PI)); // -> spiral
          row[x] = idx(d / Math.max(0.5, p.thickness));
          continue;
        }
        // Every other style: rotate the sample coords about the centre first, so
        // the rotation dial works everywhere, then band.
        let sx = x, sy = y;
        if (p.rotation) {
          const dx = x - cx, dy = y - cy;
          sx = dx * cosr - dy * sinr + cx;
          sy = dx * sinr + dy * cosr + cy;
        }
        row[x] = (fn || gridIdx)(sx, sy, p);
      }
      px.push(row);
    }
    return px;
  }

  return { generate, defaults, METRIC_KEYS, STYLES, idx };
})();
