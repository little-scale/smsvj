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

| input | action | latch |
|---|---|---|
| B1 + ←/→ | palette (of 4) | tick |
| B1 + ↑/↓ | effect (of 4) | tick |
| B2 + ←/→ | scene / tileset (of 4, within bank) | beat |
| B2 + ↑/↓ | movement (of 4) | tick |
| B1+B2 + ↑/↓ | scene **bank** (of 4) | beat |
| B1+B2 + ←/→ | tempo nudge ±1 frame (INT clock only) | instant |
| B2 tap (alone) | overlay show/hide | instant (on release) |
| B2 hold + B1 tap | freeze to primary (flat, momentary) | instant |

Latches were tightened from the original beat/bar to **tick** (palette/effect/movement)
and **beat** (scene/bank) for live responsiveness — still on-grid, but near-instant.
Scenes are **4 banks × 4** (16 total): B2+←/→ picks the slot, B1+B2+↑/↓ picks the bank.

Edge-detect the D-pad (release before it steps again). B2 disambiguates tap-vs-hold on
release: if any D-pad/B1 happened during the hold it was a modifier and the tap is
swallowed; otherwise it toggles the overlay.

## Clock sources

One internal tick, source-selected, auto-falling-back to INT when an external source
goes quiet:

- **INT** — frames/beat from the bank's `default_bpm` + region; fractional remainder
  accumulated to stay phase-true to the display. Adjustable by tempo-nudge.
- **IN** — 2-bit counter, another SMS pushing OUT; 1 edge/row = 1 tick.
- **IN24** — 24 PPQN Link/bridge; ÷6 → tick, ÷24 → beat.

Sync lives on **controller port 2** (TR = bit0, TH = bit1); see SMSGGDJ's `HARDWARE.md`
for the electrical contract — it's identical, and the SYNC IN reader can be reused.

## Build targets

Eventually two ROMs from one source tree, like the tracker: **`smsvj.sms`** (Master
System, full screen) and **`smsvj.gg`** (Game Gear, handheld screen + real stereo is
N/A here but the smaller framebuffer matters). v1 may be SMS-only; structure for both.

Toolchain mirrors SMSGGDJ: **WLA-DX** (`wla-z80` + `wlalink`) + Python 3 for build
tools, browser apps for the user-facing tooling. Match the sibling repo's `make`
targets and layout where sensible.

## Current repo state (as of this writing)

Day zero: the repo contains **only the two design docs** (`CLAUDE.md`,
`SCENE_FORMAT.md`) — no source, no `make` targets, no toolchain installed, not yet a
git repo. Don't hunt for a Makefile or `src/`; there isn't one. Start from **Build
order step 1** (the browser look-patcher emitter) unless told otherwise. Toolchain and
layout are to be mirrored from the sibling SMSGGDJ repo when the first code lands.

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
