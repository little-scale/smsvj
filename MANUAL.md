# SMSVJ Manual

A companion **VJ visual tool** for the Sega Master System (sibling to the
[SMSGGDJ](https://github.com/little-scale/smsggdj) tracker). The SMS *is* the visual:
minimal custom tiles rendered as a kaleidoscope (or full frame), with live
palette / effect / movement / tileset ridden from **controller 1** and latched to a
musical clock. This manual covers the two browser tools and the ROM build.

- **Look-patcher** (`tool/index.html`) — design scenes and bake the `.svjb` bank.
- **Tile studio** (`tool/studio.html`) — compose scenes by hand and rip graphics from ROMs/images.

Both run entirely in the browser (no build step, no server needed). Open the file
directly, or serve the folder:

```
cd tool && python3 -m http.server 8000   # → http://localhost:8000
```

> **Design rule:** the *tool is smart, the runtime is dumb*. The fold, tile de-dup
> (including H/V/HV flips), colour quantisation and every effect are computed in the
> browser and baked to finished name tables. The ROM only writes bytes and flips VDP
> register 2. Nothing symmetrical is computed on-console.

---

## 1. The look-patcher

Three columns: **Generator** (author a tileset) · **Preview** (play it against a fake
clock) · **Palettes & axes**.

### Generator (left)
Every pattern is a **distance field** banded by the palette — pick a *style* and dial it.

- **Tileset** — which of the 16 tilesets you're editing. **Mode** — *Quarter* (16×12
  source folded into a 4-way kaleidoscope) or *Full* (32×24 direct frame).
- **Style / Metric** — the geometry: `metric` (euclidean rings / taxicab diamonds /
  chebyshev squares / angular spokes), `weave`, `truchet`, `chevron`, `wave` (moiré),
  `grid`, `plaid`, `stripe`, `brick`, `star` (flower/petal mandala).
- **Period / Thick / Rotate / Spin / Cell** — the dials. *Rotate* works on every style;
  *Thick* sets band width everywhere; *Spin* twists (spiral / phase / petals / shear);
  *Period* and *Cell* set the tiling scale.
- **🎲 Randomize** — jump to a random geometry. The **tile count / budget** readout
  shows how many unique tiles the current design bakes to (cap is 48 per tileset).
- **Import tiles from a ROM** — see [§3](#3-ripping-graphics-from-roms).
- You can still **paint** on the canvas with the swatch row below it.

### Preview (middle)
Renders the baked tileset against a fake clock. The four **axes** — Palette, Effect,
Movement, Tileset — mirror the controller-1 grammar; click a value to arm it (it latches
on the next boundary while playing, or applies instantly when stopped).

- **▶ Play / ⏸** and **BPM / Region** (header) drive the clock.
- **Colour freeze** — hold the current colours (a preview aid; on the console the Pause
  button now cycles the sync source instead).
- **Speed −/+** — corruption ticks/step (1·2·4·8·16); each effect runs a 64-step cycle then resets.
- **auto palette / effect / movement** — advance that axis every beat (for hands-off preview).

### Palettes & axes (right)
- **Edit palette (0–15)** — the 16 global palettes, paired 1:1 with the 16 tilesets.
- **CRAM grid** — 32 entries (2 banks of 16). Click to select, then click the **gamut**
  (64 SMS colours) to set it. Double-click an entry to mark it the **primary** (freeze target).
- **Palette generator** — pick up to **3 seed colours**, then build the palette three ways:
  **Interpolate** (blend across seeds), **Harmonise** (cohesive analogous gradient), or
  **Oppose** (alternate each seed with its complement). Applied to all tilesets (global).
- **Effects (9-way dial)** and **Movements (7)** — per-tileset config (type + params).

### Header actions
- **⬇ Export .svjb** — the ROM-ready, page-aligned 64 KB scene bank. Drop it into
  `rom/assets/look.svjb` and build (see [§5](#5-building-the-rom)).
- **⬇ Source** — export the current tileset as a `.svjt` (mode + palette + pixels) for
  round-tripping into the studio.
- **⬆ Import source** — load a `.svjt` into the current tileset (**or drag one onto the
  button**). The tileset lands in slot *N* and its palette in palette slot *N* (paired).
- **▸ tile studio** — open the studio.

---

## 2. The tile studio

Compose a scene by hand: pick 8×8 tiles from a **ROM** or an **image**, place them on a
quarter/full frame, transform, and export a `.svjt` the look-patcher imports.

### Source (left) — two tabs
**ROM tab** — drop a `.sms` / `.gg` (or any binary):
- **Offset** — coarse navigation (steps by a tile in raw mode). **Phase (0–255)** — fine
  byte nudge to align tiles: ±1 fixes the plane/colour scramble, ±4 fixes row tearing.
- **Decode** — the compression format (see [§3](#3-ripping-graphics-from-roms)).
- **Find ▸** — jump to the next block of the selected format (RNC / PS RLE / Sonic 1).
- **Cols / Rows** — reflow the tile sheet to the game's native image width so scenes line up.
- **palette at offset** — a live 32-colour preview; **Grab palette ▸** takes it (honours
  Phase). **12-bit (GG)** decodes Game Gear palettes.

**Image tab** — drop a PNG/JPG: set **Tiles wide** and **Colours**, and it auto-quantises
to ≤16 SMS colours and slices into tiles.

**Brush** — click a tile, or **drag a rectangle** to grab a group. **flip H / V** flips the
brush before stamping.

### Compose (middle)
The target frame (quarter 16×12 or full 32×24). Click/drag to **stamp**.

- **select** — marquee a block as the brush. **move** — marquee then drag a block to a new
  spot (cut &amp; drop). **eraser** — stamp blanks. **bucket** — flood-fill a matching region.
- **Fill all** — tessellate the brush across the whole frame (both axes). **Clear** — wipe.
- **Tile ops** (on the selection, or whole frame): **Rotate ⟳** (90° CW), **Mirror H / V**,
  **Invert** (index → 15−index), and **colour replace** (swap one index for another).
- **pixel edit** — click a cell to load it into the zoomed 8×8 editor (left column) and
  paint individual pixels (colour comes from the solid strip).
- **↶ ↷ / ⌘Z / ⇧⌘Z** — 40-step undo/redo.

**Solid brush** — 16 swatches; click one for a flat-colour 8×8 tile (also sets the pencil
colour). **Brush slots** — click empty to save the current brush, filled to recall,
shift-click to clear.

### Preview & palette (right)
Live **folded** preview of the composed frame, plus the editable palette (click a slot,
click a gamut swatch). Grab a palette from a ROM (Source tab) or an image auto-fills it.

### Header
- **⬇ Export .svjt** — the composed scene source.
- **⬆ Load .svjt** — reopen a source to keep editing.
- **▸ look-patcher** — back to the look-patcher (import the `.svjt` there).

**Typical loop:** rip/quantise tiles → stamp → select → rotate/mirror → Fill all →
Export .svjt → drag onto the look-patcher's Import source → bake.

---

## 3. Ripping graphics from ROMs

Most SMS games store graphics **compressed**. The **Decode** dropdown (both tools) picks
how to read the bytes at the current offset:

| Format | How to find it | Games |
|---|---|---|
| **Raw (uncompressed)** | scrub Offset + Phase | fonts, HUDs, some backgrounds |
| **Phantasy Star RLE** | **Find ▸** (structural) | most Sega first-party: Alex Kidd, Fantasy Zone, Space Harrier, Out Run, Golden Axe, Zillion, Castle/Land of Illusion, Shinobi, Spy vs Spy, Cyber Shinobi… |
| **Sonic 1 SMS** | **Find ▸** (`48 59` header) | Sonic the Hedgehog (8-bit) |
| **Sonic 2 / Aspect** | scrub Offset (no signature) | Sonic Chaos/Blast/Drift, Sonic 2, Mickey "Legend of Illusion", Batman Returns, Moonwalker… |
| **RNC ProPack (1/2)** | **Find ▸** (magic + CRC) | Lion King, Mortal Kombat 1/2, Astérix, RoboCop 3, Incredible Hulk, Spider-Man, Krusty's Fun House… |

**Using Find ▸:** set **Decode** to the format you expect, then click **Find ▸**. It jumps
to the next block of *that* format; click again to step through them. RNC shows
**"✓ CRC ok"** when it lands on a real block (RNC carries a checksum). Raw and Sonic 2 have
no searchable signature — scrub the Offset (and Phase) by hand for those.

> If **Find ▸** comes back empty for a format, the cart almost certainly uses a different
> one — switch the Decode dropdown and try again. A handful of games use game-specific LZ
> (Sylvan Tale, Berlin Wall, GG Aleste) that aren't supported yet.

Once tiles are legible, drag-select them and (studio) build your scene, or (look-patcher)
**Fill source** to tile the selection across the whole tileset.

---

## 4. File formats

- **`.svjt`** — a single scene *source*: `{ svjt:1, mode, palette[32], pixels[][] }`. JSON.
  Passed between the studio and the look-patcher.
- **`.svjb`** — the ROM scene *bank*: a header (magic, region, BPM, boot fields, scene
  pointers) followed by 16 scenes, each with a 32-byte prefix, `primary[16]`, tiles,
  layouts, **16 palettes**, 9 effects, 7 movements. Page-aligned to four 16 KB banks
  (64 KB). See [`SCENE_FORMAT.md`](SCENE_FORMAT.md) for the byte layout.

---

## 5. Building the ROM

Requires **WLA-DX** (`wla-z80` + `wlalink`) and Python 3 / Node.

```
cd rom
make bank && make          # → rom/smsvj.sms (96 KB, standard Sega mapper)
```

- `make bank` re-exports `assets/look.svjb` from the look-patcher's **built-in** scenes.
- To build from a bank **you authored in the browser** (its ⬇ Export .svjb):

```
cd rom
make import FILE=~/Downloads/look.svjb   # page-aligns it into assets/
make
```

`make import` runs `tool/repage.js`, which aligns each scene to a 16 KB page and pads to
four banks. (Current browser exports are already page-aligned; import also rescues older
compact ones.) Use `make import`, **not** `make bank`, when you want your own bank —
`make bank` overwrites it with the built-in scenes.

---

## 6. Controller 1 (on hardware)

Each face button owns a theme — **B1 = effect, B2 = look, B1+B2 = source** — and the
D-pad picks the value. Changes latch on the next musical boundary.

| Input | Action | Latch |
|---|---|---|
| **B1 + ↑ / ↓** | Effect dial — 9 steps: `NONE` centre, 4 glitch up, 4 down | tick |
| **B1 + ← / →** | Effect speed — ticks/step 1·2·4·8·16 (right = 1 tick) | instant |
| **B2 + ↑ / ↓** | Movement — 7 options | tick |
| **B1+B2 + ← / →** | Tileset — of 16; palette stays | beat |
| **B1+B2 + ↑ / ↓** | Palette — of 16; tileset stays | tick |
| **B2 tap** (alone) | Toggle the on-beat border flash (any clock source; off by default) | on release |
| **Pause** (console button) | Cycle sync source: OFF → IN → IN24 (shows the mode ~2 s) | instant |

Palette and tileset are **independent** — the B1+B2 combo mixes them. **Movement of 7:**
slow up / slow down / fast up / fast down / wobble A / wobble B / none. **Effect dial** is
all corruption: down = SMEAR-D / STAMP / XOR / MORPH, centre = NONE, up = SCRAMBLE /
SMEAR-H / SMEAR-V / CHURN.

**Clock:** row = 1/16 = **tick**, **beat** = 4 ticks, **bar** = 16 ticks. Tempo comes
from the internal clock or an external sync source (SMSGGDJ / Ableton Link via the ESP32
bridge) on controller port 2. **Sync is hardware-confirmed** on both paths: **IN** (÷1)
synced to a hardware SMSGGDJ, and **IN24** (÷6) off a USB-MIDI clock through the ESP32-S3.
Movement and effects are tempo-locked, so the whole visual follows the master's clock.

---

*MIT © 2026 Sebastian Tomczak (little-scale).*
