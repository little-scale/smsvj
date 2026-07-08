; ---------------------------------------------------------------------------
; .svjb parsing + scene load + the live palette/effect/movement pipeline.
; The ROM stays "dumb": it copies finished tiles/name-tables and mutates CRAM.
; ---------------------------------------------------------------------------
.SECTION "scene" FREE

; Map the header page (page 0) into slot 2 so BANKHDR reads are valid.
page_hdr:
  ld a,DATA_BANK0
  ld (SLOT2_CTRL),a
  ret

; Parse the bank header, set timing, load the boot scene, apply boot fx/mv.
bank_init:
  call page_hdr
  ld a,(BANKHDR+BANK_REGION)
  ld (region),a
  ld a,(BANKHDR+BANK_BPM)
  ld (bpm),a
  ld a,(BANKHDR+BANK_BOOTSCENE)     ; boot tileset 0-15
  and 15
  ld (cur_scene),a
  ld (pend_scene),a
  ld a,(BANKHDR+BANK_BOOTPAL)
  ld (cur_pal),a
  ld (pend_pal),a
  ld a,(BANKHDR+BANK_BOOTFX)
  ld (cur_fx),a
  ld (pend_fx),a
  ld a,(BANKHDR+BANK_BOOTMV)
  ld (cur_mv),a
  ld (pend_mv),a
  xor a
  ld (tick_lo),a
  ld (tick_hi),a
  ld (acc_lo),a
  ld (acc_hi),a
  ld (prev_pad),a
  ld (b2_mod),a
  ld (overlay),a
  ld (freeze),a
  ld (mv_phase),a
  ld (tiles_dirty),a
  ld (layout_dirty),a
  ld (mosh_acc),a             ; a = 0
  ld a,6
  ld (mosh_speed),a           ; default speed (mid of 0-15)
  ld hl,$ACE1                 ; nonzero LFSR seed
  ld (lfsr),hl
  ; SYNC: boot in OFF (internal clock); seed the counter for a clean IN switch
  call sync_read
  ld a,b
  ld (sync_last),a
  xor a
  ld (sync_mode),a            ; SYNC_OFF
  ld (sync_acc6),a
  ld (sync_flash),a
  ld (text_timer),a
  ld (sync_pending),a
  call clock_compute_fpt
  call scene_resolve
  call scene_load
  call movement_apply
  call recompose
  ret

; effective index (cur_bank*4 + cur_scene) -> scene_addr, paging the scene's
; ROM page into slot 2. scene_ptr[i] is a blob offset O; page = DATA_BANK0 +
; (O>>14), and the scene sits at $8000 + (O & $3FFF) (aligned so it never
; straddles a page). Reads the pointer table from the header page first.
scene_resolve:
  call page_hdr
  ld a,(cur_scene)           ; tileset 0-7
  ; clamp to scene_count-1
  ld c,a
  ld a,(BANKHDR+BANK_SCENECOUNT)
  dec a
  cp c
  jr nc,+
  ld c,a
+:
  ld a,c
  add a,a                    ; *2 (word offset into scene_ptr[])
  ld e,a
  ld d,0
  ld hl,BANKHDR+BANK_SCENEPTR
  add hl,de
  ld e,(hl)
  inc hl
  ld d,(hl)                  ; DE = blob offset O
  ; page = DATA_BANK0 + (O >> 14) = DATA_BANK0 + (D >> 6)
  ld a,d
  rlca
  rlca
  and 3
  add a,DATA_BANK0
  ld (SLOT2_CTRL),a          ; page the scene's data bank into slot 2
  ; scene_addr = $8000 + (O & $3FFF): high = $80 | (D & $3F), low = E
  ld a,d
  and $3F
  or $80
  ld d,a
  ld (scene_addr),de
  ret

