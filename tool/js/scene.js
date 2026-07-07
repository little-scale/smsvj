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

  // Patterns are now geometry: each scene carries a `generator` params object
  // (see generators.js) that produces the source pixels. Same params drive the
  // browser Generator panel, so authoring == dialling geometry.

  function fx(type, p0, p1, p2) { return { type, p0: p0 | 0, p1: p1 | 0, p2: p2 | 0 }; }
  function mv(type, division, range_start, range_len) {
    return { type, division, range_start, range_len };
  }

  // Shared axis config: NONE/INVERT/ROTATE/BLANK, and 4 movements where slot 0
  // FLOWS (boot movement) and slot 3 is STATIC to stop motion.
  const EFFECTS = () => [fx(0x00, 0, 0, 0), fx(0x02, 0, 1, 15), fx(0x03, 1, 1, 15), fx(0x06, 0, 0, 0)];
  const FLOW = () => [mv(0x01, 1, 1, 15), mv(0x02, 2, 1, 15), mv(0x03, 1, 1, 15), mv(0x00, 1, 0, 0)];

  const G = (o) => Object.assign(SVJ.generators.defaults(), o);

  // ---- the four scene definitions: a repeating-lattice set, all flowing ----
  const DEFS = [
    { // 0 — DIAMONDS: uniform full-frame nested diamonds (taxicab metric).
      mode: "full", generator: G({ style: "metric", metric: "taxicab", period: 64, thickness: 3 }),
      variants: [0], theme: "tide", primary: 8, effects: EFFECTS(), movements: FLOW(),
    },
    { // 1 — WEAVE: basket weave folded into a 4-way symmetric quilt.
      mode: "quarter", generator: G({ style: "weave", cell: 16 }),
      variants: [0], theme: "candy", primary: 8, effects: EFFECTS(), movements: FLOW(),
    },
    { // 2 — TRUCHET: flowing woven curves, warm palette.
      mode: "quarter", generator: G({ style: "truchet", cell: 16 }),
      variants: [0], theme: "sunset", primary: 8, effects: EFFECTS(), movements: FLOW(),
    },
    { // 3 — CHEVRON: marching zigzags, hi-sat neon.
      mode: "quarter", generator: G({ style: "chevron", cell: 16 }),
      variants: [0], theme: "neon", primary: 8, effects: EFFECTS(), movements: FLOW(),
    },
  ];

  function makeSceneFrom(def) {
    const g = SVJ.fold.geometry(def.mode);
    return {
      mode: def.mode,
      generator: Object.assign({}, def.generator),
      pixels: SVJ.generators.generate(def.generator, g.pxW, g.pxH),
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
      mode,
      generator: mode === "quarter" ? G({ style: "weave", cell: 16 })
                                    : G({ style: "metric", metric: "taxicab", period: 64, thickness: 3 }),
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
