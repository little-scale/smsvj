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
    tide:     { rp: 3.6, gp: 4.6, bp: 0.4, freq: 1, backdrop: 0 },     // cyan/violet
  };

  // ---- source pattern generators ------------------------------------------
  // Each fills px[y][x] with a CRAM index 0..15. Quarter-mode patterns radiate
  // from (0,0) since that corner maps to the kaleidoscope centre after the fold.
  function fillRings(px, w, h) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.sqrt(x * x + y * y);
      px[y][x] = 1 + (Math.floor(d / 6) % 15);
    }
  }
  function fillXor(px, w, h) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      px[y][x] = 1 + (((x >> 3) ^ (y >> 3)) % 15);
    }
  }
  function fillSpiral(px, w, h) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = Math.atan2(y + 0.5, x + 0.5);
      const r = Math.sqrt(x * x + y * y);
      px[y][x] = 1 + (((Math.floor((a / (Math.PI / 2)) * 15) + Math.floor(r / 4)) % 15) + 15) % 15;
    }
  }
  // Full-frame lattice: a 64px diamond motif tiled across the screen. Repetition
  // keeps the unique-tile count small in full mode (no fold to shrink it).
  function fillLattice(px, w, h) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x % 64) - 32, v = (y % 64) - 32;
      const d = Math.abs(u) + Math.abs(v);
      px[y][x] = 1 + (Math.floor(d / 3) % 15);
    }
  }

  function fx(type, p0, p1, p2) { return { type, p0: p0 | 0, p1: p1 | 0, p2: p2 | 0 }; }
  function mv(type, division, range_start, range_len) {
    return { type, division, range_start, range_len };
  }

  // ---- the four scene definitions -----------------------------------------
  const DEFS = [
    { // 0 — MANDALA: concentric rings, 4-way fold + a no-fold variant.
      mode: "quarter", gen: fillRings, variants: [0, 3], theme: "spectrum", primary: 1,
      effects: [fx(0x00, 0, 0, 0), fx(0x01, 1, 0, 0), fx(0x02, 0, 1, 15), fx(0x03, 1, 1, 15)],
      movements: [mv(0x00, 1, 0, 0), mv(0x01, 4, 1, 15), mv(0x02, 2, 1, 15), mv(0x03, 8, 1, 15)],
    },
    { // 1 — GRID: XOR lattice, 4-way + H-mirror variant.
      mode: "quarter", gen: fillXor, variants: [0, 1], theme: "neon", primary: 8,
      effects: [fx(0x00, 0, 0, 0), fx(0x01, 1, 0, 0), fx(0x03, 2, 1, 15), fx(0x06, 0, 0, 0)],
      movements: [mv(0x00, 1, 0, 0), mv(0x01, 2, 1, 15), mv(0x02, 4, 1, 8), mv(0x03, 4, 8, 8)],
    },
    { // 2 — LATTICE: full-frame tiled diamonds (single layout; WOBBLE is legal here).
      mode: "full", gen: fillLattice, variants: [0], theme: "tide", primary: 15,
      effects: [fx(0x00, 0, 0, 0), fx(0x02, 0, 0, 16), fx(0x03, 1, 1, 15), fx(0x05, 4, 8, 0)],
      movements: [mv(0x00, 1, 0, 0), mv(0x01, 8, 1, 15), mv(0x02, 4, 1, 15), mv(0x03, 2, 1, 15)],
    },
    { // 3 — SPIRAL: rotating arms, 4-way + V-mirror variant; boots already moving.
      mode: "quarter", gen: fillSpiral, variants: [0, 2], theme: "ember", primary: 4,
      effects: [fx(0x00, 0, 0, 0), fx(0x01, 1, 0, 0), fx(0x02, 0, 1, 15), fx(0x03, 1, 1, 15)],
      movements: [mv(0x01, 4, 1, 15), mv(0x00, 1, 0, 0), mv(0x02, 8, 1, 15), mv(0x03, 4, 1, 15)],
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
      mode, gen: mode === "quarter" ? fillRings : fillLattice,
      variants: [0], theme: "spectrum", primary: 1,
      effects: defaultEffects(), movements: defaultMovements(),
    });
  }
  function defaultEffects() {
    return [fx(0x00, 0, 0, 0), fx(0x02, 0, 0, 16), fx(0x03, 1, 1, 15), fx(0x06, 0, 0, 0)];
  }
  function defaultMovements() {
    return [mv(0x00, 1, 0, 0), mv(0x01, 4, 1, 15), mv(0x02, 4, 1, 15), mv(0x03, 2, 1, 15)];
  }

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
