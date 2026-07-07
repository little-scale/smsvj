// Bank / scene data model + defaults. Four of everything (see SCENE_FORMAT §1).
// Ships a full 4-scene demo bank: each scene has a distinct source pattern, a themed
// set of 4 palettes, and tuned effects/movements.
window.SVJ = window.SVJ || {};
SVJ.scene = (function () {
  const clampCh = (v) => Math.max(0, Math.min(3, Math.round(v)));

  function emptyPixels(mode) {
    const g = SVJ.fold.geometry(mode);
    const px = [];
    for (let y = 0; y < g.pxH; y++) px.push(new Array(g.pxW).fill(0));
    return px;
  }

  // ---- palette themes ------------------------------------------------------
  // Build a 16-colour ramp from three sine channels; mirror to CRAM bank 1.
  // entry 0 is forced to the backdrop colour.
  function ramp(opts) {
    const { rp = 0, gp = 2.1, bp = 4.2, freq = 1, backdrop = 0 } = opts;
    const pal = new Uint8Array(32);
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2 * freq;
      const r = clampCh((Math.sin(t + rp) * 0.5 + 0.5) * 3);
      const g = clampCh((Math.sin(t + gp) * 0.5 + 0.5) * 3);
      const b = clampCh((Math.sin(t + bp) * 0.5 + 0.5) * 3);
      pal[i] = (b << 4) | (g << 2) | r;
      pal[16 + i] = pal[i];
    }
    pal[0] = backdrop & 0x3f;   // bank 0 backdrop
    pal[16] = backdrop & 0x3f;  // bank 1 entry 0 = SMS border/backdrop colour
    return pal;
  }
  // A theme = four palettes (the B1+←/→ options), each a hue-rotated sibling.
  function theme(base) {
    return [0, 1.6, 3.1, 4.7].map((d) =>
      ramp({ rp: base.rp + d, gp: base.gp + d, bp: base.bp + d, freq: base.freq, backdrop: base.backdrop })
    );
  }
  const THEMES = {
    spectrum: { rp: 0, gp: 2.1, bp: 4.2, freq: 1, backdrop: 0 },       // full rainbow
    ember:    { rp: 0.2, gp: 0.8, bp: 1.4, freq: 1, backdrop: 0 },     // fire/warm
    neon:     { rp: 1.0, gp: 3.0, bp: 5.0, freq: 2, backdrop: 0 },     // punchy hi-sat
    tide:     { rp: 3.6, gp: 4.6, bp: 0.4, freq: 1, backdrop: 0 },     // yellow/blue
    candy:    { rp: 0.0, gp: 1.2, bp: 5.4, freq: 1.5, backdrop: 0 },   // pink/magenta/cyan
    forest:   { rp: 2.6, gp: 1.4, bp: 3.2, freq: 1, backdrop: 0 },     // green/gold
    uv:       { rp: 4.4, gp: 5.4, bp: 3.4, freq: 1.5, backdrop: 0 },   // violet/blue
    sunset:   { rp: 0.3, gp: 1.1, bp: 2.6, freq: 1, backdrop: 0 },     // orange/pink/purple
  };

  // ---- source pattern generators (all repeating / tileable) ---------------
  // Each fills px[y][x] with a CRAM index 0..15. Periodic so they read as a
  // lattice; quarter mode then folds them into a 4-way symmetric quilt, full
  // mode tiles them straight. idx() wraps a value into the live range 1..15.
  const idx = (v) => 1 + (((v % 15) + 15) % 15);

  // Nested diamonds (taxicab metric). period = tile pitch, div = band thickness.
  function fillDiamonds(px, w, h, period, div) {
    const p = period || 64, d = div || 3, half = p / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x % p) - half, v = (y % p) - half;
      px[y][x] = idx(Math.floor((Math.abs(u) + Math.abs(v)) / d));
    }
  }
  // Concentric squares (Chebyshev metric) -> boxed-in rings.
  function fillNested(px, w, h) {
    const p = 48, half = 24;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = Math.abs((x % p) - half), v = Math.abs((y % p) - half);
      px[y][x] = idx(Math.floor(Math.max(u, v) / 2));
    }
  }
  // Basket weave: alternating horizontal / vertical strands, shaded across.
  function fillWeave(px, w, h) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const over = (Math.floor(x / 16) + Math.floor(y / 16)) & 1;
      const v = over ? (y % 16) : (x % 16);
      px[y][x] = idx(v + (over ? 0 : 7));
    }
  }
  // Truchet: quarter-arc tiles that alternate orientation -> flowing woven curves.
  function fillTruchet(px, w, h) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const cx = x % 16, cy = y % 16;
      const orient = (Math.floor(x / 16) ^ Math.floor(y / 16)) & 1;
      const d = orient
        ? Math.min(Math.hypot(cx, cy), Math.hypot(16 - cx, 16 - cy))
        : Math.min(Math.hypot(16 - cx, cy), Math.hypot(cx, 16 - cy));
      px[y][x] = idx(Math.floor(d / 1.4));
    }
  }
  // Zigzag chevrons marching down the screen.
  function fillChevron(px, w, h) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = Math.abs((x % 32) - 16);
      px[y][x] = idx(Math.floor((y + v) / 3));
    }
  }

  function fx(type, p0, p1, p2) { return { type, p0: p0 | 0, p1: p1 | 0, p2: p2 | 0 }; }
  function mv(type, division, range_start, range_len) {
    return { type, division, range_start, range_len };
  }

  // Shared axis config: NONE/INVERT/ROTATE/BLANK, and 4 movements where slot 0
  // FLOWS (boot movement) and slot 3 is STATIC to stop motion.
  const EFFECTS = () => [fx(0x00, 0, 0, 0), fx(0x02, 0, 1, 15), fx(0x03, 1, 1, 15), fx(0x06, 0, 0, 0)];
  const FLOW = () => [mv(0x01, 1, 1, 15), mv(0x02, 2, 1, 15), mv(0x03, 1, 1, 15), mv(0x00, 1, 0, 0)];

  // ---- the four scene definitions: a repeating-lattice set, all flowing ----
  const DEFS = [
    { // 0 — DIAMONDS: uniform full-frame nested diamonds (the yellow/blue lattice).
      mode: "full", gen: (p, w, h) => fillDiamonds(p, w, h, 64, 3), variants: [0],
      theme: "tide", primary: 8, effects: EFFECTS(), movements: FLOW(),
    },
    { // 1 — WEAVE: basket weave folded into a 4-way symmetric quilt.
      mode: "quarter", gen: fillWeave, variants: [0], theme: "candy", primary: 8,
      effects: EFFECTS(), movements: FLOW(),
    },
    { // 2 — TRUCHET: flowing woven curves, warm palette.
      mode: "quarter", gen: fillTruchet, variants: [0], theme: "sunset", primary: 8,
      effects: EFFECTS(), movements: FLOW(),
    },
    { // 3 — CHEVRON: marching zigzags, hi-sat neon.
      mode: "quarter", gen: fillChevron, variants: [0], theme: "neon", primary: 8,
      effects: EFFECTS(), movements: FLOW(),
    },
  ];

  function makeSceneFrom(def) {
    const px = emptyPixels(def.mode);
    const g = SVJ.fold.geometry(def.mode);
    def.gen(px, g.pxW, g.pxH);
    return {
      mode: def.mode,
      pixels: px,
      variants: def.variants.slice(),
      tileBudget: def.tileBudget || 48,   // cap for fast scene/tile swaps
      bank: 0,
      priority: 0,
      palettes: theme(THEMES[def.theme]),
      primary: [def.primary, def.primary, def.primary, def.primary],
      effects: def.effects.map((e) => ({ ...e })),
      movements: def.movements.map((m) => ({ ...m })),
    };
  }

  // A blank scene of a given mode (used by the UI when switching modes).
  function makeScene(mode) {
    return makeSceneFrom({
      mode, gen: mode === "quarter" ? fillWeave : (p, w, h) => fillDiamonds(p, w, h, 64, 3),
      variants: [0], theme: "spectrum", primary: 8,
      effects: EFFECTS(), movements: FLOW(),
    });
  }
  function defaultEffects() { return EFFECTS(); }
  function defaultMovements() { return FLOW(); }

  function makeBank() {
    return {
      region: 0,
      default_bpm: 120,
      boot: { scene: 0, palette: 0, effect: 0, movement: 0 },
      scenes: DEFS.map(makeSceneFrom),
    };
  }

  return { emptyPixels, ramp, makeScene, makeBank, defaultEffects, defaultMovements };
})();
