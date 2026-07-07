// Emit the default demo bank to a .svjb file (reuses the browser emitter under a
// fake `window`). Usage: node tool/export-bank.js [outfile] [maxScenes]
// maxScenes caps the embedded scene count (the 32 KB ROM holds ~2 banks until
// ROM paging lands; the browser always uses the full 16).
const fs = require("fs");
const path = require("path");
const shared = {};
global.window = { SVJ: shared };
global.SVJ = shared;

const base = path.join(__dirname, "js");
for (const f of ["color.js", "tiles.js", "fold.js", "generators.js", "svjb.js", "scene.js", "render.js", "clock.js"]) {
  eval(fs.readFileSync(path.join(base, f), "utf8"));
}

const out = process.argv[2] || path.join(__dirname, "..", "rom", "assets", "look.svjb");
const maxScenes = parseInt(process.argv[3], 10) || 16;
const PAGE = 0x4000, PAGES = 4;    // ROM pages the runtime pages through slot 2
const bank = SVJ.scene.makeBank();
bank.scenes = bank.scenes.slice(0, maxScenes);
if (bank.boot.scene >= bank.scenes.length) bank.boot.scene = 0;
const { bytes } = SVJ.svjb.serialize(bank, { pageSize: PAGE });
SVJ.svjb.decode(bytes); // validate before writing
if (bytes.length > PAGE * PAGES) throw new Error(`aligned bank ${bytes.length} B exceeds ${PAGE * PAGES} B (${PAGES} pages)`);
// Pad to a whole number of 16 KB pages so the ROM's per-bank .INCBIN slices line up.
const padded = new Uint8Array(PAGE * PAGES);
padded.set(bytes);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(padded));
console.log(`wrote ${out} (${bytes.length} B in ${padded.length} B / ${PAGES} pages)`);