; Upload the current scene: tiles -> $0000, each layout variant -> its 2 KB
; slot, and the current palette into the live shadow + CRAM.
scene_load:
  ld ix,(scene_addr)
  ; --- tiles ---  length = tile_count * 32
  ld a,(ix+SC_TILECOUNT)
  ld (tile_count),a
  ; mosh_mask = smallest 2^n-1 >= tile_count-1 (fill bits below the top set bit)
  dec a
  ld b,a
  srl b
  or b
  ld b,a
  srl b
  srl b
  or b
  ld b,a
  srl b
  srl b
  srl b
  srl b
  or b
  ld (mosh_mask),a
  ld a,(ix+SC_TILECOUNT)
  ld l,a
  ld h,0
  add hl,hl
  add hl,hl
  add hl,hl
  add hl,hl
  add hl,hl                  ; HL = count*32
  ld (tile_bytes),hl         ; DATAMOSH range
  xor a
  ld (tiles_dirty),a         ; freshly uploaded = clean
  ld b,h
  ld c,l                     ; BC = length
  ld l,(ix+SC_OFF_TILES)
  ld h,(ix+SC_OFF_TILES+1)
  ld de,(scene_addr)
  add hl,de                  ; HL = clean tiles ROM address
  ld (tiles_src),hl          ; keep it for CHURN heal
  ex de,hl                   ; DE = src
  ld hl,VRAM_TILES
  call copy_to_vram
  jp layout_reload           ; upload name-table variant(s), then return

; Re-upload the scene's layout variant(s) to their 2 KB VRAM slots (undo SCRAMBLE).
layout_reload:
  ld ix,(scene_addr)
  ld a,(ix+SC_LAYOUTCOUNT)
  ld (layout_count),a
  ld l,(ix+SC_OFF_LAYOUTS)
  ld h,(ix+SC_OFF_LAYOUTS+1)
  ld de,(scene_addr)
  add hl,de
  ld (tmp_ptr),hl            ; running src pointer
  ld a,(layout_count)
  ld b,a                     ; variants remaining
  ld c,0                     ; variant index
layout_loop:
  ; dest = $3800 - variant*$800
  ld a,c
  add a,a
  add a,a
  add a,a                    ; variant*8
  ld d,a
  ld a,$38
  sub d
  ld h,a
  ld l,0                     ; HL = dest
  ld de,(tmp_ptr)            ; DE = src
  push bc
  ld bc,LAYOUT_BYTES
  call copy_to_vram
  pop bc
  ld hl,(tmp_ptr)
  ld de,LAYOUT_BYTES
  add hl,de
  ld (tmp_ptr),hl
  inc c
  djnz layout_loop
  xor a
  ld (layout_dirty),a
  ret

; ---- palette / live pipeline ---------------------------------------------

; DE <- address of scene palette cur_pal (scene_addr + off_palettes + pal*32).
pal_src:
  ld ix,(scene_addr)
  ld l,(ix+SC_OFF_PALETTES)
  ld h,(ix+SC_OFF_PALETTES+1)
  ld de,(scene_addr)
  add hl,de                  ; HL = palettes base
  push hl
    ld a,(cur_pal)           ; 0-15
    ld l,a
    ld h,0
    add hl,hl               ; *2
    add hl,hl               ; *4
    add hl,hl               ; *8
    add hl,hl               ; *16
    add hl,hl               ; *32  (up to 15*32=480, needs 16-bit)
    ex de,hl               ; DE = pal*32
  pop hl                    ; HL = palettes base
  add hl,de
  ex de,hl                   ; DE = palette src
  ret

; live_pal <- scene palette cur_pal (no upload).
palette_reload_live:
  call pal_src
  ld hl,live_pal
  ld b,32
-:
  ld a,(de)
  ld (hl),a
  inc de
  inc hl
  djnz -
  ret

; Recompose CRAM = palette cur_pal, then apply the sticky effect on top.
recompose:
  call read_effect_record     ; decode current effect -> fx_type first
  ; restore tiles if moshed and no longer a pattern-mosh (CHURN 9 / XOR 12 / STAMP 13)
  ld a,(tiles_dirty)
  or a
  jr z,rc_ck_layout
  ld a,(fx_type)
  cp 9
  jr z,rc_ck_layout
  cp 12
  jr z,rc_ck_layout
  cp 13
  jr z,rc_ck_layout
  call tiles_reload
rc_ck_layout:
  ; restore name table if a layout-corruptor left (SCRAMBLE 8 / SMEAR 10 / MORPH 11)
  ld a,(layout_dirty)
  or a
  jr z,rc_disp
  ld a,(fx_type)
  cp 8
  jr z,rc_disp
  cp 10
  jr z,rc_disp
  cp 11
  jr z,rc_disp
  call layout_reload
