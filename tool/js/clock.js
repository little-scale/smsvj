// Fake internal clock + the arm/latch quantise core (SMSGGDJ LIVE-mode logic):
// capture-instant / apply-on-division. Each axis accumulates a pending index the
// instant the pad is read; it applies on the axis's latch boundary (beat / bar).
window.SVJ = window.SVJ || {};
SVJ.clock = (function () {
  // tick = 1/16, beat = 4 ticks, bar = 16 ticks (shared with SMSGGDJ).
  const BEAT = 4, BAR = 16;

  function make(bank) {
    const region50 = (bank.region & 1) === 1;
    const fps = region50 ? 50 : 60;

    const state = {
      bpm: bank.default_bpm,
      fps,
      acc: 0,           // fractional frames accumulated toward the next tick
      tick: 0,          // integer ticks since start
      cur: { scene: bank.boot.scene, palette: bank.boot.palette, effect: bank.boot.effect, movement: bank.boot.movement },
      pend: { scene: bank.boot.scene, palette: bank.boot.palette, effect: bank.boot.effect, movement: bank.boot.movement },
      onLatch: null,    // (axis, value) => void
    };

    function framesPerTick() {
      // frames/beat = fps * 60 / bpm ; tick = beat/4.
      return (state.fps * 60) / state.bpm / BEAT;
    }

    // Capture-instant: nudge an axis's pending index now (opposite press cancels).
    // The effect axis is a clamped 9-way dial (0..8); other axes wrap mod 4.
    function nudge(axis, dir) {
      if (axis === "effect") {
        state.pend.effect = Math.max(0, Math.min(8, state.pend.effect + dir));
      } else {
        state.pend[axis] = (state.pend[axis] + dir + 4) & 3;
      }
    }
    function set(axis, value) {
      state.pend[axis] = axis === "effect" ? Math.max(0, Math.min(8, value)) : value & 3;
    }

    function latchBeatAxes() {
      for (const ax of ["palette", "effect", "movement"]) {
        if (state.pend[ax] !== state.cur[ax]) {
          state.cur[ax] = state.pend[ax];
          if (state.onLatch) state.onLatch(ax, state.cur[ax]);
        }
      }
    }
    function latchBarAxis() {
      if (state.pend.scene !== state.cur.scene) {
        state.cur.scene = state.pend.scene;
        if (state.onLatch) state.onLatch("scene", state.cur.scene);
      }
    }

    // Advance by dtFrames (usually ~1 per rAF at target fps). Returns ticks stepped.
    function advance(dtFrames) {
      state.acc += dtFrames;
      const fpt = framesPerTick();
      let stepped = 0;
      while (state.acc >= fpt) {
        state.acc -= fpt;
        state.tick++;
        stepped++;
        if (state.tick % BEAT === 0) latchBeatAxes();
        if (state.tick % BAR === 0) latchBarAxis();
      }
      return stepped;
    }

    // Movement phase for the current movement's division (ticks per step).
    function movePhase(division) {
      return Math.floor(state.tick / Math.max(1, division));
    }

    return { state, framesPerTick, nudge, set, advance, movePhase, BEAT, BAR };
  }

  return { make, BEAT, BAR };
})();
