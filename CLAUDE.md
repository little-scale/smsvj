# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## SMSVJ

A companion **VJ tool** for the Sega Master System / Game Gear, sibling to
**[SMSGGDJ](https://github.com/little-scale/smsggdj)** (the tracker) and **genmddj**.
It runs on a second SMS, projects its video out as the visuals, and syncs to/from
SMSGGDJ (or Ableton Link via the ESP32 bridge). Controlled entirely from controller 1.

**Read [`SCENE_FORMAT.md`](SCENE_FORMAT.md) first — it is the contract** between the
browser look-patcher (emitter) and the ROM runtime (consumer). Everything builds
against that fixed format.

---

## What this is

The SMS *is* the visual. There is no on-screen editor — just a hideable one-row
sprite overlay at the bottom. Visuals are built from a minimal set of custom tiles,
rendered as a kaleidoscope (or full-frame), with custom palettes, effects, and
movement. The performer rides palette / effect / movement / scene live from the pad,
latched to a musical clock.

## Hard invariants (do not drift from these)

1. **Runtime is dumb; tool is smart.** The fold, tile de-dup (including H/V/HV flips),
   dithering, and colour quantisation all happen in the browser **look-patcher** and are
   baked out before reaching the console. The ROM consumes finished name tables and
   switches **VDP register 2** to change mirror mode. Never compute symmetry on-console.
2. **VRAM (16 KB) is the ceiling, not ROM.** Each resident mirror-layout occupies a 2 KB
   VRAM slot (register-2-selectable). 4 layouts = 8 KB, leaving 8 KB for patterns + SAT.
   Scene authoring is constrained by this, not by ROM size.
3. **Clock vocabulary is shared with SMSGGDJ**: row = 1/16 = **tick**, **beat** = 4
   ticks, **bar** = 16 ticks. Palette/effect/movement latch to the beat; scene to the
   bar; freeze and tempo-nudge are instant.
4. **The input core is SMSGGDJ's LIVE-mode launch-quantize logic**, with palettes/effects
   where clips were. Lift it, don't rewrite. Capture-instant / apply-on-division:
   read the pad every frame, accumulate each axis's pending index (two presses = two
   steps; opposite press cancels), apply on the axis's latch boundary.
5. **Everything is four.** Each live axis offers exactly 4 options → 2-bit index →
   cross-scene persistence by index is free.

## Controller 1 grammar

Each button owns a theme — B1 = effect, B2 = look, B1+B2 = source:

| input | action | latch |
|---|---|---|
| B1 + ↑/↓ | **effect dial** (of 9: NONE centre, 4 glitch up, 4 glitch down) | tick |
| B1 + ←/→ | **effect speed** — ticks/step 1·2·4·8·16 (right = 1 tick, fastest) | instant |
| B2 + ↑/↓ | movement (of 7) | tick |
| B1+B2 + ←/→ | **tileset** (of 16) — palette stays | beat |
| B1+B2 + ↑/↓ | **palette** (of 16) — tileset stays | tick |
| B2 tap (alone) | toggle on-beat border flash (any clock source; off by default) | instant (on release) |
| **Pause button** (NMI) | cycle sync source: OFF → IN → IN24 (shows the mode ~2 s) | instant |

**Palette and tileset are independent** (no "bank"): the B1+B2 combo mixes them — ←/→
swaps the tileset keeping the palette, ↑/↓ swaps the palette keeping the tileset. There
are **16 tilesets and 16 (global) palettes**, paired 1:1 (importing a `.svjt` into
tileset N drops its palette into palette slot N). Latches: palette/effect/movement on the
**tick**, tileset on the **beat**. The **effect dial** is all corruption: down = SMEAR-D
/ STAMP / XOR / MORPH, centre = NONE, up = SCRAMBLE / SMEAR-H / SMEAR-V / CHURN.
**Movement of 7**: slow/fast × up/down, two anti-phase wobbles, and none. **Speed** picks the
corruption's **ticks/step** from `1·2·4·8·16` (B1+→ = 1 tick). Each effect runs a **64-step
cycle** then the resettable ones reload clean — so a full loop is `64 × step` ticks = 4, 8,
16, 32, or 64 bars, always bar-aligned and tempo-locked.
Tempo-nudge dropped (tempo comes from Link/sync).

**Sync source is explicit** (not auto): the **Pause button cycles OFF → IN → IN24**, shown
briefly on-screen. Boot shows the version then the git build id (~2 s each). Colour freeze
was dropped to free the Pause button.