rc_disp:
  ; display on (BLANK will turn it back off if selected)
  ld a,$E0
  ld b,$81
  call vdp_reg
  call palette_reload_live
  ld a,(fx_type)
  cp 1
  jr z,fx_layout
  cp 2
  jr z,fx_invert
  cp 3
  jr z,fx_rotate
  cp 4
  jr z,fx_freeze
  cp 6
  jr z,fx_blank
  ; NONE / WOBBLE(stub): just upload the palette
  jp cram_upload_live

fx_layout:
  ; reg2 = $FF - variant*2 (clamp variant to layout_count-1)
  ld a,(fx_p0)
  ld b,a
  ld a,(layout_count)
  dec a                      ; max variant
  cp b
  jr nc,+
  ld b,a                     ; clamp
+:
  ld a,b
  add a,a                    ; variant*2
  ld b,a
  ld a,$FF
  sub b
  ld b,$82                   ; reg2 command
  call vdp_reg
  jp cram_upload_live

fx_invert:
  ; complement live_pal[p1 .. p1+p2)
  ld a,(fx_p1)
  ld l,a
  ld h,0
  ld de,live_pal
  add hl,de                  ; HL = &live_pal[start]
  ld a,(fx_p2)
  or a
  jr z,fx_inv_done
  ld b,a
-:
  ld a,(hl)
  cpl
  and $3F
  ld (hl),a
  inc hl
  djnz -
fx_inv_done:
  jp cram_upload_live

fx_rotate:
  ; rotate live_pal[p1..+p2) by signed p0 (apply |p0| single steps).
  ld a,(fx_p1)
  ld (mv_start),a            ; borrow mv_start/mv_len as the working range
  ld a,(fx_p2)
  ld (mv_len),a
  ld a,(fx_p0)
  or a
  jp p,fx_rot_fwd
  neg
  ld b,a
-:
  push bc
  call rot_back_one
  pop bc
  djnz -
  jp cram_upload_live
fx_rot_fwd:
  or a
  jr z,fx_rot_done
  ld b,a
-:
  push bc
  call rot_fwd_one
  pop bc
  djnz -
fx_rot_done:
  jp cram_upload_live

fx_freeze:
  ; sticky freeze: flatten every entry to the palette's primary.
  call freeze_flatten
  ret

fx_blank:
  ; backdrop = p0, display off -> flat backdrop colour.
  ld a,(fx_p0)
  and $1F
  ld b,$87                   ; reg7 backdrop
  call vdp_reg
  ld a,$A0                   ; display off, frame int still enabled
  ld b,$81
  call vdp_reg
  ret

; Decode the active effect record into fx_type/p0/p1/p2.
read_effect_record:
  ld ix,(scene_addr)
  ld l,(ix+SC_OFF_EFFECTS)
  ld h,(ix+SC_OFF_EFFECTS+1)
  ld de,(scene_addr)
  add hl,de
  ld a,(cur_fx)
  add a,a
  add a,a                    ; fx*4
  ld e,a
  ld d,0
  add hl,de                  ; HL = &effect record
  ld a,(hl)
  ld (fx_type),a
  inc hl
  ld a,(hl)
  ld (fx_p0),a
  inc hl
  ld a,(hl)
  ld (fx_p1),a
  inc hl
  ld a,(hl)
  ld (fx_p2),a
  ret

; ---- movement -------------------------------------------------------------

; Latch the active movement record into mv_type/div/start/len; reset phase.
movement_apply:
  ld ix,(scene_addr)
  ld l,(ix+SC_OFF_MOVES)
  ld h,(ix+SC_OFF_MOVES+1)
  ld de,(scene_addr)
  add hl,de
  ld a,(cur_mv)
  add a,a
  add a,a                    ; mv*4
  ld e,a
  ld d,0
  add hl,de
  ld a,(hl)
  ld (mv_type),a
  inc hl
  ld a,(hl)
  ld (mv_div),a
  inc hl
  ld a,(hl)
  ld (mv_start),a
  inc hl
  ld a,(hl)
  ld (mv_len),a
  ; init phase (wobble B = type 4 starts anti-phase, 8 steps offset)
  xor a
  ld (mv_phase),a
  ld a,(mv_type)
  cp 4
  jr nz,ma_phdone
  ld a,8
  ld (mv_phase),a
