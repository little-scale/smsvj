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
    { key: "rnc", label: "RNC ProPack (1/2)" },
  ];
  const S2_MAX_TILES = 4096;                            // guard against garbage offsets
  const RNC_MAX_OUT = 512 * 1024;                       // cap decompressed size (garbage offsets)

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

  // ---- RNC ProPack (Rob Northen Compression), methods 1 & 2 --------------------
  // Reimplemented from the documented algorithm. 18-byte header: "RNC" + method,
  // then big-endian unpacked/packed lengths, CRCs, leeway, block count. Method 1 is
  // Huffman-coded LZ; method 2 is a bit-stream LZ. The header's unpacked CRC lets us
  // verify a decode ({ ok } in the result).
  const RNC_CRC = (function () {
    const t = new Uint16Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let b = 0; b < 8; b++) c = (c & 1) ? (c >>> 1) ^ 0xa001 : c >>> 1; t[i] = c; }
    return t;
  })();
  function rncCrc(buf, start, len) {
    let crc = 0;
    for (let i = 0; i < len; i++) { crc ^= buf[start + i]; const hi = (crc >>> 8) & 0xff; crc = RNC_CRC[crc & 0xff] ^ hi; }
    return crc & 0xffff;
  }

  function rncUnpack(buf, base) {
    if (!(buf[base] === 0x52 && buf[base + 1] === 0x4e && buf[base + 2] === 0x43)) return { bytes: new Uint8Array(0), ok: false };
    const method = buf[base + 3];
    const be32 = (o) => ((buf[base + o] << 24) | (buf[base + o + 1] << 16) | (buf[base + o + 2] << 8) | buf[base + o + 3]) >>> 0;
    const be16 = (o) => (buf[base + o] << 8) | buf[base + o + 1];
    let unpackLen = be32(4), packLen = be32(8);
    const crcUnpacked = be16(12), blocks = buf[base + 17];
    if (unpackLen > RNC_MAX_OUT || unpackLen === 0) return { bytes: new Uint8Array(0), ok: false };
    const out = new Uint8Array(unpackLen);

    // bit-reader state (method 1: 32-bit LSB-first; method 2: 8-bit MSB-first)
    let src = base + 18, bbl = 0, bbh = 0, bc = 0, left = packLen, dst = 0;

    function inputBits(amount) {
      let nH = bbh, nL = bbl, nC = bc, rem;
      const ret = ((1 << amount) - 1) & nL;
      nC -= amount;
      if (nC < 0) {
        nC += amount;
        rem = (nH << (16 - nC)) & 0xffff;
        nH >>>= nC; nL >>>= nC; nL |= rem;
        src += 2; left -= 2;
        if (left <= 0) nH = 0; else if (left === 1) nH = buf[src] || 0; else nH = (buf[src] || 0) | ((buf[src + 1] || 0) << 8);
        amount -= nC; nC = 16 - amount;
      }
      rem = (nH << (16 - amount)) & 0xffff;
      bbh = (nH >>> amount) & 0xffff; bbl = ((nL >>> amount) | rem) & 0xffff; bc = nC & 0xff;
      return ret & 0xffff;
    }
    function makeHuff() {
      const tbl = new Int32Array(256);
      const numCodes = inputBits(5);
      if (!numCodes) return tbl;
      const hl = [];
      for (let i = 0; i < numCodes; i++) hl[i] = inputBits(4) & 0xff;
      let code = 0, w = 0;
      for (let bl = 1; bl < 17; bl++) for (let i = 0; i < numCodes; i++) if (hl[i] === bl) {
        tbl[w] = (1 << bl) - 1;
        const b = (code >>> (16 - bl)) & 0xffff; let a = 0;
        for (let j = 0; j < bl; j++) a |= ((b >>> j) & 1) << (bl - j - 1);
        tbl[w + 1] = a;
        tbl[w + 2 + 0x1e] = (hl[i] << 8) | (i & 0xff);
        code = (code + (1 << (16 - bl))) >>> 0; w += 2;
      }
      return tbl;
    }
    function inputValue(tbl) {
      let p = 0, val = bbl, v1, v2;
      do { v2 = tbl[p++] & val; v1 = tbl[p++]; } while (v1 !== v2);
      let value = tbl[p + 0x1e];
      inputBits((value >> 8) & 0xff);
      value &= 0xff;
      if (value >= 2) { value--; let e = inputBits(value & 0xff); e |= (1 << value); value = e; }
      return value;
    }
    function getbit() { if (bc === 0) { bbl = buf[src++] || 0; bc = 8; } const t = (bbl & 0x80) >>> 7; bbl = (bbl << 1) & 0xff; bc--; return t; }

    if (method === 1) {
      bbl = (buf[src] || 0) | ((buf[src + 1] || 0) << 8); bbh = 0; bc = 0;
      inputBits(2);
      let blk = blocks;
      do {
        const rawT = makeHuff(), posT = makeHuff(), lenT = makeHuff();
        let counts = inputBits(16);
        do {
          let len = inputValue(rawT);
          if (len) {
            for (let i = 0; i < len && dst < unpackLen; i++) out[dst++] = buf[src + i] || 0;
            src += len; left -= len;
            const a = left <= 0 ? 0 : left === 1 ? (buf[src] || 0) : (buf[src] || 0) | ((buf[src + 1] || 0) << 8);
            const b = left <= 2 ? 0 : left === 3 ? (buf[src + 2] || 0) : (buf[src + 2] || 0) | ((buf[src + 3] || 0) << 8);
            bbl = ((bbl & ((1 << bc) - 1)) | (a << bc)) & 0xffff;
            bbh = ((a >>> (16 - bc)) | (b << bc)) & 0xffff;
          }
          if (counts > 1) {
            const off = inputValue(posT) + 1;
            let mlen = inputValue(lenT) + 2;
            let s = dst - off;
            while (mlen-- && dst < unpackLen) out[dst++] = out[s++];
          }
          if (dst >= unpackLen) break;
        } while (--counts);
      } while (--blk && dst < unpackLen);
    } else if (method === 2) {
      bbl = 0; bc = 0;
      getbit(); getbit();
      for (let guard = 0; dst < unpackLen && guard < unpackLen * 4 + 64; guard++) {
        let len = 2, ofsHi = 0, loadVal = false;
        while (getbit() === 0) { if (dst >= unpackLen) break; out[dst++] = buf[src++] || 0; }
        if (getbit() === 0) {
          len = (len << 1) | getbit();
          if (getbit() === 1) {
            len = ((len - 1) << 1) | getbit();
            if (len === 9) {
              len = 0; for (let i = 0; i < 4; i++) ofsHi = (ofsHi << 1) | getbit();
              let n = (ofsHi + 3) * 4;
              while (n-- && dst < unpackLen) out[dst++] = buf[src++] || 0;
              continue;
            }
          }
          loadVal = true;
        } else if (getbit() === 1) {
          len++;
          if (getbit() === 1) {
            len = buf[src++] || 0;
            if (len === 0) { if (getbit() === 1) continue; else break; }
            len += 8;
          }
          loadVal = true;
        }
        if (loadVal && getbit() === 1) {
          ofsHi = (ofsHi << 1) | getbit();
          if (getbit() === 1) { ofsHi = ((ofsHi << 1) | getbit()) | 4; if (getbit() === 0) ofsHi = (ofsHi << 1) | getbit(); }
          else if (ofsHi === 0) ofsHi = 2 | getbit();
        }
        const ofs = ((ofsHi << 8) | (buf[src++] || 0)) + 1;
        let s = dst - ofs;
        while (len-- && dst < unpackLen) out[dst++] = out[s++];
      }
    } else return { bytes: new Uint8Array(0), ok: false };

    const ok = dst === unpackLen && rncCrc(out, 0, unpackLen) === crcUnpacked;
    return { bytes: out, ok };
  }

  // Scan forward for the next CRC-valid RNC block (magic "RNC" + method 1/2, then
  // full decode + CRC check to reject false ASCII hits). Returns offset or -1.
  function findRnc(buf, from) {
    for (let o = Math.max(0, from); o + 18 < buf.length; o++) {
      if (buf[o] === 0x52 && buf[o + 1] === 0x4e && buf[o + 2] === 0x43 && (buf[o + 3] === 1 || buf[o + 3] === 2)) {
        if (rncUnpack(buf, o).ok) return o;
      }
    }
    return -1;
  }

  // Phantasy Star RLE has no header, so detect it structurally: 4 consecutive bitplanes
  // that each RLE-decode to the SAME length (multiple of 8, >= 16 tiles) and actually
  // compress. Strong signature, very low false-positive rate. Returns offset or -1.
  function psPlaneLen(buf, off) {              // {outLen, off} past the 00 terminator, or null
    let out = 0;
    for (;;) {
      if (off >= buf.length) return null;
      const c = buf[off++];
      if (c === 0) return { outLen: out, off };
      const n = c & 0x7f;
      if (c & 0x80) { off += n; out += n; } else { off += 1; out += n; }
      if (off > buf.length) return null;
    }
  }
  function findPS(buf, from) {
    for (let o = Math.max(0, from); o < buf.length - 8; o++) {
      let off = o, len0 = -1, ok = true;
      for (let p = 0; p < 4; p++) {
        const r = psPlaneLen(buf, off); if (!r) { ok = false; break; }
        if (p === 0) len0 = r.outLen; else if (r.outLen !== len0) { ok = false; break; }
        off = r.off;
      }
      if (!ok || len0 < 128 || len0 % 8 !== 0) continue;   // >= 16 tiles, whole tiles
      if (off - o < (len0 / 8) * 32) return o;              // actually compressed
    }
    return -1;
  }

  function decode(buf, off, format) {
    if (format === "ps") return psDecode(buf, off);
    if (format === "s2") return s2Decode(buf, off);
    if (format === "rnc") return rncUnpack(buf, off).bytes;
    return buf.subarray ? buf.subarray(off) : buf.slice(off); // raw view from offset
  }

  return { FORMATS, decode, psDecode, s2Decode, rncUnpack, findRnc, findPS };
})();
