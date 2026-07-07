// Canvas renderer + live CRAM transforms (movement / effect) applied on top of the
// current palette, exactly as the ROM would do to live CRAM. Symmetry is already baked
// into the name table, so these colour ops stay pixel-perfect under the mirror.
window.SVJ = window.SVJ || {};
SVJ.render = (function () {
  const T = SVJ.tiles, F = SVJ.fold;
  const W = 256, H = 192;

  // --- live CRAM ops (return a fresh 32-entry Uint8Array) ---
  function rotateRange(pal, start, len, amount) {
    const out = Uint8Array.from(pal);
    if (len <= 1) return out;
    for (let i = 0; i < len; i++) {
      const src = start + (((i - amount) % len) + len) % len;
      out[start + i] = pal[src];
    }
    return out;
  }
  function invertRange(pal, start, len) {
    const out = Uint8Array.from(pal);
    for (let i = 0; i < len; i++) out[start + i] = (~pal[start + i]) & 0x3f;
    return out;
  }
  function freezeAll(pal, primaryVal) {
    const out = Uint8Array.from(pal);
    for (let i = 0; i < 32; i++) out[i] = primaryVal & 0x3f;
    return out;
  }

  // Phase (in division-steps) -> rotation amount for a movement type.
  function movementAmount(type, phase) {
    switch (type) {
      case 0x01: return phase;          // CYCLE_FWD
      case 0x02: return -phase;         // CYCLE_BACK
      case 0x03: {                      // PINGPONG (triangle wave)
        const period = 2 * 15;
        const p = ((phase % period) + period) % period;
        return p < 15 ? p : period - p;
      }
      default: return 0;                // STATIC
    }
  }

  // Compose base palette -> effective palette given movement phase + active effect.
  // Returns { pal, blank } where blank (if set) is a backdrop CRAM index to flood-fill.
  function effectivePalette(base, opts) {
    let pal = Uint8Array.from(base);
    let blank = null;
    const mv = opts.movement;
    if (mv && mv.type !== 0 && mv.range_len > 1) {
      pal = rotateRange(pal, mv.range_start, mv.range_len, movementAmount(mv.type, opts.movePhase));
    }
    const fx = opts.effect;
    if (fx) {
      switch (fx.type) {
        case 0x02: pal = invertRange(pal, fx.p1, fx.p2); break;      // INVERT
        case 0x03: pal = rotateRange(pal, fx.p1, fx.p2, fx.p0 | 0); break; // ROTATE
        case 0x06: blank = fx.p0 & 31; break;                        // BLANK
        // 0x01 LAYOUT handled by caller (layout selection); 0x05 WOBBLE = geometry.
      }
    }
    if (opts.freeze) pal = freezeAll(pal, base[opts.primary] || 0);
    return { pal, blank };
  }

  // Draw a 32x24 name table into a 256x192 ImageData.
  function renderLayout(img, layout, tiles, pal, blank) {
    const data = img.data;
    if (blank != null) {
      const c = SVJ.color.toRGB(pal[blank] || 0);
      for (let i = 0; i < W * H; i++) {
        data[i * 4] = c.r; data[i * 4 + 1] = c.g; data[i * 4 + 2] = c.b; data[i * 4 + 3] = 255;
      }
      return;
    }
    for (let r = 0; r < F.ROWS; r++) {
      for (let c = 0; c < F.COLS; c++) {
        const word = layout[r * F.COLS + c];
        const tile = T.applyFlip(tiles[word & 0x1ff], ((word >> 9) & 1) | (((word >> 10) & 1) << 1));
        const bank = (word >> 11) & 1;
        for (let ty = 0; ty < 8; ty++) {
          for (let tx = 0; tx < 8; tx++) {
            const cram = (tile[ty][tx] & 15) + bank * 16;
            const col = SVJ.color.toRGB(pal[cram] || 0);
            const px = ((r * 8 + ty) * W + (c * 8 + tx)) * 4;
            data[px] = col.r; data[px + 1] = col.g; data[px + 2] = col.b; data[px + 3] = 255;
          }
        }
      }
    }
  }

  return { W, H, rotateRange, invertRange, freezeAll, movementAmount, effectivePalette, renderLayout };
})();