ma_phdone:
  ld a,(mv_div)              ; seed the down-counter (else it free-runs from garbage)
  ld (mv_count),a
  ret

; Called on ticks where (tick % mv_div == 0): rotate the live range + upload.
; 1=CYCLE_FWD, 2=CYCLE_BACK, 3/4=wobble (rock 8 fwd / 8 back; type 4 anti-phase).
movement_step:
  ld a,(freeze)
  or a
  ret nz                     ; colour freeze: hold CRAM (skip the rotation)
  ld a,(mv_type)
  or a
  ret z                      ; STATIC
  cp 1
  jr z,ms_fwd                ; CYCLE_FWD
  cp 2
  jr z,ms_back               ; CYCLE_BACK
  ; wobble (types 3,4): rock over 8 steps -> phase bit3 picks direction
  ld a,(mv_phase)
  and 8
  jr z,ms_fwd
ms_back:
  call rot_back_one
  jr ms_done
ms_fwd:
  call rot_fwd_one
ms_done:
  ld a,(mv_phase)
  inc a
  ld (mv_phase),a
  jp cram_upload_live

; Rotate live_pal[mv_start .. +mv_len) forward by one (toward higher index).
rot_fwd_one:
  ld a,(mv_len)
  cp 2
  ret c                      ; len<2: nothing to rotate
  ld c,a                     ; length
  ld a,(mv_start)
  ld l,a
  ld h,0
  ld de,live_pal
  add hl,de                  ; HL = &live[start]
  ; save last element
  ld a,c
  dec a
  ld e,a
  ld d,0
  push hl
  add hl,de                  ; HL = &live[start+len-1]
  ld a,(hl)                  ; last value
  ld b,a
  ; shift down from top: live[i] = live[i-1]
  ld a,c
  dec a
  ld c,a                     ; c = len-1 iterations
-:
  dec hl
  ld a,(hl)
  inc hl
  ld (hl),a
  dec hl
  dec c
  jr nz,-
  ; first element = saved last
  pop hl
  ld (hl),b
  ret

; Rotate live_pal[mv_start .. +mv_len) back by one (toward lower index).
rot_back_one:
  ld a,(mv_len)
  cp 2
  ret c
  ld c,a
  ld a,(mv_start)
  ld l,a
  ld h,0
  ld de,live_pal
  add hl,de                  ; HL = &live[start]
  ld a,(hl)                  ; save first
  ld b,a
  ld a,c
  dec a
  ld c,a                     ; len-1 iterations
-:
  ld a,(hl)
  inc hl
  ld a,(hl)
  dec hl
  ld (hl),a                  ; live[i] = live[i+1]
  inc hl
  dec c
  jr nz,-
  ld (hl),b                  ; last = saved first
  ret

; ---- freeze ---------------------------------------------------------------

; Write the palette's primary colour into all 32 CRAM entries (live_pal
; untouched, so release restores). primary[cur_pal] lives in the scene header.
freeze_flatten:
  ld ix,(scene_addr)
  ld a,(cur_pal)
  ld e,a
  ld d,0
  ; primary index = *(ix + SC_PRIMARY + cur_pal)
  push ix
  pop hl
  ld bc,SC_PRIMARY
  add hl,bc
  add hl,de                  ; HL = &primary[cur_pal]
  ld a,(hl)                  ; primary CRAM index
  ; fetch the colour value from live_pal[primary]
  ld l,a
  ld h,0
  ld de,live_pal
  add hl,de
  ld a,(hl)                  ; colour value
  ; write it to all 32 CRAM entries
  ld c,a
  xor a
  out (VDP_CTRL),a
  ld a,$C0
  out (VDP_CTRL),a
  ld b,32
-:
  ld a,c
  out (VDP_DATA),a
  djnz -
  ret

; ---- DATAMOSH (effect 0x07) ----------------------------------------------

; Re-upload the scene's clean tiles to VRAM $0000 (undo the mosh).
tiles_reload:
  ld ix,(scene_addr)
  ld a,(ix+SC_TILECOUNT)
  ld l,a
  ld h,0
  add hl,hl
  add hl,hl
  add hl,hl
  add hl,hl
  add hl,hl                  ; count*32
  ld b,h
  ld c,l
  ld l,(ix+SC_OFF_TILES)
  ld h,(ix+SC_OFF_TILES+1)
  ld de,(scene_addr)
  add hl,de
  ex de,hl                   ; DE = src
  ld hl,VRAM_TILES
  call copy_to_vram
  xor a
  ld (tiles_dirty),a
  ret

