; ---------------------------------------------------------------------------
; VDP helpers: register writes, address setup, and block uploads to VRAM/CRAM.
; ---------------------------------------------------------------------------
.SECTION "vdp" FREE

; Write one VDP register. A = value, B = command byte ($80 | reg).
vdp_reg:
  out (VDP_CTRL),a
  ld a,b
  out (VDP_CTRL),a
  ret

; Initialise VDP registers (display off), clear VRAM and CRAM.
vdp_init:
  ld hl,vdp_init_tab
  ld b,11
-:
  ld a,(hl)                  ; value
  out (VDP_CTRL),a
  inc hl
  ld a,(hl)                  ; command
  out (VDP_CTRL),a
  inc hl
  djnz -
  ; clear 16 KB VRAM
  ld hl,$0000
  ld a,l
  out (VDP_CTRL),a
  ld a,h
  or $40
  out (VDP_CTRL),a
  ld bc,$4000
-:
  xor a
  out (VDP_DATA),a
  dec bc
  ld a,b
  or c
  jr nz,-
  ; clear 32 CRAM entries
  xor a
  out (VDP_CTRL),a
  ld a,$C0
  out (VDP_CTRL),a
  ld b,32
-:
  xor a
  out (VDP_DATA),a
  djnz -
  ; terminate the sprite attribute table (SAT at $3F00): Y=$D0 on sprite 0 so
  ; the VDP draws no sprites (we don't use them yet).
  ld hl,VRAM_SAT
  ld a,l
  out (VDP_CTRL),a
  ld a,h
  or $40
  out (VDP_CTRL),a
  ld a,$D0
  out (VDP_DATA),a
  ret

; Copy a block to VRAM. HL = VRAM dest, DE = ROM src, BC = length.
copy_to_vram:
  ld a,l
  out (VDP_CTRL),a
  ld a,h
  or $40
  out (VDP_CTRL),a
-:
  ld a,(de)
  out (VDP_DATA),a
  inc de
  dec bc
  ld a,b
  or c
  jr nz,-
  ret

; Copy a block to CRAM. A = start index (0-31), DE = ROM src, B = count.
copy_to_cram:
  out (VDP_CTRL),a
  ld a,$C0
  out (VDP_CTRL),a
-:
  ld a,(de)
  out (VDP_DATA),a
  inc de
  djnz -
  ret

; Upload the 32-entry live palette shadow to CRAM 0..31.
cram_upload_live:
  xor a
  out (VDP_CTRL),a
  ld a,$C0
  out (VDP_CTRL),a
  ld hl,live_pal
  ld b,32
-:
  ld a,(hl)
  out (VDP_DATA),a
  inc hl
  djnz -
  ret

vdp_init_tab:
.db $04,$80    ; r0  mode 4, line int off
.db $80,$81    ; r1  display OFF, 8x8 sprites
.db $FF,$82    ; r2  name table base $3800 (layout slot 0)
.db $FF,$83    ; r3
.db $FF,$84    ; r4
.db $FF,$85    ; r5  SAT base $3F00
.db $FB,$86    ; r6  sprite pattern base $2000
.db $00,$87    ; r7  backdrop = CRAM entry 0
.db $00,$88    ; r8  hscroll
.db $00,$89    ; r9  vscroll
.db $FF,$8A    ; r10 line counter
.ENDS
