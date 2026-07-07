; ---------------------------------------------------------------------------
; .svjb parsing + scene load + the live palette/effect/movement pipeline.
; The ROM stays "dumb": it copies finished tiles/name-tables and mutates CRAM.
; ---------------------------------------------------------------------------
.SECTION "scene" FREE

; Parse the bank header, set timing, load the boot scene, apply boot fx/mv.
bank_init:
  ld a,(bank_data+BANK_REGION)
  ld (region),a
  ld a,(bank_data+BANK_BPM)
  ld (bpm),a
  ld a,(bank_data+BANK_BOOTSCENE)   ; boot scene 0-15
  ld c,a
  and 3
  ld (cur_scene),a
  ld (pend_scene),a
  ld a,c
  srl a
  srl a                             ; boot >> 2 = bank
  and 3
  ld (cur_bank),a
  ld (pend_bank),a
  ld a,(bank_data+BANK_BOOTPAL)
  ld (cur_pal),a
  ld (pend_pal),a
  ld a,(bank_data+BANK_BOOTFX)
  ld (cur_fx),a
  ld (pend_fx),a
  ld a,(bank_data+BANK_BOOTMV)
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
  call clock_compute_fpt
  call scene_resolve
  call scene_load
  call movement_apply
  call recompose
  ret

; effective index (cur_bank*4 + cur_scene) -> scene_addr via scene_ptr[].
scene_resolve:
  ld a,(cur_bank)
  add a,a
  add a,a                    ; bank*4
  ld b,a
  ld a,(cur_scene)
  add a,b                    ; effective index 0-15
  ; clamp to scene_count-1 (banks beyond what's embedded fall back)
  ld c,a
  ld a,(bank_data+BANK_SCENECOUNT)
  dec a                      ; max valid index
  cp c
  jr nc,+
  ld c,a                     ; clamp
+:
  ld a,c
  add a,a                    ; *2 (word offset)
  ld e,a
  ld d,0
  ld hl,bank_data+BANK_SCENEPTR
  add hl,de
  ld e,(hl)
  inc hl
  ld d,(hl)                  ; DE = bank-relative scene pointer
  ld hl,bank_data
  add hl,de
  ld (scene_addr),hl
  ret

; Upload the current scene: tiles -> $0000, each layout variant -> its 2 KB
; slot, and the current palette into the live shadow + CRAM.
scene_load:
  ld ix,(scene_addr)
  ; --- tiles ---  length = tile_count * 32
  ld a,(ix+SC_TILECOUNT)
  ld l,a
  ld h,0
  add hl,hl
  add hl,hl
  add hl,hl
  add hl,hl
  add hl,hl                  ; HL = count*32
  ld b,h
  ld c,l                     ; BC = length
  ld l,(ix+SC_OFF_TILES)
  ld h,(ix+SC_OFF_TILES+1)
  ld de,(scene_addr)
  add hl,de
  ex de,hl                   ; DE = src
  ld hl,VRAM_TILES
  call copy_to_vram
  ; --- layouts ---
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
  ret

; ---- palette / live pipeline ---------------------------------------------

; DE <- address of scene palette cur_pal (scene_addr + off_palettes + pal*32).
pal_src:
  ld ix,(scene_addr)
  ld l,(ix+SC_OFF_PALETTES)
  ld h,(ix+SC_OFF_PALETTES+1)
  ld de,(scene_addr)
  add hl,de                  ; HL = palettes base
  ld a,(cur_pal)
  add a,a
  add a,a
  add a,a
  add a,a
  add a,a                    ; pal*32 (<=96, fits 8-bit)
  ld e,a
  ld d,0
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
  ; display on (BLANK will turn it back off if selected)
  ld a,$E0
  ld b,$81
  call vdp_reg
  call palette_reload_live
  call read_effect_record
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
  xor a
  ld (mv_phase),a
  ld a,(mv_div)              ; seed the down-counter (else it free-runs from garbage)
  ld (mv_count),a
  ret

; Called on ticks where (tick % mv_div == 0): rotate the live range + upload.
; Direction: CYCLE_FWD(1) fwd, CYCLE_BACK(2) back, PINGPONG(3) triangle.
movement_step:
  ld a,(mv_type)
  or a
  ret z                      ; STATIC
  cp 1
  jr z,ms_fwd                ; CYCLE_FWD
  cp 2
  jr z,ms_back               ; CYCLE_BACK
  ; PINGPONG: alternate direction by phase bit0
  ld a,(mv_phase)
  and 1
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
.ENDS