; Overwrite fx_p0 random pattern bytes this tick (progressive melt to noise).
corrupt_step:
  ld a,(fx_p0)
  or a
  ret z
  ld b,a
cs_loop:
  push bc
  call lfsr_next             ; HL = lfsr
  ld a,h
  push af                    ; keep value byte
  ld a,h
  and $07
  ld h,a                     ; HL = 0..2047
  ; fold into [0, tile_bytes)
  ld de,(tile_bytes)
  ld a,h
  cp d
  jr c,cs_ok
  jr nz,cs_sub
  ld a,l
  cp e
  jr c,cs_ok
cs_sub:
  or a
  sbc hl,de
cs_ok:
  ld a,l
  out (VDP_CTRL),a
  ld a,h
  or $40
  out (VDP_CTRL),a
  pop af                     ; value byte
  out (VDP_DATA),a
  pop bc
  djnz cs_loop
  ld a,1
  ld (tiles_dirty),a
  ret

; CHURN: corrupt fx_p0 bytes, then heal fx_p1 bytes from the clean ROM tiles,
; so the pattern boils forever instead of fully dissolving.
churn_step:
  call corrupt_step          ; corrupt fx_p0 (also sets tiles_dirty)
  ld a,(fx_p1)
  or a
  ret z
  ld b,a
chn_loop:
  push bc
  call lfsr_next
  ld a,h
  and $07
  ld h,a                     ; HL = 0..2047
  ld de,(tile_bytes)         ; fold into [0, tile_bytes)
  ld a,h
  cp d
  jr c,chn_ok
  jr nz,chn_sub
  ld a,l
  cp e
  jr c,chn_ok
chn_sub:
  or a
  sbc hl,de
