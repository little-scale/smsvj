#!/usr/bin/env node
// Re-page a browser-exported .svjb (compact, scenes packed back-to-back) into the
// ROM's page-aligned layout: every scene placed wholly inside one 16 KB page, the
// whole image padded to N pages. Scene bodies are relocatable (their internal
// offsets are relative), so we only move scenes and rewrite the scene_ptr table —
// authored content is preserved byte-for-byte.
//
//   node repage.js <in.svjb> <out.svjb> [pageSize=16384] [pages=4]
"use strict";
const fs = require("fs");

const [, , inPath, outPath, psArg, pagesArg] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: node repage.js <in.svjb> <out.svjb> [pageSize=16384] [pages=4]");
  process.exit(1);
}
const pageSize = parseInt(psArg || "16384", 10);
const pages = parseInt(pagesArg || "4", 10);

const src = fs.readFileSync(inPath);
if (src.slice(0, 4).toString("latin1") !== "SVJB") throw new Error("not a .svjb (bad magic)");
const sceneCount = src[6];
const HDR = 12 + sceneCount * 2;

// Scene layout constants (SCENE_FORMAT.md / svjb.js). A scene's exact size comes from
// its own header (tile_count/layout_count), so this is robust whether the input is a
// compact export or an already-paged one with trailing padding, and it's idempotent.
const PREFIX = 24, LAYOUT_BYTES = 1536, PALETTES = 8, EFFECTS = 9, MOVEMENTS = 7;
const FIXED = PREFIX + PALETTES * 32 + EFFECTS * 4 + MOVEMENTS * 4;

const ptr = [];
for (let i = 0; i < sceneCount; i++) ptr.push(src.readUInt16LE(12 + i * 2));
const size = ptr.map((base) => FIXED + src[base] * 32 + src[base + 1] * LAYOUT_BYTES);

// Rebuild: header first (kept), then each scene bumped to a page boundary if it would
// straddle one, then the pointer table rewritten to the new offsets.
const out = Buffer.alloc(pageSize * pages, 0);
src.copy(out, 0, 0, HDR);
let cursor = HDR;
const newPtr = new Array(sceneCount);
for (let i = 0; i < sceneCount; i++) {
  const sz = size[i];
  if (sz > pageSize) throw new Error(`scene ${i} is ${sz} B, larger than one ${pageSize} B page`);
  if (((cursor / pageSize) | 0) !== (((cursor + sz - 1) / pageSize) | 0)) {
    cursor = (((cursor / pageSize) | 0) + 1) * pageSize; // bump to next page
  }
  if (cursor + sz > out.length) throw new Error(`content exceeds ${pages} pages (${out.length} B)`);
  src.copy(out, cursor, ptr[i], ptr[i] + sz);
  newPtr[i] = cursor;
  cursor += sz;
}
for (let i = 0; i < sceneCount; i++) out.writeUInt16LE(newPtr[i], 12 + i * 2);

fs.writeFileSync(outPath, out);
console.log(`repaged ${inPath} -> ${outPath}: ${sceneCount} scenes, ${out.length} B / ${pages} pages`);
