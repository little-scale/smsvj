# Running SMS/GG emulation (incl. headless screenshots)

Notes for an agent (or human) working on this repo on macOS. Covers the
interactive emulator and the "launch → boot → screenshot → kill" recipe for
automated verification, plus what you can and can't trust an emulator for.

## TL;DR

- **Interactive check:** run the ROM in a GUI emulator (Emulicious / SMS Plus /
  mednafen) and look at it.
- **Automated screenshot (headless-ish):** there is no truly windowless path on
  macOS — you launch the emulator, wait for it to boot, grab the screen with
  `screencapture`, then kill it. Recipe below.
- **Trust boundary:** emulators are fine for **UI / logic / layout**. They are
  **not** trustworthy for cycle-exact wire timing (PSG DAC feed, controller-port
  sync, DMA-tight effects) — verify those on **real hardware**.

## Automated screenshot recipe (macOS)

`mednafen` plays `.sms` and `.gg` directly (its `sms` / `gg` modules) and is easy
to script. A window *does* briefly appear; `screencapture -x` grabs it while it's
up.

```sh
cd ~/Documents/smsvj
ROM=rom/smsvj.sms                # the built ROM (from `make` in rom/)

mednafen -sound 0 -video.fs 0 "$ROM" >/tmp/mdn.log 2>&1 &
MPID=$!
perl -e 'select(undef,undef,undef,4)'      # ~4 s: window + boot (see sleep note)
screencapture -x /tmp/smsvj_shot.png       # silent, full-screen PNG
kill $MPID 2>/dev/null; wait $MPID 2>/dev/null

echo "=== emulator log tail ==="; tail -15 /tmp/mdn.log
ls -l /tmp/smsvj_shot.png
```

Then `Read` the PNG to inspect it.

### Gotchas that bite an agent

- **Don't use a foreground `sleep`** — it's blocked in the agent harness. Use
  `perl -e 'select(undef,undef,undef,N)'` for an N-second wait, or run the whole
  thing with `run_in_background`.
- **Background the emulator** (`&`) and capture its PID (`$!`) so you can `kill`
  it afterward — otherwise it runs forever and holds the display/audio.
- **`screencapture -x`** is silent + **full screen**. For just the emulator window
  you need its window id (`screencapture -l <id>`), or crop the full grab after.
  For a quick "did it boot / what's on the splash" check, full screen is fine.
- Redirect emulator stdout/stderr to a log (`>/tmp/mdn.log 2>&1`) — mednafen is
  chatty, and the log is where load errors show up.
- Tune the wait: too short and you screenshot a black/booting screen; ~3–5 s is
  usually enough past the BIOS/boot splash.

## Interactive emulators

- **mednafen** — scriptable, multi-system (`sms`/`gg`), best for the recipe above.
- **Emulicious** — a Java GUI emulator with a good debugger and decent PSG-DAC
  emulation. If a project bundles it, it usually needs `AudioSync=true` in its
  `.ini` or it free-runs at turbo speed. GUI-only (not headless).
- **SMS Plus** — lightweight SMS/GG emulator; handy for a quick look and for its
  `.sav` (gzip) save format.

## What emulators are (and aren't) good for

Good: text/UI layout, palette, screen navigation, save/load logic, scene/data
format round-trips — anything that isn't sub-frame timing.

Not good: the **timing-critical** paths. On the Sega hardware the PSG DAC feed,
the controller-port serial/sync lines, and any line-IRQ / cycle-counted effect
depend on exact timing that emulators approximate. If a feature touches those,
**"builds clean + looks right in the emulator" is necessary but not sufficient —
confirm on a real console** (e.g. an Everdrive on an SMS, or a Mega Drive in
Master System mode).