chn_ok:
  push hl                    ; VRAM offset
  ld de,(tiles_src)
  add hl,de                  ; ROM address of clean byte (scene's page)
  ld a,(hl)
  ld c,a                     ; clean value
  pop hl
  ld a,l
  out (VDP_CTRL),a
  ld a,h
  or $40
  out (VDP_CTRL),a
  ld a,c
  out (VDP_DATA),a
  pop bc
  djnz chn_loop
  ret

; SCRAMBLE: read fx_p0 name-table cells and toggle their flip / palette-bank
; bits (word bits 9-11 = high-byte bits 1-3), reshuffling the SAME tiles into a
; churning kaleidoscope. Non-destructive to patterns; layout_reload restores.
scramble_step:
  ld a,(fx_p0)
  or a
  ret z
  ld b,a
scr_loop:
  push bc
  call lfsr_next
  ; cell offset = (HL & $07FE), folded to < 1536, added to name table $3800
  ld a,h
  and $07
  ld h,a
  ld a,l
  and $FE
  ld l,a                     ; HL = 0..2046 even
  ld de,LAYOUT_BYTES         ; 1536
  ld a,h
  cp d
  jr c,scr_ok
  jr nz,scr_sub
  ld a,l
  cp e
  jr c,scr_ok
scr_sub:
  or a
  sbc hl,de
scr_ok:
  ld de,$3800
  add hl,de                  ; HL = cell VRAM address
  push hl
  ; --- read the word (VRAM read: high byte without $40) ---
  ld a,l
  out (VDP_CTRL),a
  ld a,h
  out (VDP_CTRL),a
  nop                        ; brief settle before reading
  in a,(VDP_DATA)
  ld e,a                     ; word low
  in a,(VDP_DATA)
  ld d,a                     ; word high
  ; toggle flip/bank bits (high byte bits 1-3) from the LFSR
  call lfsr_next
  ld a,l
  and $0E
  xor d
  ld d,a
  ; --- write the word back ---
  pop hl
  ld a,l
  out (VDP_CTRL),a
  ld a,h
  or $40
  out (VDP_CTRL),a
  ld a,e
  out (VDP_DATA),a
  ld a,d
  out (VDP_DATA),a
  pop bc
  djnz scr_loop
  ; --- SCRAMBLE++: swap fx_p1 cells to a fresh random tile (index + flip/bank) ---
  ld a,(fx_p1)
  or a
  jr z,scr_done
  ld b,a
sci_loop:
  push bc
  call lfsr_next             ; cell address
  ld a,h
  and $07
  ld h,a
  ld a,l
  and $FE
  ld l,a
  ld de,LAYOUT_BYTES
  ld a,h
  cp d
  jr c,sci_ok
  jr nz,sci_sub
  ld a,l
  cp e
  jr c,sci_ok
sci_sub:
  or a
  sbc hl,de
sci_ok:
  ld de,$3800
  add hl,de
  push hl                    ; cell address
  call lfsr_next             ; index + flip source
  ld a,l
  ld hl,mosh_mask
  and (hl)                   ; index candidate (< 2*tile_count)
  ld c,a
  ld a,(tile_count)
  ld d,a
  ld a,c
  cp d
  jr c,sci_idxok
  sub d                      ; fold into [0, tile_count)
  ld c,a
sci_idxok:
  ld a,h
  and $0E                    ; random flip/bank bits (word bits 9-11)
  ld d,a                     ; word high (index bit 8 = 0)
  ld e,c                     ; word low = index
  pop hl                     ; cell address
  ld a,l
  out (VDP_CTRL),a
  ld a,h
  or $40
  out (VDP_CTRL),a
  ld a,e
  out (VDP_DATA),a
  ld a,d
  out (VDP_DATA),a
  pop bc
  djnz sci_loop
scr_done:
  ld a,1
  ld (layout_dirty),a
  ret

; SMEAR: copy fx_p0 random name-table cells to a neighbour (offset fx_p1 cells),
; dragging the pattern in a direction -> datamosh streaking. Reversible.
smear_step:
  ld a,(fx_p0)
  or a
  ret z
  ld b,a
sme_loop:
  push bc
  call lfsr_next             ; source cell address
  ld a,h
  and $07
  ld h,a
  ld a,l
  and $FE
  ld l,a
  ld de,LAYOUT_BYTES
  ld a,h
  cp d
  jr c,sme_ok
  jr nz,sme_sub
  ld a,l
  cp e
  jr c,sme_ok
sme_sub:
  or a
  sbc hl,de
sme_ok:
  ld de,$3800
  add hl,de                  ; HL = source cell address
  ; read source word -> DE
  ld a,l
  out (VDP_CTRL),a
  ld a,h
  out (VDP_CTRL),a
  nop
  in a,(VDP_DATA)
  ld e,a
  in a,(VDP_DATA)
  ld d,a
  ; dest = source + fx_p1 cells (*2 bytes), wrapped into the name table
  ld a,(fx_p1)
  add a,a
  ld c,a
  ld b,0
  add hl,bc
  ld a,h
  cp $3E                     ; >= $3E00 -> past the 1536-byte table
  jr c,sme_wrok
  ld bc,LAYOUT_BYTES
  or a
  sbc hl,bc
sme_wrok:
  ld a,l
  out (VDP_CTRL),a
  ld a,h
  or $40
  out (VDP_CTRL),a
  ld a,e
  out (VDP_DATA),a
  ld a,d
  out (VDP_DATA),a
  pop bc
  djnz sme_loop
  ld a,1
  ld (layout_dirty),a
  ret

; MORPH: drift fx_p0 name-table cells' tile index by +1 (wrapping tile_count),
; so shapes melt into adjacent shapes. Non-destructive (layout_reload restores).
morph_step:
  ld a,(fx_p0)
  or a
  ret z
  ld b,a
mph_loop:
  push bc
  call lfsr_next
  ld a,h
  and $07
  ld h,a
  ld a,l
  and $FE
  ld l,a
  ld de,LAYOUT_BYTES
  ld a,h
  cp d
  jr c,mph_ok
  jr nz,mph_sub
  ld a,l
  cp e
  jr c,mph_ok
mph_sub:
  or a
  sbc hl,de
mph_ok:
  ld de,$3800
  add hl,de
  push hl
  ld a,l
  out (VDP_CTRL),a
  ld a,h
  out (VDP_CTRL),a
  nop
  in a,(VDP_DATA)
  ld e,a                     ; word low (tile index, <256)
  in a,(VDP_DATA)
  ld d,a                     ; word high (flip/bank)
  ld a,e
  inc a                      ; index + 1
  ld hl,tile_count
  cp (hl)
  jr c,mph_setidx
  xor a                      ; wrap to 0
mph_setidx:
  ld e,a
  pop hl
  ld a,l
  out (VDP_CTRL),a
  ld a,h
  or $40
  out (VDP_CTRL),a
  ld a,e
  out (VDP_DATA),a
  ld a,d
  out (VDP_DATA),a
  pop bc
  djnz mph_loop
  ld a,1
  ld (layout_dirty),a
  ret

; XOR: bit-flip fx_p0 pattern bytes with LFSR values (colour/edge inversions).
xor_step:
  ld a,(fx_p0)
  or a
  ret z
  ld b,a
xor_loop:
  push bc
  call lfsr_next
  ld a,h
  and $07
  ld h,a
  ld de,(tile_bytes)
  ld a,h
  cp d
  jr c,xor_ok
  jr nz,xor_sub
  ld a,l
  cp e
  jr c,xor_ok
xor_sub:
  or a
  sbc hl,de
xor_ok:
  push hl
  ld a,l
  out (VDP_CTRL),a
  ld a,h
  out (VDP_CTRL),a
  nop
  in a,(VDP_DATA)
  ld c,a                     ; current byte
  call lfsr_next
  ld a,h
  xor c                      ; flip bits
  ld c,a
  pop hl
  ld a,l
  out (VDP_CTRL),a
  ld a,h
  or $40
  out (VDP_CTRL),a
  ld a,c
  out (VDP_DATA),a
  pop bc
  djnz xor_loop
  ld a,1
  ld (tiles_dirty),a
  ret

; STAMP: copy fx_p0 clean ROM tiles over random tiles in VRAM, so the tile set
; collapses toward fewer shapes. Reversible (tiles_reload).
stamp_step:
  ld a,(fx_p0)
  or a
  ret z
  ld b,a
stm_loop:
  push bc
  call lfsr_next             ; source tile index
  ld a,l
  ld hl,mosh_mask
  and (hl)
  ld hl,tile_count
  cp (hl)
  jr c,stm_srcok
  sub (hl)
stm_srcok:
  ld l,a
  ld h,0
  add hl,hl
  add hl,hl
  add hl,hl
  add hl,hl
  add hl,hl                  ; src*32
  ld de,(tiles_src)
  add hl,de
  ld (tmp_ptr),hl            ; clean source in ROM
  call lfsr_next             ; dest tile index
  ld a,l
  ld hl,mosh_mask
  and (hl)
  ld hl,tile_count
  cp (hl)
  jr c,stm_dstok
  sub (hl)
stm_dstok:
  ld l,a
  ld h,0
  add hl,hl
  add hl,hl
  add hl,hl
  add hl,hl
  add hl,hl                  ; dest*32 (VRAM pattern offset)
  ld a,l
  out (VDP_CTRL),a
  ld a,h
  or $40
  out (VDP_CTRL),a
  ld hl,(tmp_ptr)
  ld c,32
stm_copy:
  ld a,(hl)
  out (VDP_DATA),a
  inc hl
  dec c
  jr nz,stm_copy
  pop bc
  djnz stm_loop
  ld a,1
  ld (tiles_dirty),a
  ret

; Dispatch the active corruption effect's per-tick step (also used as a beat kick).
mosh_step:
  ld a,(fx_type)
  cp 7
  jr z,ms_melt
  cp 8
  jr z,ms_scr
  cp 9
  jr z,ms_chn
  cp 10
  jr z,ms_sme
  cp 11
  jr z,ms_mph
  cp 12
  jr z,ms_xor
  cp 13
  jr z,ms_stm
  ret
ms_melt:
  jp corrupt_step
ms_scr:
  jp scramble_step
ms_chn:
  jp churn_step
ms_sme:
  jp smear_step
ms_mph:
  jp morph_step
ms_xor:
  jp xor_step
ms_stm:
  jp stamp_step

; 16-bit Galois LFSR (taps $B400), advanced once.
lfsr_next:
  ld hl,(lfsr)
  srl h
  rr l
  jr nc,+
  ld a,h
  xor $B4
  ld h,a
+:
  ld (lfsr),hl
  ret
.ENDS
