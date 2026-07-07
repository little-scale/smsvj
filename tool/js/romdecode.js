// Decompressors for tile data ripped from SMS/GG ROMs. Most SMS schemes are
// game-specific and offset-only (no magic), so the user picks a format + start offset.
// We ship the highest-coverage one: "Phantasy Star" RLE (smspower.org/Development/
// Compression), reused across a large Sega first-party library.
//
// decode(buf, off, format) -> Uint8Array of interleaved Mode 4 tile bytes starting at
// tile 0 (tile k = bytes[k*32 ..]). "raw" returns a view from the offset.
window.SVJ = window.SVJ || {};
SVJ.romdecode = (function () {
  const FORMATS = [
    { key: "raw", label: "Raw (uncompressed)" },
    { key: "ps", label: "Phantasy Star RLE" },
  ];

  // One deinterleaved bitplane: 0nnnnnnn dd = run of n identical; 1nnnnnnn <n bytes> =
  // literal run; 00 = end of bitplane. Returns {bytes, off} (off past the terminator).
  function psPlane(buf, off) {
    const out = [];
    for (;;) {
      const count = buf[off++];
      if (count === undefined || count === 0) break;   // end of bitplane (or EOF)
      const n = count & 0x7f;
      if (count & 0x80) { for (let i = 0; i < n; i++) out.push(buf[off++] || 0); }   // literal
      else { const v = buf[off++] || 0; for (let i = 0; i < n; i++) out.push(v); }   // run
    }
    return { bytes: out, off };
  }
  // Four planes, then interleave to native tile bytes: out[i*4+p] = plane[p][i].
  function psDecode(buf, off) {
    const planes = [];
    for (let p = 0; p < 4; p++) { const r = psPlane(buf, off); planes.push(r.bytes); off = r.off; }
    const nRows = Math.min(planes[0].length, planes[1].length, planes[2].length, planes[3].length);
    const out = new Uint8Array(nRows * 4);               // one byte per (tile-row, plane)
    for (let i = 0; i < nRows; i++) for (let p = 0; p < 4; p++) out[i * 4 + p] = planes[p][i] || 0;
    return out;
  }

  function decode(buf, off, format) {
    if (format === "ps") return psDecode(buf, off);
    return buf.subarray ? buf.subarray(off) : buf.slice(off); // raw view from offset
  }

  return { FORMATS, decode, psDecode };
})();
