// Tile operations: flips, Mode 4 planar encode, and de-dup INCLUDING H/V/HV flips.
// A "tile" here is an 8x8 array-of-arrays of CRAM indices (0..15), tile[row][col].
window.SVJ = window.SVJ || {};
SVJ.tiles = (function () {
  const SIZE = 8;

  function hflip(t) {
    return t.map((row) => row.slice().reverse());
  }
  function vflip(t) {
    return t.slice().reverse().map((row) => row.slice());
  }
  function hvflip(t) {
    return vflip(hflip(t));
  }
  // Apply flip by 2-bit code: bit0 = H, bit1 = V.
  function applyFlip(t, code) {
    let r = t;
    if (code & 1) r = hflip(r);
    if (code & 2) r = vflip(r);
    return r;
  }

  function key(t) {
    let s = "";
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) s += t[r][c].toString(16);
    return s;
  }
  function equal(a, b) {
    return key(a) === key(b);
  }

  // SMS Mode 4 native: 32 bytes, 8 rows x 4 bitplanes. MSB = leftmost pixel.
  function encode(t) {
    const out = new Uint8Array(32);
    for (let r = 0; r < SIZE; r++) {
      let p0 = 0, p1 = 0, p2 = 0, p3 = 0;
      for (let c = 0; c < SIZE; c++) {
        const bit = 7 - c; // MSB leftmost
        const px = t[r][c] & 15;
        p0 |= ((px >> 0) & 1) << bit;
        p1 |= ((px >> 1) & 1) << bit;
        p2 |= ((px >> 2) & 1) << bit;
        p3 |= ((px >> 3) & 1) << bit;
      }
      out[r * 4 + 0] = p0;
      out[r * 4 + 1] = p1;
      out[r * 4 + 2] = p2;
      out[r * 4 + 3] = p3;
    }
    return out;
  }

  // De-dup a list of tiles including flips.
  // Returns { unique: [tile...], refs: [{index, h, v}...] } (refs parallel to input).
  // The stored representative is the FIRST-seen tile of each flip-equivalence class;
  // later members are referenced via the flip code that maps representative -> member.
  function dedupe(tileList) {
    const unique = [];
    const canonToIndex = new Map(); // canonical key -> representative index
    const refs = [];
    for (const t of tileList) {
      const orients = [key(t), key(hflip(t)), key(vflip(t)), key(hvflip(t))];
      const canon = orients.slice().sort()[0];
      if (!canonToIndex.has(canon)) {
        const idx = unique.length;
        unique.push(t);
        canonToIndex.set(canon, idx);
        refs.push({ index: idx, h: 0, v: 0 });
      } else {
        const idx = canonToIndex.get(canon);
        const rep = unique[idx];
        // Find flip code such that applyFlip(rep, code) === t.
        let code = 0;
        for (let f = 0; f < 4; f++) {
          if (equal(applyFlip(rep, f), t)) { code = f; break; }
        }
        refs.push({ index: idx, h: code & 1, v: (code >> 1) & 1 });
      }
    }
    return { unique, refs };
  }

  // Sum of absolute per-pixel index differences between applyFlip(tile,f) and target.
  function sadFlip(tile, f, target) {
    const t = applyFlip(tile, f);
    let s = 0;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) s += Math.abs(t[r][c] - target[r][c]);
    return s;
  }

  // Reduce a deduped tile set to at most `budget` tiles by repeatedly merging the
  // least-used tile into its nearest surviving neighbour (in any flip). Refs are
  // rewritten in place: the merged tile's references are retargeted with the flip
  // that best matches, composed (XOR) with each ref's own flip. Lossy but keeps the
  // common tiles intact, so scene/tile uploads stay small for fast live swaps.
  function reduceToBudget(unique, refs, budget) {
    unique = unique.slice();
    while (unique.length > budget) {
      // usage count per surviving tile
      const count = new Array(unique.length).fill(0);
      for (const r of refs) count[r.index]++;
      let victim = 0;
      for (let i = 1; i < unique.length; i++) if (count[i] < count[victim]) victim = i;
      // nearest surviving tile (over all four flips)
      let best = -1, bestSad = Infinity, bestFlip = 0;
      for (let j = 0; j < unique.length; j++) {
        if (j === victim) continue;
        for (let f = 0; f < 4; f++) {
          const sad = sadFlip(unique[j], f, unique[victim]);
          if (sad < bestSad) { bestSad = sad; best = j; bestFlip = f; }
        }
      }
      // retarget victim's refs to best, composing the merge flip with each ref's flip
      for (const r of refs) {
        if (r.index === victim) {
          r.index = best;
          r.h ^= bestFlip & 1;
          r.v ^= (bestFlip >> 1) & 1;
        }
      }
      unique.splice(victim, 1);
      for (const r of refs) if (r.index > victim) r.index--; // reindex after removal
    }
    return { unique, refs };
  }

  return { SIZE, hflip, vflip, hvflip, applyFlip, key, equal, encode, dedupe, reduceToBudget };
})();
