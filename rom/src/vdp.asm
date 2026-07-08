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

; ---- font + on-screen text (sprites) --------------------------------------
; The font (assets/font.bin, 64 Mode-4 tiles) loads to VRAM $1800 = tile $C0;
; a glyph's sprite tile number is (ASCII char + $A0). Text is drawn as a single
; centred row of hardware sprites overlaid on the visual, so it never disturbs
; the name table. reg6 = $FB -> sprite pattern base $0000, so sprite tile N = VRAM tile N.
load_font:
  ld hl,FONT_VTILE
  ld de,font_data
  ld bc,2048                 ; 64 tiles x 32 bytes
  jp copy_to_vram

; Draw HL (0-terminated string, chars $20-$5F) as a centred sprite row at TEXT_Y.
; Capped at 8 glyphs (SMS 8-sprites-per-line limit). Clobbers AF/BC/DE/HL.
text_draw:
  ld b,0                     ; measure length (cap 8)
  push hl
td_len:
  ld a,(hl)
  or a
  jr z,td_have
  inc hl
  inc b
  ld a,b
  cp 8
  jr c,td_len
td_have:
  pop hl                     ; HL = string, B = len
  ld a,b
  add a,a
  add a,a                    ; len*4
  ld c,a
  ld a,128
  sub c
  ld d,a                     ; D = start X (centred)
  ; --- Y table at SAT $3F00 (write addr $7F00) ---
  ld a,$00
  out (VDP_CTRL),a
  ld a,$7F
  out (VDP_CTRL),a
  push bc
  push hl
  ld a,b
  or a
  jr z,td_yend
td_y:
  ld a,TEXT_Y
  out (VDP_DATA),a
  dec b
  jr nz,td_y
td_yend:
  ld a,$D0                   ; terminator after the last sprite
  out (VDP_DATA),a
  pop hl
  pop bc
  ; --- X + tile table at $3F80 (write addr $7F80) ---
  ld a,$80
  out (VDP_CTRL),a
  ld a,$7F
  out (VDP_CTRL),a
td_x:
  ld a,b
  or a
  ret z
  ld a,d
  out (VDP_DATA),a           ; X
  add a,8
  ld d,a
  ld a,(hl)
  add a,FONT_TILEBASE        ; char -> tile number
  out (VDP_DATA),a           ; tile
  inc hl
  dec b
  jr td_x

; Hide the text overlay: sprite 0 Y = $D0 terminates the SAT.
text_hide:
  ld a,$00
  out (VDP_CTRL),a
  ld a,$7F
  out (VDP_CTRL),a
  ld a,$D0
  out (VDP_DATA),a
  ret

; A = colour -> CRAM entry 17 (the sprite ink the text glyphs use).
set_text_ink:
  ld c,a
  ld a,17
  out (VDP_CTRL),a
  ld a,$C0
  out (VDP_CTRL),a
  ld a,c
  out (VDP_DATA),a
  ret

vdp_init_tab:
.db $04,$80    ; r0  mode 4, line int off
.db $80,$81    ; r1  display OFF, 8x8 sprites
.db $FF,$82    ; r2  name table base $3800 (layout slot 0)
.db $FF,$83    ; r3
.db $FF,$84    ; r4
.db $FF,$85    ; r5  SAT base $3F00
.db $FB,$86    ; r6  sprite pattern base $0000 (bit2 clear)
.db $00,$87    ; r7  backdrop = CRAM entry 0
.db $00,$88    ; r8  hscroll
.db $00,$89    ; r9  vscroll
.db $FF,$8A    ; r10 line counter
.ENDS
