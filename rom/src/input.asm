; ---------------------------------------------------------------------------
; Controller-1 pad grammar (capture-instant). D-pad is edge-detected.
;
;   B1     : L/R = effect SPEED (0-15, clamped)  U/D = effect DIAL (of 9)
;   B2     :                                U/D = movement (of 7)
;   B1+B2  : L/R = tileset (of 16)          U/D = palette (of 16)
;   PAUSE button (NMI) : colour freeze (toggle) -- see nmi handler
;   B2 tap alone (on release) : overlay toggle
; ---------------------------------------------------------------------------
.SECTION "input" FREE

read_input:
  in a,(PORT_PAD1)
  cpl
  and %00111111              ; U D L R B1 B2 -> 1 = pressed
  ld c,a                     ; C = current pad
  ld a,(prev_pad)
  cpl
  and c
  ld d,a                     ; D = newly-pressed edges

ri_decode:
  ld a,c
  and PAD_B1
  jr z,ri_b2only             ; B1 not held
  ld a,c
  and PAD_B2
  jr z,ri_b1only
  ; --- B1 + B2 : L/R = tileset (of 16), U/D = palette (of 16), no d-pad = freeze ---
  bit 3,d                    ; right -> tileset +1
  jr z,bb_l
  ld hl,pend_scene
  call nudge_s16_up
  call set_b2mod
bb_l:
  bit 2,d                    ; left -> tileset -1
  jr z,bb_u
  ld hl,pend_scene
  call nudge_s16_down
  call set_b2mod
bb_u:
  bit 0,d                    ; up -> palette +1
  jr z,bb_d
  ld hl,pend_pal
  call nudge_p16_up
  call set_b2mod
bb_d:
  bit 1,d                    ; down -> palette -1
  jr z,ri_store
  ld hl,pend_pal
  call nudge_p16_down
  call set_b2mod
  jp ri_store

ri_b1only:
  ; B1 : L/R = effect speed (instant) ; U/D = effect dial (clamp 0-8)
  bit 3,d                    ; right -> faster
  call nz,speed_up
  bit 2,d                    ; left -> slower
  call nz,speed_down
  bit 0,d                    ; up -> effect +1
  call nz,nudge_fx_up
  bit 1,d                    ; down -> effect -1
  call nz,nudge_fx_down
  jp ri_store

ri_b2only:
  ld a,c
  and PAD_B2
  jr z,ri_none               ; neither B1 nor B2 held
  ; B2 : U/D = movement of 7 (palette lives on the B1+B2 combo now)
  bit 0,d
  jr z,b2_d
  ld hl,pend_mv
  call nudge_m7_up
  call set_b2mod
b2_d:
  bit 1,d
  jr z,ri_store
  ld hl,pend_mv
  call nudge_m7_down
  call set_b2mod
  jp ri_store

ri_none:
  ; neither held now: was B2 just released? tap (no modifier) toggles overlay.
  ld a,(prev_pad)
  and PAD_B2
  jr z,ri_store              ; B2 wasn't held last frame
  ld a,(b2_mod)
  or a
  jr nz,ri_clearmod
  ld a,(overlay)
  xor 1
  ld (overlay),a             ; overlay rendering: TODO (sprite row)
ri_clearmod:
  xor a
  ld (b2_mod),a

ri_store:
  ld a,c
  ld (prev_pad),a
  ret

; ---- helpers --------------------------------------------------------------
; HL -> pending axis byte; bump/decrement modulo 4 (opposite press cancels).
nudge_up:
  ld a,(hl)
  inc a
  and 3
  ld (hl),a
  ret
nudge_down:
  ld a,(hl)
  dec a
  and 3
  ld (hl),a
  ret

; Tileset selector: wrap modulo 16.
nudge_s16_up:
  ld a,(hl)
  inc a
  and 15
  ld (hl),a
  ret
nudge_s16_down:
  ld a,(hl)
  dec a
  and 15
  ld (hl),a
  ret

; Palette selector: wrap modulo 16 (paired 1:1 with the 16 tilesets).
nudge_p16_up:
  ld a,(hl)
  inc a
  and 15
  ld (hl),a
  ret
nudge_p16_down:
  ld a,(hl)
  dec a
  and 15
  ld (hl),a
  ret

; Movement selector: wrap 0..6 (7 options).
nudge_m7_up:
  ld a,(hl)
  inc a
  cp 7
  jr c,+
  xor a
+:
  ld (hl),a
  ret
nudge_m7_down:
  ld a,(hl)
  or a
  jr nz,+
  ld a,7
+:
  dec a
  ld (hl),a
  ret

; Effect dial: clamp pend_fx to 0..8 (NONE centre = 4).
nudge_fx_up:
  ld a,(pend_fx)
  cp 8
  ret z
  inc a
  ld (pend_fx),a
  ret
nudge_fx_down:
  ld a,(pend_fx)
  or a
  ret z
  dec a
  ld (pend_fx),a
  ret

; Effect speed: clamp mosh_speed to 0..15 (instant, no wrap).
speed_up:
  ld a,(mosh_speed)
  cp 15
  ret z
  inc a
  ld (mosh_speed),a
  ret
speed_down:
  ld a,(mosh_speed)
  or a
  ret z
  dec a
  ld (mosh_speed),a
  ret

set_b2mod:
  ld a,1
  ld (b2_mod),a
  ret
.ENDS
