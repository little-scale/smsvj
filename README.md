# SMSVJ

A companion **VJ tool** for the Sega Master System / Game Gear — the visual sibling to
[SMSGGDJ](https://github.com/little-scale/smsggdj) (the tracker). The SMS *is* the
visual: minimal custom tiles rendered as a kaleidoscope (or full-frame), with live
palette / effect / movement / scene ridden from controller 1 and latched to a musical
clock shared with the tracker.

See **[`CLAUDE.md`](CLAUDE.md)** for the design brief and hard invariants, and
**[`SCENE_FORMAT.md`](SCENE_FORMAT.md)** for the `.svjb` bank format — the contract
between the browser tool (emitter) and the ROM runtime (consumer).

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

## Status

Build order step 1 (look-patcher emitter) is in progress. The ROM runtime,
sync input, and MIDI/Link paths are not yet started — see `CLAUDE.md` → Build order.

---

*MIT, © 2026 Sebastian Tomczak (little-scale).*
