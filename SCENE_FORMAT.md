# SMSVJ Scene Bank Format — `.svjb`

**Draft v0.1.** The contract between the browser **look-patcher** (emitter) and the
SMSVJ **ROM runtime** (consumer). The ROM is deliberately dumb: it consumes finished
bytes and switches between them. All authoring intelligence — the kaleidoscope fold,
tile de-duplication, dithering, colour quantisation — lives in the tool and is baked
out before it ever reaches the console.

Sibling to SMSGGDJ's `.smdj`; shares its clock vocabulary (row = 1/16 = **tick**).

---

## 1. Principles the format encodes

- **The fold is a tool concern, not a runtime concern.** You author a quarter
  (16×12 tiles); the tool bakes the mirrored whole into finished name tables. The ROM
  never computes symmetry — it writes name tables and flips VDP register 2.
- **Cheap axes are live, the expensive axis is the scene.** Palette (one CRAM DMA) and
  effect (a register write or a small CRAM op) switch in real time and latch to the
  beat. Tileset (~KBs of pattern data) is bound to the scene and latches to the bar.
- **Minimal unique tiles.** De-dupe *including flipped copies* — a tile and its H/V/HV
  flips are one pattern. This is what keeps pattern writes small enough to stay
  single-frame and sync-tight.
- **Four of everything.** Every axis offers exactly 4 options, so the runtime indexes
  with a 2-bit value and cross-scene persistence is trivial (index 2 stays index 2).

---

## 2. Container overview

```
.svjb  =  BANK HEADER
          SCENE[0]
          SCENE[1]
          SCENE[2]
          SCENE[3]

SCENE  =  SCENE HEADER
          TILES      (patterns)
          LAYOUTS    (name tables — 1..4 mirror variants)
          PALETTES   (4 × full CRAM)
          EFFECTS    (4 × effect record)
          MOVEMENTS  (4 × movement record)
```

