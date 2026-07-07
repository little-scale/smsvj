; ---------------------------------------------------------------------------
; INT clock: an 8.8 fixed frame->tick accumulator, and the tick/beat/bar latch.
; frames-per-tick = fps*15/bpm (tick = beat/4). The fractional remainder is
; carried in the accumulator so the tick stays phase-true to the display.
; ---------------------------------------------------------------------------
.SECTION "clock" FREE

; Compute fpt (8.8) from bpm + region. n = fps*15 (900 @60Hz / 750 @50Hz).
; fpt_hi = n/bpm ; fpt_lo = ((n%bpm)<<8)/bpm.
clock_compute_fpt:
  ld a,(region)
  and 1
  jr nz,+
  ld hl,900                  ; 60 Hz
  jr ++
+:
  ld hl,750                  ; 50 Hz
++:
  ld a,(bpm)
  ld c,a
  call div16_8               ; HL = n/bpm, A = n%bpm
  ld b,a                     ; B = remainder
  ld a,l
  ld (fpt_hi),a              ; integer frames/tick
  ld h,b
  ld l,0                     ; HL = remainder << 8
  ld a,(bpm)
  ld c,a
  call div16_8               ; HL = frac quotient (<256)
  ld a,l
  ld (fpt_lo),a
  ret

; HL / C -> HL = quotient, A = remainder. (quotient assumed < 256 here.)
div16_8:
  xor a
  ld b,16
-:
  add hl,hl
  rla
  cp c
  jr c,+
  sub c
  inc l
+:
  djnz -
  ret

; Called once per frame: acc += 1.0, and emit a tick when acc >= fpt.
clock_update:
  ld a,(acc_hi)
  inc a                      ; acc += 256 (one frame in 8.8)
  ld (acc_hi),a
  ld a,(acc_lo)
  ld l,a
  ld a,(acc_hi)
  ld h,a                     ; HL = acc
  ld a,(fpt_lo)
  ld e,a
  ld a,(fpt_hi)
  ld d,a                     ; DE = fpt
  or a
  sbc hl,de
  ret c                      ; acc < fpt: no tick this frame
  ld a,l
  ld (acc_lo),a
  ld a,h
  ld (acc_hi),a              ; acc -= fpt
  ; fall through to a single tick (fpt is always > 1 frame)

clock_tick:
  ld hl,(tick_lo)
  inc hl
  ld (tick_lo),hl
  ; --- movement down-counter (skip while STATIC) ---
  ld a,(mv_type)
  or a
  jr z,ct_beat
  ld a,(mv_count)
  dec a
  ld (mv_count),a
  jr nz,ct_beat
  call movement_step
  ld a,(mv_div)
  ld (mv_count),a
ct_beat:
  call latch_fast            ; palette/effect/movement latch every TICK (snappy)
  ld a,(tick_lo)
  and 3
  ret nz                     ; scene latches on the beat (every 4 ticks)
  jp latch_scene

; Fast latch: palette / effect / movement (capture-instant, apply-on-tick).
latch_fast:
  ld a,(pend_pal)
  ld b,a
  ld a,(cur_pal)
  cp b
  jr z,lb_fx
  ld a,b
  ld (cur_pal),a
  call recompose
lb_fx:
  ld a,(pend_fx)
  ld b,a
  ld a,(cur_fx)
  cp b
  jr z,lb_mv
  ld a,b
  ld (cur_fx),a
  call recompose
lb_mv:
  ld a,(pend_mv)
  ld b,a
  ld a,(cur_mv)
  cp b
  ret z
  ld a,b
  ld (cur_mv),a
  call movement_apply
  ld a,(mv_div)
  ld (mv_count),a
  ret

; Scene latch: scene / tileset (the heavy reload), on the beat.
latch_scene:
  ld a,(pend_scene)
  ld b,a
  ld a,(cur_scene)
  cp b
  ret z
  ld a,b
  ld (cur_scene),a
  call scene_resolve
  call scene_load
  call movement_apply
  ld a,(mv_div)
  ld (mv_count),a
  jp recompose
.ENDS
