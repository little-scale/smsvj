// SMS Mode 4 colour: 6-bit CRAM value, 0b00BBGGRR (each channel 0..3).
// 64 possible colours. Channel 0..3 maps to 8-bit 0/85/170/255.
window.SVJ = window.SVJ || {};
SVJ.color = (function () {
  const LEVELS = [0, 85, 170, 255];

  // 6-bit CRAM byte -> {r,g,b} in 0..255
  function toRGB(cram) {
    const r = LEVELS[cram & 3];
    const g = LEVELS[(cram >> 2) & 3];
    const b = LEVELS[(cram >> 4) & 3];
    return { r, g, b };
  }

  // 8-bit r,g,b -> nearest 6-bit CRAM byte
  function fromRGB(r, g, b) {
    const q = (v) => Math.min(3, Math.round(v / 85));
    return (q(b) << 4) | (q(g) << 2) | q(r);
  }

  function toHex(cram) {
    const { r, g, b } = toRGB(cram);
    const h = (v) => v.toString(16).padStart(2, "0");
    return "#" + h(r) + h(g) + h(b);
  }

  // "#rrggbb" -> 6-bit CRAM byte (quantised)
  function fromHex(hex) {
    const n = parseInt(hex.slice(1), 16);
    return fromRGB((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }

  return { toRGB, fromRGB, toHex, fromHex, LEVELS };
})();
