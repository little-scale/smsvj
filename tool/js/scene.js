// Bank / scene data model + defaults. Four of everything (see SCENE_FORMAT §1).
window.SVJ = window.SVJ || {};
SVJ.scene = (function () {
  const C = SVJ.color;

  function emptyPixels(mode) {
    const g = SVJ.fold.geometry(mode);
    const px = [];
    for (let y = 0; y < g.pxH; y++) px.push(new Array(g.pxW).fill(0));
    return px;
  }

  // A 16-colour ramp packed into CRAM bank 0; bank 1 gets a shifted variant.
  function rampPalette(shift) {
    const pal = new Uint8Array(32);
    for (let i = 0; i < 16; i++) {
      // Sweep hue-ish by walking R,G,B channels across the 16 steps.
      const t = (i + shift) & 15;
      const r = Math.min(3, Math.round((Math.sin((t / 16) * Math.PI * 2) * 0.5 + 0.5) * 3));
      const gch = Math.min(3, Math.round((Math.sin((t / 16) * Math.PI * 2 + 2.1) * 0.5 + 0.5) * 3));
      const b = Math.min(3, Math.round((Math.sin((t / 16) * Math.PI * 2 + 4.2) * 0.5 + 0.5) * 3));
      pal[i] = (b << 4) | (gch << 2) | r;
      pal[16 + i] = pal[i]; // bank 1 mirrors bank 0 by default
    }
    pal[0] = 0; // backdrop colour 0 = black
    return pal;
  }

  // Seed a quarter with a concentric pattern so the fold is immediately visible.
  function seedQuarter(px) {
    const g = SVJ.fold.geometry("quarter");
    for (let y = 0; y < g.pxH; y++) {
      for (let x = 0; x < g.pxW; x++) {
        const d = Math.sqrt(x * x + y * y);
        px[y][x] = 1 + (Math.floor(d / 6) % 15);
      }
    }
  }

  function defaultEffects() {
    return [
      { type: 0x00, p0: 0, p1: 0, p2: 0 },           // NONE
      { type: 0x02, p0: 0, p1: 0, p2: 16 },          // INVERT bank 0
      { type: 0x03, p0: 1, p1: 1, p2: 15 },          // ROTATE +1 over entries 1..15
      { type: 0x06, p0: 0, p1: 0, p2: 0 },           // BLANK to backdrop 0
    ];
  }
  function defaultMovements() {
    return [
      { type: 0x00, division: 1, range_start: 0, range_len: 0 },   // STATIC
      { type: 0x01, division: 4, range_start: 1, range_len: 15 },  // CYCLE_FWD / beat
      { type: 0x02, division: 4, range_start: 1, range_len: 15 },  // CYCLE_BACK / beat
      { type: 0x03, division: 2, range_start: 1, range_len: 15 },  // PINGPONG / 1/8
    ];
  }

  function makeScene(mode) {
    const px = emptyPixels(mode);
    if (mode === "quarter") seedQuarter(px);
    return {
      mode,                       // "quarter" | "full"
      pixels: px,                 // [y][x] CRAM indices
      variants: [0],              // layout variants to bake (0=4way,1=Honly,2=Vonly,3=none)
      bank: 0,                    // CRAM bank select for name-table words
      priority: 0,
      palettes: [rampPalette(0), rampPalette(4), rampPalette(8), rampPalette(12)],
      primary: [1, 1, 1, 1],      // freeze target CRAM index per palette
      effects: defaultEffects(),
      movements: defaultMovements(),
    };
  }

  function makeBank() {
    return {
      region: 0,                  // bit0: 0=60Hz
      default_bpm: 120,
      boot: { scene: 0, palette: 0, effect: 0, movement: 0 },
      scenes: [makeScene("quarter"), makeScene("quarter"), makeScene("full"), makeScene("quarter")],
    };
  }

  return { emptyPixels, rampPalette, makeScene, makeBank, defaultEffects, defaultMovements };
})();
