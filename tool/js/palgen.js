// Palette generator: take a few seed colours and build a full 16-entry CRAM ramp.
//   interpolate - blend across the seeds (seed0 -> seed1 -> seed2 -> ...).
//   harmonize   - a cohesive gradient that "goes with" the seeds (analogous drift).
//   opposition  - alternate each seed with its hue complement (high contrast).
// Everything is quantised to the 64-colour SMS gamut at the end (2 bits/channel),
// which is coarse, so subtle hue moves may collapse — interpolate reads the cleanest.
window.SVJ = window.SVJ || {};
SVJ.palgen = (function () {
  const C = () => SVJ.color;

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6; if (h < 0) h += 1;
    }
    const l = (mx + mn) / 2;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    const seg = Math.floor(h * 6) % 6;
    if (seg === 0) [r, g, b] = [c, x, 0];
    else if (seg === 1) [r, g, b] = [x, c, 0];
    else if (seg === 2) [r, g, b] = [0, c, x];
    else if (seg === 3) [r, g, b] = [0, x, c];
    else if (seg === 4) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }

  // Piecewise-linear blend through the seeds. t in 0..1.
  function interp(seeds, t) {
    if (seeds.length === 1) return seeds[0];
    const seg = t * (seeds.length - 1);
    const i = Math.min(seeds.length - 2, Math.floor(seg));
    const f = seg - i, a = seeds[i], b = seeds[i + 1];
    return { r: a.r + (b.r - a.r) * f, g: a.g + (b.g - a.g) * f, b: a.b + (b.b - a.b) * f };
  }
  // Cohesive gradient: cycle the seeds, drift hue gently, ramp lightness dark->light.
  function harmonize(hsls, i) {
    const [h, s] = hsls[i % hsls.length];
    const hue = (h + (i / 16 - 0.5) * 0.12 + 1) % 1;
    return hslToRgb(hue, Math.max(0.45, s), 0.2 + 0.62 * (i / 15));
  }
  // Alternate a seed with its complement; ramp lightness for depth.
  function opposition(hsls, i) {
    const [h, s] = hsls[Math.floor(i / 2) % hsls.length];
    const hue = (h + ((i & 1) ? 0.5 : 0) + 1) % 1;
    return hslToRgb(hue, Math.max(0.5, s), 0.24 + 0.56 * (i / 15));
  }

  // seeds: array of 1..3 CRAM bytes. Returns a full 32-byte palette (bank0 + mirror).
  function build(mode, seeds, backdrop = 0) {
    const rgb = seeds.map((c) => C().toRGB(c));
    const hsls = rgb.map((c) => rgbToHsl(c.r, c.g, c.b));
    const out = new Uint8Array(32);
    for (let i = 0; i < 16; i++) {
      let col;
      if (mode === "interpolate") col = interp(rgb, i / 15);
      else if (mode === "opposition") col = opposition(hsls, i);
      else col = harmonize(hsls, i);
      out[i] = C().fromRGB(col.r, col.g, col.b);
      out[16 + i] = out[i];
    }
    out[0] = backdrop & 0x3f;   // keep the backdrop (entry 0 / SMS border)
    out[16] = backdrop & 0x3f;
    return out;
  }

  return { build, rgbToHsl, hslToRgb };
})();
