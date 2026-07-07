// The kaleidoscope fold + name-table construction. THIS is the tool's job, not the
// runtime's: we bake a quarter (or a full frame) into finished 32x24 name tables and
// dedupe tiles (incl. flips) so the ROM only ever writes bytes and flips register 2.
window.SVJ = window.SVJ || {};
SVJ.fold = (function () {
  const T = SVJ.tiles;
  const COLS = 32, ROWS = 24; // full-screen name table in tiles

  // Authoring geometry per mode.
  function geometry(mode) {
    return mode === "quarter"
      ? { tilesW: 16, tilesH: 12, pxW: 128, pxH: 96 }
      : { tilesW: 32, tilesH: 24, pxW: 256, pxH: 192 };
  }

  // Slice a pixel canvas (2D array [y][x] of CRAM indices) into row-major 8x8 tiles.
  // Returns { tileList, grid } where grid[ty][tx] = index into tileList.
  function slice(pixels, tilesW, tilesH) {
    const tileList = [];
    const grid = [];
    for (let ty = 0; ty < tilesH; ty++) {
      grid[ty] = [];
      for (let tx = 0; tx < tilesW; tx++) {
        const tile = [];
        for (let r = 0; r < 8; r++) {
          const row = [];
          for (let c = 0; c < 8; c++) row.push(pixels[ty * 8 + r][tx * 8 + c] & 15);
          tile.push(row);
        }
        grid[ty][tx] = tileList.length;
        tileList.push(tile);
      }
    }
    return { tileList, grid };
  }

  // For a full-screen cell (r,c), which source-grid cell + fold flips feed it?
  // variant 0: H-mirror + V-mirror (4-way kaleidoscope)
  // variant 1: H-mirror only (quarter repeats vertically)
  // variant 2: V-mirror only (quarter repeats horizontally)
  // variant 3: no fold (quarter tiled 2x2)
  // Full mode ignores variants beyond identity (returns the cell as drawn).
  function source(r, c, variant, mode) {
    if (mode !== "quarter") return { sr: r, sc: c, fh: 0, fv: 0 };
    const qW = 16, qH = 12;
    const hMirror = variant === 0 || variant === 1;
    const vMirror = variant === 0 || variant === 2;
    let sc, fh, sr, fv;
    if (hMirror && c >= qW) { sc = (COLS - 1) - c; fh = 1; } else { sc = c % qW; fh = 0; }
    if (vMirror && r >= qH) { sr = (ROWS - 1) - r; fv = 1; } else { sr = r % qH; fv = 0; }
    return { sr, sc, fh, fv };
  }

  // Build one 32x24 name table (Uint16Array, row-major, 768 words).
  // refsGrid[ty][tx] = {index, h, v} from the deduped source grid.
  function buildLayout(refsGrid, variant, mode, opts) {
    const bank = opts && opts.bank ? 1 : 0;
    const prio = opts && opts.priority ? 1 : 0;
    const out = new Uint16Array(COLS * ROWS);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const { sr, sc, fh, fv } = source(r, c, variant, mode);
        const ref = refsGrid[sr][sc];
        const h = ref.h ^ fh;
        const v = ref.v ^ fv;
        const word = (ref.index & 0x1ff) | (h << 9) | (v << 10) | (bank << 11) | (prio << 12);
        out[r * COLS + c] = word;
      }
    }
    return out;
  }

  // Full bake for a scene: dedupe tiles, produce the deduped source grid, and build
  // the requested layout variants. Returns { tiles (unique 8x8 list), layouts (array
  // of Uint16Array), refsGrid }.
  function bake(pixels, mode, variants, opts) {
    const g = geometry(mode);
    const { tileList, grid } = slice(pixels, g.tilesW, g.tilesH);
    let { unique, refs } = T.dedupe(tileList);
    // Optional tile budget: merge rare tiles so scene swaps stay small/fast.
    const budget = opts && opts.tileBudget;
    if (budget && unique.length > budget) {
      ({ unique, refs } = T.reduceToBudget(unique, refs, budget));
    }
    // Map row-major refs back onto the source grid.
    const refsGrid = grid.map((row) => row.map((i) => refs[i]));
    const layouts = variants.map((v) => buildLayout(refsGrid, v, mode, opts));
    return { tiles: unique, layouts, refsGrid };
  }

  return { COLS, ROWS, geometry, slice, source, buildLayout, bake };
})();
