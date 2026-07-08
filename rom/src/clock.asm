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

; ---- SYNC IN -------------------------------------------------------------
; Follow a 2-bit counter on controller port 2 (SMSGGDJ / genmddj SYNC OUT: one
; clock per row = one tick, /1). Reuses SMSGGDJ's reader verbatim. When sync
; clocks arrive we tick from them and flash the border; after CLOCK_SYNC_IDLE
; quiet frames we fall back to the INT accumulator.
.DEFINE CLOCK_FLASH     3      ; border-flash frames on a sync beat

; Read the master's counter: B = TH<<1 | (TR AND TL). Counter bit 0 is TR AND TL
; so straight and crossed cables both work. $DD: bit3=TR, bit2=TL, bit7=TH.
sync_read:
  in a,($DD)
  ld c,a
  ld b,0
  and $0C                    ; TR AND TL
  cp $0C
  jr nz,sr_th
  ld b,1
sr_th:
  bit 7,c                    ; TH
  ret z
  set 1,b
  ret

; A = sync clocks received since last frame (0-3). Clobbers BC.
sync_in_delta:
  call sync_read             ; B = 2-bit counter
  ld a,(sync_last)
  ld c,a
  ld a,b
  ld (sync_last),a
  sub c
  and 3
  ret

; Per-frame clock entry, dispatched on sync_mode:
;   OFF  -> internal accumulator (clock_update)
;   IN   -> follow the port-2 counter, one clock = one tick (÷1)
;   IN24 -> follow a 24-PPQN sender, one tick per 6 clocks (÷6)
; Slaves flash the border on the beat and hold (no ticks) while no clock arrives.
clock_frame:
  ld a,(sync_mode)
  or a
  jp z,clock_update          ; SYNC_OFF
  call sync_in_delta         ; A = clocks this frame (0-3)
  or a
  ret z                      ; slave, no clock yet: hold
  ld c,a
  ld a,(sync_mode)
  cp SYNC_IN24
  jr z,cf_in24
cf_in:                       ; ÷1: tick C times
  ld b,c
cf_in_l:
  push bc
  call clock_tick
  pop bc
  djnz cf_in_l
  ret
cf_in24:                     ; ÷6: accumulate, tick each 6 clocks
  ld a,(sync_acc6)
  add a,c
cf_in24_l:
  cp 6
  jr c,cf_in24_done
  sub 6
  push af
  call clock_tick
  pop af
  jr cf_in24_l
cf_in24_done:
  ld (sync_acc6),a
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
  ; --- beat --- optional border flash (B2 tap; any clock source)
  ld a,(beat_flash)
  or a
  jr z,ct_noflash
  ld a,CLOCK_FLASH
  ld (sync_flash),a
ct_noflash:
  call mosh_step             ; beat kick: an extra corruption burst on the beat
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

; Tileset latch: reload tiles/layouts on the beat when the tileset changes.
latch_scene:
  ld a,(pend_scene)
  ld b,a
  ld a,(cur_scene)
  cp b
  ret z                      ; unchanged
  ld a,b
  ld (cur_scene),a
  call scene_resolve
  call scene_load
  call movement_apply
  ld a,(mv_div)
  ld (mv_count),a
  jp recompose
.ENDS
