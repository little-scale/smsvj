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
    { key: "s2", label: "Sonic 2 / Aspect" },
  ];
  const S2_MAX_TILES = 4096;                            // guard against garbage offsets

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

  // "Sonic 2" / Aspect codec (smspower). Header: $01 $00, tile_count(LE), bitstream
  // offset(LE); then a raw-byte block and a 2-bits-per-tile descriptor bitstream at
  // dataStart+offset. Descriptor: 00=32 zeros, 01=32 raw bytes, 10=compressed,
  // 11=compressed then un-XOR. Compressed = 4 flag bytes (32 bits, LSB-first) select
  // each tile byte as 0 or the next raw byte.
  function s2Decode(buf, base) {
    let dp = base + 6;                                 // raw data pointer
    const nTiles = Math.min(((buf[base + 2] || 0) | ((buf[base + 3] || 0) << 8)), S2_MAX_TILES);
    let bs = dp + ((buf[base + 4] || 0) | ((buf[base + 5] || 0) << 8)); // bitstream pointer
    let bsN = 0;                                       // tiles consumed from current bitstream byte
    const out = new Uint8Array(nTiles * 32);
    for (let ti = 0; ti < nTiles; ti++) {
      if (bsN === 4) { bs++; bsN = 0; }
      const desc = ((buf[bs] || 0) >> (2 * bsN)) & 3;
      bsN++;
      const t = ti * 32;
      if (desc === 1) { for (let k = 0; k < 32; k++) out[t + k] = buf[dp++] || 0; }
      else if (desc >= 2) {
        const f = [buf[dp] || 0, buf[dp + 1] || 0, buf[dp + 2] || 0, buf[dp + 3] || 0]; dp += 4;
        for (let k = 0; k < 32; k++) out[t + k] = ((f[k >> 3] >> (k & 7)) & 1) ? (buf[dp++] || 0) : 0;
        if (desc === 3) {                              // un-XOR (increasing order; see smspower asm)
          for (let i = 0; i <= 13; i++) out[t + i + 2] ^= out[t + i];
          for (let i = 16; i <= 29; i++) out[t + i + 2] ^= out[t + i];
        }
      } // desc 0 = already-zero tile
    }
    return out;
  }

  function decode(buf, off, format) {
    if (format === "ps") return psDecode(buf, off);
    if (format === "s2") return s2Decode(buf, off);
    return buf.subarray ? buf.subarray(off) : buf.slice(off); // raw view from offset
  }

  return { FORMATS, decode, psDecode, s2Decode };
})();