Edge-detect the D-pad (release before it steps again). B2 disambiguates tap-vs-hold on
release: if any D-pad/B1 happened during the hold it was a modifier and the tap is
swallowed; otherwise it toggles the overlay.

## Clock sources

One internal tick, source selected explicitly by the **Pause button** (OFF → IN → IN24):

- **OFF (INT)** — frames/beat from the bank's `default_bpm` + region; fractional remainder
  accumulated to stay phase-true to the display.
- **IN** — 2-bit counter, another SMS (SMSGGDJ / genmddj) pushing SYNC OUT; 1 clock/row = 1
  tick (÷1). Border flashes on the beat while slaved.
- **IN24** — 24 PPQN Link/bridge (ESP32); ÷6 → tick, ÷24 → beat.

Sync lives on **controller port 2** (`$DD`: TR bit3, TL bit2, TH bit7; counter bit0 =
TR AND TL so straight and crossed cables both work). The SMSGGDJ SYNC IN reader is reused
verbatim; see SMSGGDJ's `HARDWARE.md` for the electrical contract — it's identical.

## Build targets

Eventually two ROMs from one source tree, like the tracker: **`smsvj.sms`** (Master
System, full screen) and **`smsvj.gg`** (Game Gear, handheld screen + real stereo is
N/A here but the smaller framebuffer matters). v1 may be SMS-only; structure for both.

Toolchain mirrors SMSGGDJ: **WLA-DX** (`wla-z80` + `wlalink`) + Python 3 for build
tools, browser apps for the user-facing tooling. Match the sibling repo's `make`
targets and layout where sensible.

## Current repo state

Built out, past Build order steps 1–3. What exists:

- **`tool/`** — the two browser apps and the emitter core. `index.html` (look-patcher) +
  `studio.html` (tile studio), with modules in `tool/js/` (`generators`, `scene`, `svjb`,
  `fold`, `tiles`, `render`, `clock`, `palgen`, `romdecode`, `app`, `studio`). Node harness
  at `tool/test/roundtrip.js`; `export-bank.js` and `repage.js` feed the ROM build.
- **`rom/`** — the WLA-DX runtime (`src/*.asm` + `sms.inc`), `Makefile`, and the paged
  96 KB build. `make bank && make`, or `make import FILE=…` for a browser-authored bank.
- **`romdecode.js`** — ROM graphics decompressors (Raw, Phantasy Star RLE, Sonic 1, Sonic 2/
  Aspect, RNC ProPack 1/2) with per-format `Find` scanners.
- Docs: `MANUAL.md` (user guide), `README.md`, `SCENE_FORMAT.md`, `EMULATION.md`, and a
  root `index.html` launcher (opened locally — the tools are not hosted).

**16 tilesets and 16 palettes**, paired 1:1 (a `.svjt` imported into tileset N drops its
palette in palette slot N). Remaining: **sync input** (reuse SMSGGDJ's SYNC IN reader) and
the **MIDI/Link** paths (Build order step 4); the pad grammar is assemble-verified only —
confirm on hardware. Verify render/boot on emulator per `EMULATION.md`.

## Build order

1. **Look-patcher emitter** — generate a real `.svjb`, preview the folded/full result
   against a fake clock, cycling palettes/effects/movements. Get the format producing
   real bytes before any assembly exists.
2. **Runtime clock + arm/latch core** — read a `.svjb`, implement the tick/quantise
   state machine and the pad grammar above.
3. Rendering: tile/name-table upload, register-2 mirror switching, CRAM palette/movement.
4. Sync input (reuse SMSGGDJ's SYNC IN reader), then MIDI/Link paths.

Format-first ordering means both sides build against the fixed `SCENE_FORMAT.md`
contract from day one.

## Deferred for v1

SRAM save, ALS import, layout RLE (share SMDJ4's packer when adding it).

## Related repos

- `smsggdj` — the tracker; shared clock, sync, PSG layer, and the LIVE-mode input core.
- `smsggdj-link-esp32` — ESP32 Ableton Link → DE-9 sync bridge (drives the same 2-bit
  counter; should fan out to multiple consoles in parallel — verify).
- `ares-link-sync` — ares fork that follows Link in-emulator, for hardware-free testing.
- `genmd-imgrom` — the bitmap → Mega Drive image-ROM converter; its dithering retargets
  to Mode 4 for the look-patcher's full-frame image import.

---

*MIT, © 2026 Sebastian Tomczak (little-scale).*
