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
  // Effect DIAL (B1 up/down): NONE at centre (index 4). Push DOWN for colour
  // effects, UP for glitch corruption. Corruption rates are per-frame (see the
  // runtime's speed control). SCRAMBLE p0=flip cells,p1=tile swaps; SMEAR
  // p0=cells,p1=drag offset (1=horizontal, 32=one row = vertical).
  const EFFECTS = () => [
    fx(0x0a, 12, 33, 0),    // 0 SMEAR-D  (diagonal drag)   down end
    fx(0x0d, 3, 0, 0),      // 1 STAMP    (tile convergence)
    fx(0x0c, 10, 0, 0),     // 2 XOR      (bit-flip patterns)
    fx(0x0b, 16, 0, 0),     // 3 MORPH    (tile-index drift)
    fx(0x00, 0, 0, 0),      // 4 NONE     (centre)
    fx(0x08, 8, 3, 0),      // 5 SCRAMBLE (flip + swap)
    fx(0x0a, 12, 1, 0),     // 6 SMEAR-H
    fx(0x0a, 12, 32, 0),    // 7 SMEAR-V
    fx(0x09, 8, 6, 0),      // 8 CHURN    (boil)            up end
  ];
  // Movement axis of 7. "up" = CYCLE_BACK (radials flow outward), "down" = CYCLE_FWD.
  // Types: 1=fwd, 2=back, 3=wobble A (pingpong), 4=wobble B (pingpong, anti-phase).
  const FLOW = () => [
    mv(0x02, 4, 1, 15),   // 0 slow up (outward)
    mv(0x01, 4, 1, 15),   // 1 slow down
    mv(0x02, 1, 1, 15),   // 2 fast up
    mv(0x01, 1, 1, 15),   // 3 fast down
    mv(0x03, 1, 1, 15),   // 4 wobble A
    mv(0x04, 1, 1, 15),   // 5 wobble B
    mv(0x00, 1, 0, 0),    // 6 none
  ];

  const G = (o) => Object.assign(SVJ.generators.defaults(), o);

  // 16 GLOBAL palettes, paired 1:1 with the 16 tilesets (importing a .svjt into
  // tileset N drops its palette into palette slot N). Still globally selectable, so
  // palette and tileset stay independent on the pad. Slots 0-7 are the hand-tuned
  // themes; 8-15 are hue-shifted variants for a full 16.
  const shift = (t, d) => ({ ...t, rp: t.rp + d, gp: t.gp + d, bp: t.bp + d });
  const BASE_THEMES = [THEMES.spectrum, THEMES.ember, THEMES.tide, THEMES.uv,
    THEMES.candy, THEMES.forest, THEMES.sunset, THEMES.neon];
  const GLOBAL_PALETTES = [
    ...BASE_THEMES.map((t) => ramp(t)),
    ...BASE_THEMES.map((t) => ramp(shift(t, 2.4))),
  ];

  // 16 fresh tilesets — a mix of rich radial/interference work (folded mandalas,
  // moiré) and bolder lattices. Cap back up to 48 unique tiles.
  const sc = (mode, gen) => ({ mode, generator: G(gen), variants: [0], primary: 8,
    tileBudget: 48, effects: EFFECTS(), movements: FLOW() });
  const DEFS = [
    sc("full",    { style: "wave", period: 48, spin: 0.7 }),                                       // soft interference
    sc("quarter", { style: "star", spin: 6, period: 7, thickness: 4 }),                            // flower mandala
    sc("quarter", { style: "star", spin: 10, period: 10, thickness: 3 }),                          // star mandala
    sc("quarter", { style: "metric", metric: "euclidean", period: 0, spin: 100, thickness: 4 }),   // spiral
    sc("quarter", { style: "metric", metric: "angular", period: 0, thickness: 3 }),                // pinwheel
    sc("quarter", { style: "metric", metric: "taxicab", period: 0, thickness: 5 }),                // diamond mandala
    sc("quarter", { style: "truchet", cell: 16 }),                                                 // woven maze
    sc("quarter", { style: "metric", metric: "chebyshev", period: 0, thickness: 5 }),              // square mandala
    sc("quarter", { style: "metric", metric: "euclidean", period: 0, thickness: 5 }),              // ring mandala
    sc("full",    { style: "wave", period: 32, spin: 1.9 }),                                        // fine interference
    sc("full",    { style: "metric", metric: "taxicab", period: 48, rotation: 45, thickness: 4 }), // big argyle
    sc("full",    { style: "plaid", period: 40, thickness: 4 }),                                    // large tartan
    sc("full",    { style: "grid", period: 40, thickness: 5 }),                                     // bold mesh
    sc("full",    { style: "brick", period: 48, cell: 24, thickness: 3 }),                          // large brick
    sc("quarter", { style: "chevron", cell: 24 }),                                                  // chevron quilt
    sc("quarter", { style: "metric", metric: "angular", period: 0, spin: 30, thickness: 2 }),       // spiral pinwheel
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
      palettes: GLOBAL_PALETTES.map((p) => Uint8Array.from(p)), // 16 global palettes
      primary: new Array(16).fill(def.primary),
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
      boot: { scene: 0, palette: 0, effect: 4, movement: 0 }, // effect 4 = NONE (dial centre)
      scenes: DEFS.map(makeSceneFrom),
    };
  }

  return { emptyPixels, ramp, makeScene, makeBank, defaultEffects, defaultMovements };
})();