Everything is little-endian. Offsets in a header are **relative to the start of the
structure that owns them** (bank offsets from bank start; scene section offsets from
that scene's start), so a scene is position-independent and the tool can lay them out
in any order.

---

## 3. Bank header (20 bytes)

| off | size | field | notes |
|----|----|----|----|
| 0  | 4 | `magic` | ASCII `"SVJB"` |
| 4  | 1 | `version` | format version = `0x01` |
| 5  | 1 | `region` | bit0: 0 = 60 Hz target, 1 = 50 Hz. bit1: allow runtime region auto-detect |
| 6  | 1 | `scene_count` | = 4 (reserved for future banks; runtime assumes 4) |
| 7  | 1 | `default_bpm` | INT clock tempo, 20–240. ROM derives frames/beat per region |
| 8  | 1 | `boot_scene` | 0–3 |
| 9  | 1 | `boot_palette` | 0–3 |
| 10 | 1 | `boot_effect` | 0–3 |
| 11 | 1 | `boot_movement` | 0–3 |
| 12 | 8 | `scene_ptr[4]` | array of four `u16`, each a bank-relative offset to a SCENE HEADER |

Total = 20 bytes (12 fixed fields + the four 2-byte scene pointers). Little-endian
throughout.

---

## 4. Scene header (16 bytes + `primary[4]` = 20 bytes)

| off | size | field | notes |
|----|----|----|----|
| 0  | 1 | `tile_count` | number of 8×8 patterns, 1–255 |
| 1  | 1 | `layout_count` | number of name-table variants, 1–4 |
| 2  | 1 | `flags` | bit0: tiles RLE-packed. bit1: layouts RLE-packed |
| 3  | 1 | `reserved` | 0 |
| 4  | 2 | `off_tiles` | scene-relative |
| 6  | 2 | `off_layouts` | scene-relative |
| 8  | 2 | `off_palettes` | scene-relative |
| 10 | 2 | `off_effects` | scene-relative |
| 12 | 2 | `off_movements` | scene-relative |
| 14 | 2 | `reserved` | 0 |
| 16 | 4 | `primary[4]` | one primary CRAM index per palette (for freeze); see §7 |

The 16-byte header is immediately followed by the 4-byte `primary[4]` array, so the
fixed prefix of every scene is 20 bytes; the five `off_*` fields are scene-relative
offsets to the sections, which the tool may lay out in any order after this prefix.

---

## 5. TILES section

`tile_count` patterns, each **32 bytes**, SMS Mode 4 native 4bpp *planar* order:

- A tile is 8 rows. Each row is 4 bytes = 4 bitplanes (plane0, plane1, plane2, plane3),
  MSB = leftmost pixel. Pixel colour = the 4 plane bits assembled → index 0–15 into the
  tile's selected CRAM bank.
- Tile 0 by convention is the "backdrop" tile (often flat colour 0); the tool should
  reserve it so BLANK/BORDER behave predictably.

The runtime writes this block straight to the VRAM pattern generator on scene load
(the one heavy op, bar-quantised, covered by a transition).

**De-dup contract:** the tool guarantees no two stored patterns are H/V/HV flips of each
other; the name tables reference the survivor with the appropriate flip bits.

---

## 6. LAYOUTS section

`layout_count` name tables, each **1536 bytes** = 32 cols × 24 rows × 2 bytes.
(Only the 24 visible rows are stored; the loader drops each into a 2 KB-aligned VRAM
slot so it's selectable via VDP register 2, leaving rows 24–27 unused.)

Each entry is a Mode 4 name-table word (`u16`, little-endian):

| bits | meaning |
|----|----|
| 0–8 | pattern index (0–511) |
| 9 | horizontal flip |
| 10 | vertical flip |
| 11 | palette-bank select (0 = entries 0–15, 1 = entries 16–31) |
| 12 | priority (BG in front of sprites) |
| 13–15 | 0 |

**Layout index 0 is the scene's base look.** Additional layouts are the mirror-mode
variants an effect of type `LAYOUT` selects (e.g. 0 = full 4-way kaleidoscope, 1 =
H-mirror only, 2 = V-mirror only, 3 = no fold). Because they share the same tiles, a
mirror-mode change is a single register-2 write — no VRAM traffic.

> **VRAM budget note.** VRAM is 16 KB. Each resident layout eats a 2 KB slot, so 4
> layouts = 8 KB, leaving 8 KB (256 patterns) for tiles + the sprite attribute table.
> Scenes that don't need mirror-switching should ship `layout_count = 1` and spend the
> space on tiles.

### Authoring modes (per-scene, first-class)

The fold is optional and chosen **per scene** in the tool — a single bank can mix
kaleidoscope and full-frame scenes freely, because the ROM can't tell them apart (it
only ever sees finished name tables). The format needs no flag for this; the mode is a
tool-side authoring choice that determines how the layouts are baked.

- **Quarter mode** — author 16×12; the tool bakes the 4-way fold into layout 0 and may
  emit H-only / V-only / no-fold as extra layouts for mirror-mode effects. The path for
  generative / geometric mandala work.
- **Full mode** — author or import the whole 32×24; the tool dedupes-with-flips but lays
  tiles out as drawn, imposing no symmetry. This is where **bitmap/image import** lives
  (a photo dithered across 256×192 is a full-frame scene). Mirror-mode effects are still
  available if the tool bakes alternate layouts, but symmetry is not forced.

De-dup-including-flips runs in **both** modes (it's free and shrinks every scene); only
the fold differs.

---

## 7. PALETTES section

4 palettes, each **32 bytes** = the full CRAM (2 banks of 16). One colour per byte,
6-bit SMS colour `0b00BBGGRR` (each channel 0–3; 64 possible colours).

The per-palette **primary index** (from `primary[4]` in the scene header) points at the
CRAM entry FREEZE flattens every active colour to. Flat freeze = write that one colour
value into all live entries; release restores the palette.

Palette switching (the B1+←/→ axis) rewrites all 32 entries on the latching beat.
Movements and palette-invert/rotate effects operate on the *live* CRAM on top of
whichever palette is current, so they compose.

---

## 8. EFFECTS section

4 records, **4 bytes** each: `type, p0, p1, p2`.

| type | name | p0 | p1 | p2 |
|----|----|----|----|----|
| 0x00 | NONE | — | — | — |
| 0x01 | LAYOUT | layout index (0–3) | — | — |
| 0x02 | INVERT | 0 = 6-bit complement | range start (CRAM 0–31) | range len |
| 0x03 | ROTATE | signed shift (−15..15) | range start | range len |
| 0x04 | FREEZE_LATCH | primary override, `0xFF` = palette's primary | — | — |
| 0x05 | WOBBLE | amplitude (px) | frequency | — |
| 0x06 | BLANK | backdrop colour index (0–31) | — | — |

Effects are **latched to the beat** and are sticky (they persist until you cycle to a
different effect). INVERT and ROTATE apply once on latch to the live CRAM range;
LAYOUT and WOBBLE and BLANK are states held while selected. FREEZE_LATCH is the sticky
form of the momentary freeze gesture — same operation, different trigger.

WOBBLE is only meaningful on non-mirrored layouts (per-line hscroll breaks kaleidoscope
symmetry); the tool should grey it out for folded layouts.

---

## 9. MOVEMENTS section

4 records, **4 bytes** each: `type, division, range_start, range_len`.

| type | name |
|----|----|
| 0x00 | STATIC (no motion) |
| 0x01 | CYCLE_FWD |
| 0x02 | CYCLE_BACK |
| 0x03 | PINGPONG |

- `division` — motion step interval in **ticks** (1 = every 1/16, 4 = every beat, 8 =
  every half, …). Tempo-relative, so motion stays locked whether the clock is INT, IN,
  or IN24.
- `range_start`, `range_len` — the CRAM sub-range that cycles. Movement rotates that
  ring of live colours; the mirror keeps it pixel-perfect because no name-table or
  pattern data is touched — only CRAM.

Movement is the symmetry-safe "flow" of the design. Latches to the beat like the other
live axes (the *selection* latches; the motion itself then runs at `division`).

---

## 10. Clock & quantisation (shared with the runtime)

Reusing SMSGGDJ's vocabulary so the two projects speak the same timing:

- **tick** = 1/16 note = one tracker row
- **beat** = 4 ticks
- **bar** = 16 ticks

| axis | latch boundary |
|----|----|
| palette / effect / movement selection | beat |
| scene / tileset | bar |
| freeze gesture, tempo nudge | instant (never quantised) |

Clock sources feed one internal tick:
- **INT** — frames/beat from `default_bpm` and region; tick = fpb/4 frames, fractional
  remainder accumulated so it stays phase-true to the display.
- **IN** — 2-bit counter, another SMS pushing OUT; 1 edge per row = 1 tick.
- **IN24** — 24 PPQN Link/bridge; ÷6 → tick, ÷24 → beat.

Auto-fallback to INT when an external source goes quiet.

**Capture-instant / apply-on-division:** the pad is read every frame and each axis's
*pending* index accumulates immediately (two presses = two steps; opposite press
cancels). On the axis's latch boundary, if pending ≠ current, it applies and clears.

---

## 11. Worked size example

A modest scene: 128 tiles, 2 layouts (kaleidoscope + no-fold), 4 palettes.

```
scene header + primary[4]      20 B
tiles      128 × 32          4096 B
layouts      2 × 1536        3072 B
palettes     4 × 32           128 B
effects      4 × 4             16 B
movements    4 × 4             16 B
                            ─────────
per scene                  ~7348 B
bank (4 scenes) + header    ~29.4 KB
```

Comfortably inside a small ROM; the browser tool decides ROM size (32/64/128 KB) the
same way SMSGGDJ's savetool assembles cart images.

---

## 12. Open decisions (flagged for next pass)

1. **RLE for layouts.** Name tables of a folded, minimal-tile scene are highly
   repetitive — RLE would cut the 1536 B/layout substantially. `flags` bit already
   reserves it; need to pick the packer (the tracker's SMDJ4 RLE is a candidate to
   share).
2. **Priority/backdrop tile convention.** Whether tile 0 is a hard reserved backdrop or
   just a tool default.
3. **Palette-bank usage.** Whether scenes routinely use both CRAM banks (32 colours on
   screen via bit 11) or stick to one (simpler cycling). Format already carries 32; the
   question is a tool authoring default.
4. **Per-axis latch override.** Whether to expose finer latch (1/8, 1/16) per effect in
   the tool, or keep the hardwired beat/bar rule.

---

## 13. Handoff notes (for the Claude Code instance)

Cold-start context the agent won't otherwise have:

- **Runtime is dumb; tool is smart.** Fold, tile de-dup (incl. flips), dithering, and
  colour quantisation are all baked in the browser look-patcher. The ROM consumes
  finished name tables and switches VDP register 2. Don't drift toward on-console
  symmetry computation.
- **Clock is shared with SMSGGDJ** (row = 1/16 = tick, beat = 4, bar = 16). The
  arm/latch input core is SMSGGDJ's LIVE-mode launch-quantize logic with palettes where
  clips were — lift it, don't rewrite.
- **VRAM (16 KB) is the ceiling, not ROM.** Each mirror-layout = a 2 KB slot.
- **Two build targets eventually** (`.sms` + `.gg`), like the tracker — structure for it
  even if v1 is SMS-only.
- **Deferred for v1:** SRAM save, ALS import, layout RLE (share SMDJ4's packer).
- **Build order:** look-patcher emitter first (generate a real `.svjb`, preview the
  folded/full result against a fake clock), then the runtime clock + arm/latch core
  reading that file. Format-first means both sides build against this fixed contract.

---

*MIT, © 2026 Sebastian Tomczak (little-scale). Sibling to SMSGGDJ / genmddj.*
