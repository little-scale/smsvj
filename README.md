# SMSVJ

A companion **VJ tool** for the Sega Master System / Game Gear — the visual sibling to
[SMSGGDJ](https://github.com/little-scale/smsggdj) (the tracker). The SMS *is* the
visual: minimal custom tiles rendered as a kaleidoscope (or full-frame), with live
palette / effect / movement / scene ridden from controller 1 and latched to a musical
clock shared with the tracker.

📖 **[Read the manual](MANUAL.md)** for full usage of both browser tools, ROM ripping,
and the build. See **[`CLAUDE.md`](CLAUDE.md)** for the design brief and hard invariants,
and **[`SCENE_FORMAT.md`](SCENE_FORMAT.md)** for the `.svjb` bank format — the contract
between the browser tool (emitter) and the ROM runtime (consumer).

## The tools

Two browser apps (no build step — open the HTML directly, or `cd tool && python3 -m http.server`):

- **Look-patcher** (`tool/index.html`) — design tilesets from a geometry engine (12 styles,
  rotate/spin/thick/period/cell), 16 global palettes with a seed-based palette generator,
  a 9-way effect dial and 7 movements; preview against a fake clock; **bake the `.svjb`
  scene bank** for the console.
- **Tile studio** (`tool/studio.html`) — compose scenes by hand: **rip 8×8 tiles from a
  ROM** (decompressing Phantasy Star RLE, Sonic 1, Sonic 2/Aspect, or RNC ProPack) or
  quantise an image, then stamp / select / move / rotate / mirror / invert / fill /
  pixel-edit, with undo. Exports a `.svjt` the look-patcher imports.

They run **locally** — open `tool/index.html` (or the root `index.html` for a launcher).

## Controls

Everything is played from **controller 1**. Each face button owns a theme —
**B1 = effect**, **B2 = look**, **B1+B2 = source** — and the direction pad picks the
value. Changes are captured the instant you press and applied on the next musical
boundary (the *latch*), so you can arm a move early and it lands in time.

| Input | Action | Latch |
|---|---|---|
| **B1 + ↑ / ↓** | **Effect dial** — 9 steps: `NONE` at centre, 4 glitch effects up, 4 down | tick |
| **B1 + ← / →** | **Effect speed** — 0–15, clamped (no wrap); scales corruption passes/frame | instant |
| **B2 + ↑ / ↓** | **Movement** — 7 options (see below) | tick |
| **B1+B2 + ← / →** | **Tileset** — of 16; palette stays | beat |
| **B1+B2 + ↑ / ↓** | **Palette** — of 16; tileset stays | tick |
| **B2 tap** (alone) | Overlay show / hide | on release |
| **Pause** (console button) | **Colour freeze** — hold current colours (toggle) | instant |

Palette and tileset are **independent** — the B1+B2 combo mixes them: ←/→ swaps the
tileset keeping the palette, ↑/↓ swaps the palette keeping the tileset.

- **Effect dial** (all corruption): down = SMEAR-D / STAMP / XOR / MORPH · centre = NONE ·
  up = SCRAMBLE / SMEAR-H / SMEAR-V / CHURN.
- **Movement of 7**: slow up · slow down · fast up · fast down · wobble A · wobble B · none.

**Clock:** row = 1/16 = **tick**, **beat** = 4 ticks, **bar** = 16 ticks. Tempo comes from
the internal clock or an external sync source (SMSGGDJ / Ableton Link via the ESP32
bridge) on controller port 2.

## Look-patcher (browser tool)

The authoring app that bakes `.svjb` scene banks. **The runtime is dumb; the tool is
smart** — the fold, tile de-dup (incl. H/V/HV flips), and colour work all happen here
and are baked to finished name tables before they reach the console.

Open it:

```
cd tool
python3 -m http.server 8000     # or just open tool/index.html directly
# → http://localhost:8000
```

- **Author** a quarter (16×12 tiles → 4-way kaleidoscope) or a full 32×24 frame.
- **Preview** runs against a fake clock; palette/effect/movement latch to the beat,
  scene to the bar — the controller-1 grammar.
- **Export .svjb** serializes the 4-scene bank and validates it via a round-trip decode.

Headless test of the emitter core (encode / dedupe-with-flips / fold / serialize):

```
node tool/test/roundtrip.js
```

## ROM

Build the console ROM (WLA-DX; regenerates the embedded scene bank from the tool):

```
cd rom
make bank && make      # → rom/smsvj.sms (96 KB, standard Sega mapper)
```

`make bank` re-exports `assets/look.svjb` from the look-patcher's built-in scenes
before assembling. Plain `make` reuses the existing bank.

To build the ROM from a **scene bank you authored in the browser tool** (its ⬇ Export
.svjb button writes the ROM-ready page-aligned image directly):

```
cd rom
make import FILE=~/Downloads/look.svjb   # copies/re-pages it into assets/
make
```

`make import` routes through `tool/repage.js`, which page-aligns each scene to 16 KB and
pads to the four 16 KB banks the ROM slices — so it works for current exports and older
compact ones alike.

## Status

Both browser tools (look-patcher + tile studio) and the ROM runtime — clock/latch core,
tile & name-table upload, register-2 mirror switching, 16 palettes/movement, and the full
corruption suite — run on hardware. **Sync is hardware-confirmed on both paths**: **IN**
(÷1) synced to a **hardware SMSGGDJ**, and **IN24** (÷6) following a **USB-MIDI clock via
the ESP32-S3** bridge — both on controller port 2, with tempo-locked movement and effects.
ROM graphics ripping supports Phantasy Star RLE, Sonic 1, Sonic 2/Aspect and RNC ProPack
(RNC verified byte-exact against the reference compressor). See `CLAUDE.md` → Build order.

## Companion projects

- **[smsggdj](https://github.com/little-scale/smsggdj)** — the **tracker** SMSVJ is the
  visual sibling to. Shares the clock vocabulary (tick / beat / bar), the SYNC contract on
  controller port 2, and the LIVE-mode launch-quantize input core. Run one SMS as the
  tracker and a second as the VJ, synced together.
- **[smsggdj-link-esp32](https://github.com/little-scale/smsggdj-link-esp32)** — an ESP32
  **Ableton Link** bridge that drives the shared `SYNC: IN` counter; can fan out to
  multiple consoles (tracker + VJ) in parallel.

---

*MIT, © 2026 Sebastian Tomczak (little-scale).*
