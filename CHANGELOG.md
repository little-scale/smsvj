# Changelog

All notable changes to SMSVJ. Versions mirror the sibling
[SMSGGDJ](https://github.com/little-scale/smsggdj) `v0.YY` scheme.

## v0.11 — 2026-07-08

Tempo-locked visuals and hardware-confirmed sync.

- **Sync — hardware-confirmed.** The Pause button cycles the clock source **OFF → IN →
  IN24** (replacing colour freeze). **IN** (÷1) follows an SMSGGDJ/genmddj SYNC OUT —
  tested synced to a **hardware SMSGGDJ**. **IN24** (÷6) follows a 24-PPQN sender — tested
  off a **USB-MIDI clock through the ESP32-S3 bridge**. Reuses SMSGGDJ's exact port-2
  counter reader (straight and crossed cables both work). A **B2 tap** toggles an on-beat
  border flash (off by default, any clock source).
- **Tempo-locked effects.** Corruption fires on ticks instead of per frame: speed = **1 / 2
  / 4 / 8 / 16 ticks per step** (B1+→ = 1 tick), and each effect runs a **64-step cycle**
  then resets (MELT/CHURN/XOR/STAMP reload tiles; SCRAMBLE/SMEAR/MORPH reload the layout),
  so a full loop is **4–64 bars**, always bar-aligned.
- **Bar-aligned movement.** Colour cycles rotate 16 CRAM entries, so a full loop is exactly
  16 ticks (a bar) for fast movements or 16 beats for slow ones.
- **On-screen text.** Added the SMSGGDJ 8×8 font and a sprite text overlay: the **version**
  then the **git build id** at boot (~2 s each), and the **sync mode** whenever it changes.
  Build id (`make vrom` for a hash-stamped copy) matches smsggdj.
- **16 palettes** paired 1:1 with the 16 tilesets (a `.svjt` import lands its palette in the
  matching slot). ROM graphics ripping gained **Sonic 1 SMS** and a unified **Find ▸**
  scanner; the studio gained move, tile ops, pixel pencil, brush slots, and ROM/image tile
  import.

## v0.1 — 2026-07-08

First release: the two browser tools and a working Master System visual runtime,
built format-first against [`SCENE_FORMAT.md`](SCENE_FORMAT.md).

### Look-patcher (`tool/index.html`)
- Geometry engine — 12 styles (metric rings/diamonds/squares/spokes, weave, truchet,
  chevron, wave/moiré, grid, plaid, stripe, brick, star/flower) with universal
  Rotate/Thick/Spin/Period/Cell dials and 🎲 randomize.
- 16 tilesets and **16 global palettes, paired 1:1** with the tilesets.
- Palette generator — build a palette from up to 3 seed colours (interpolate /
  harmonise / oppose).
- 9-way effect dial, 7 movements; live preview against a fake clock with the
  controller-1 axes, speed, and colour freeze.
- Import a ROM's tiles/palettes; import a `.svjt` (or drag it onto the button);
  export the ROM-ready page-aligned `.svjb` bank, and export the current tileset as `.svjt`.

### Tile studio (`tool/studio.html`)
- Compose scenes by hand from ROM tiles or a quantised image.
- Brush (single/group) with H/V flips, solid brush, and 8 brush slots.
- Compose tools: stamp, select, move (cut & drop), eraser, bucket flood-fill,
  Fill-all tessellate, rotate / mirror / invert / colour-replace, per-pixel pencil,
  Cols/Rows reflow, and 40-step undo/redo.
- Folded kaleidoscope preview; palette grab/preview; `.svjt` export and round-trip load.

### ROM graphics ripping
- Decompressors: **Raw**, **Phantasy Star RLE**, **Sonic 1 SMS**, **Sonic 2 / Aspect**,
  and **RNC ProPack 1/2** (RNC verified byte-exact against the reference compressor).
- One **Find ▸** scanner per format, plus Offset + Phase (0–255) byte alignment and
  a palette finder.

### ROM runtime (`rom/`)
- WLA-DX Z80 build, paged 96 KB. Clock/tick/latch core, tile & name-table upload,
  register-2 mirror switching, 16 CRAM palettes + movement, and the full corruption
  suite (SMEAR / STAMP / XOR / MORPH / SCRAMBLE / CHURN). Boots and renders on emulator.
- `make bank && make`, or `make import FILE=…` to build from a browser-authored bank.

### Docs
- [`MANUAL.md`](MANUAL.md) user guide, refreshed README/CLAUDE, and a GitHub Pages
  landing page.

### Not yet
- Sync input (SMSGGDJ SYNC IN reader) and the MIDI/Link paths.
- The controller-1 grammar is assemble-verified only — needs hardware confirmation.
