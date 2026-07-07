// Headless harness: load the browser modules under a fake `window` and exercise the
// format-critical path (tile encode, dedupe-with-flips, fold, serialize, decode).
// Run: node tool/test/roundtrip.js
const fs = require("fs");
const path = require("path");
// In the browser `window.SVJ` is also a bare global; mirror that here.
const shared = {};
global.window = { SVJ: shared };
global.SVJ = shared;

const base = path.join(__dirname, "..", "js");
for (const f of ["color.js", "tiles.js", "fold.js", "svjb.js", "scene.js", "render.js", "clock.js"]) {
  eval(fs.readFileSync(path.join(base, f), "utf8"));
}
// `SVJ` here resolves to the global populated by the modules above (no local decl,
// which would shadow it in a TDZ).
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

// 1. tile encode: a tile with left column = index 1, rest 0.
const t = Array.from({ length: 8 }, () => Array.from({ length: 8 }, (_, c) => (c === 0 ? 1 : 0)));
const enc = SVJ.tiles.encode(t);
// plane0 of each row should have MSB set (leftmost pixel), planes1-3 zero.
ok(enc[0] === 0x80 && enc[1] === 0 && enc[2] === 0 && enc[3] === 0, "tile encode: left pixel -> plane0 MSB (0x80)");

// 2. dedupe collapses an h-flip pair to one unique tile with h flag.
const a = Array.from({ length: 8 }, () => Array.from({ length: 8 }, (_, c) => (c < 4 ? 2 : 0)));
const aH = SVJ.tiles.hflip(a);
const d = SVJ.tiles.dedupe([a, aH]);
ok(d.unique.length === 1, "dedupe: h-flip pair -> 1 unique tile");
ok(d.refs[1].h === 1 && d.refs[1].v === 0, "dedupe: second tile referenced with h-flip");

// 3. fold variant 0 corners: top-left no flip, top-right H, bottom-left V, bottom-right HV.
const c0 = SVJ.fold.source(0, 0, 0, "quarter");
const cTR = SVJ.fold.source(0, 31, 0, "quarter");
const cBL = SVJ.fold.source(23, 0, 0, "quarter");
const cBR = SVJ.fold.source(23, 31, 0, "quarter");
ok(c0.sr === 0 && c0.sc === 0 && c0.fh === 0 && c0.fv === 0, "fold: top-left = source (0,0) no flip");
ok(cTR.sc === 0 && cTR.fh === 1 && cTR.fv === 0, "fold: top-right mirrors to src col 0 with H flip");
ok(cBL.sr === 0 && cBL.fv === 1 && cBL.fh === 0, "fold: bottom-left mirrors to src row 0 with V flip");
ok(cBR.fh === 1 && cBR.fv === 1, "fold: bottom-right = HV flip");

// 4. serialize the default bank, then decode (round-trip self-consistency).
const bank = SVJ.scene.makeBank();
const { bytes } = SVJ.svjb.serialize(bank);
ok(bytes[0] === 0x53 && bytes[1] === 0x56 && bytes[2] === 0x4a && bytes[3] === 0x42, "serialize: magic 'SVJB'");
ok(bytes[4] === 1, "serialize: version 1");
ok(bytes[6] === 4, "serialize: scene_count 4");
const info = SVJ.svjb.decode(bytes);
ok(info.scenes.length === 4, "decode: 4 scenes, all offsets self-consistent");
console.log("  bank size:", bytes.length, "bytes; tiles per scene:", info.scenes.map((s) => s.tile_count).join(", "));

// 5. layout word bit-packing: a folded top-right cell should carry the H flip bit (9).
const b0 = SVJ.svjb.bakeScene(bank.scenes[0]);
const word = b0.layouts[0][0 * 32 + 31]; // row 0, col 31 = top-right
ok(((word >> 9) & 1) === 1, "layout word: top-right cell has H-flip bit set");

// 6. Per-scene budget: <=255 unique tiles AND tiles+layouts fit in 16 KB VRAM
//    (each layout = a 2 KB slot; leave headroom for the SAT).
info.scenes.forEach((s, i) => {
  const vram = s.tile_count * 32 + s.layout_count * 2048;
  ok(s.tile_count <= 255 && vram <= 16384,
    `scene ${i}: ${s.tile_count} tiles, ${s.layout_count} layout(s), ${vram} B VRAM <= 16384`);
});

// 7. WOBBLE: per-line hscroll shifts a row's pixels and wraps.
{
  const W = SVJ.render.W, H = SVJ.render.H;
  const img = { data: new Uint8ClampedArray(W * H * 4) };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img.data[(y * W + x) * 4] = x & 255;
  // phase = PI/2 -> shift at row 0 = amp*sin(PI/2) = amp.
  SVJ.render.applyWobble(img, 10, 1, Math.PI / 2);
  const redAt = (x) => img.data[(0 * W + x) * 4];
  ok(redAt(20) === (20 - 10), "wobble: row 0 shifted right by amp (10)");
  ok(redAt(5) === (((5 - 10) % 256) + 256) % 256, "wobble: shift wraps at row edge");
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
