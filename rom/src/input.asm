; ---------------------------------------------------------------------------
; Controller-1 pad grammar (capture-instant). D-pad is edge-detected; each axis
; accumulates a pending 2-bit index that the clock latches on its boundary.
;
;   B1 + L/R : palette      B1 + U/D : effect
;   B2 + L/R : scene        B2 + U/D : movement
;   B1+B2 (no d-pad) : freeze (momentary)   B1+B2 + L/R : tempo nudge
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

  ; --- freeze release: freeze needs B1 AND B2 still held ---
  ld a,(freeze)
  or a
  jr z,ri_decode
  ld a,c
  and PAD_B1|PAD_B2
  cp PAD_B1|PAD_B2
  jr z,ri_decode             ; both still held: stay frozen
  xor a
  ld (freeze),a
  call cram_upload_live      ; restore the live palette

ri_decode:
  ld a,c
  and PAD_B1
  jr z,ri_b2only             ; B1 not held
  ; --- B1 held ---
  ld a,c
  and PAD_B2
  jr z,ri_b1only
  ; --- B1 + B2 held ---
  ld a,d
  and PAD_LEFT|PAD_RIGHT
  jr z,ri_freeze
  ; tempo nudge (instant): right = +1, left = -1
  bit 3,d
  call nz,tempo_up
  bit 2,d
  call nz,tempo_down
  call set_b2mod
  jp ri_store
ri_freeze:
  call set_b2mod
  ld a,(freeze)
  or a
  jp nz,ri_store             ; already frozen
  ld a,1
  ld (freeze),a
  call freeze_flatten
  jp ri_store

ri_b1only:
  ; B1 + L/R -> palette ; B1 + U/D -> effect
  bit 3,d
  jr z,+
  ld hl,pend_pal
  call nudge_up
+:
  bit 2,d
  jr z,+
  ld hl,pend_pal
  call nudge_down
+:
  bit 0,d
  jr z,+
  ld hl,pend_fx
  call nudge_up
+:
  bit 1,d
  jr z,ri_store
  ld hl,pend_fx
  call nudge_down
  jp ri_store

ri_b2only:
  ld a,c
  and PAD_B2
  jr z,ri_none               ; neither B1 nor B2 held
  ; B2 + L/R -> scene ; B2 + U/D -> movement (all set b2_mod)
  bit 3,d
  jr z,+
  ld hl,pend_scene
  call nudge_up
  call set_b2mod
+:
  bit 2,d
  jr z,+
  ld hl,pend_scene
  call nudge_down
  call set_b2mod
+:
  bit 0,d
  jr z,+
  ld hl,pend_mv
  call nudge_up
  call set_b2mod
+:
  bit 1,d
  jr z,ri_store
  ld hl,pend_mv
  call nudge_down
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

set_b2mod:
  ld a,1
  ld (b2_mod),a
  ret

; Tempo nudge (INT clock): bpm +/-1, clamped 20..240, then recompute fpt.
tempo_up:
  ld a,(bpm)
  cp 240
  ret z
  inc a
  ld (bpm),a
  jp clock_compute_fpt
tempo_down:
  ld a,(bpm)
  cp 20
  ret z
  dec a
  ld (bpm),a
  jp clock_compute_fpt
.ENDS
