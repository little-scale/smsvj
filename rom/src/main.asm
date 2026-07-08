; ===========================================================================
; SMSVJ — ROM runtime. Boot, interrupt vectors, and the per-frame main loop.
; Build order step 2: INT clock + arm/latch quantise core + controller-1 pad
; grammar, reading the embedded .svjb bank. Rendering is the minimal bring-up
; needed to display a scene and prove the live axes.
; ===========================================================================
.INCLUDE "sms.inc"

; ---- reset / interrupt vectors -------------------------------------------
.BANK 0 SLOT 0
.ORG $0000
.SECTION "reset" FORCE
  di
  im 1
  jp boot
.ENDS

.ORG $0038
.SECTION "irq" FORCE
  push af
  in a,(VDP_CTRL)             ; read status -> acknowledge frame interrupt
  ld a,1
  ld (frame_ready),a
  pop af
  ei
  reti
.ENDS

.ORG $0066
.SECTION "nmi" FORCE
  ; Pause button cycles the sync source: OFF -> IN -> IN24 -> OFF. Re-seeds the
  ; counter so switching into a slave mode doesn't burst a stale delta, and flags
  ; the main loop to draw the SYNC overlay.
  push af
  push bc
  ld a,(sync_mode)
  inc a
  cp SYNC_MODES
  jr c,nmi_set
  xor a
nmi_set:
  ld (sync_mode),a
  call sync_read              ; latch the current counter as the new baseline
  ld a,b
  ld (sync_last),a
  xor a
  ld (sync_acc6),a
  inc a
  ld (sync_pending),a         ; main loop shows the mode
  pop bc
  pop af
  retn
.ENDS

; ---- boot + main loop -----------------------------------------------------
.SECTION "main" FREE
boot:
  ld sp,$DFF0
  ; mapper init: control=0, slots 0/1/2 -> banks 0/1/2
  xor a
  ld ($FFFC),a
  ld ($FFFD),a
  ld a,1
  ld ($FFFE),a
  ld a,DATA_BANK0
  ld (SLOT2_CTRL),a
  call vdp_init               ; registers (screen off), clear VRAM/CRAM
  call load_font              ; text font -> VRAM tile $C0
  call bank_init              ; parse header, timing, load boot scene
  ; enable display + frame interrupt (reg1 = %11100000)
  ld a,$E0
  ld b,$81
  call vdp_reg
  ; boot text: version for ~2 s, then the build id for ~2 s
  xor a
  ld (boot_stage),a
  ld hl,str_version
  call text_draw
  ld a,TEXT_FRAMES
  ld (text_timer),a
main_loop:
  ei
  halt                        ; wait for VBlank
  xor a
  ld (frame_ready),a
  call read_input             ; controller 1 -> pending nudges (capture-instant)
  call clock_frame            ; SYNC IN if present, else INT -> ticks + latches
  ; SYNC IN indicator: flash the border (CRAM entry 16) white for a few frames on
  ; each received clock, so a hardware sync feed is visible at a glance.
  ld a,(sync_flash)
  or a
  jr z,ml_noflash
  dec a
  ld (sync_flash),a
  jr nz,ml_flashon
  xor a                       ; countdown done: restore backdrop (black)
  jr ml_flashset
ml_flashon:
  ld a,$3F                    ; white
ml_flashset:
  push af
  ld a,16
  out ($BF),a
  ld a,$C0
  out ($BF),a                 ; VDP addr = CRAM index 16 (write)
  pop af
  out ($BE),a
ml_noflash:
  ; sync mode changed by the Pause button? draw the SYNC overlay
  ld a,(sync_pending)
  or a
  jr z,ml_notext
  xor a
  ld (sync_pending),a
  call show_sync_text
ml_notext:
  ; text overlay timer: hold the glyphs' ink white while showing, hide at 0
  ld a,(text_timer)
  or a
  jr z,ml_nooverlay
  dec a
  ld (text_timer),a
  ld a,$3F
  call set_text_ink           ; CRAM 17 = white so the text reads over any palette
  ld a,(text_timer)
  or a
  jr nz,ml_nooverlay          ; still showing
  ; timer hit 0: advance the boot sequence (version -> build id), else hide
  ld a,(boot_stage)
  cp 2
  jr nc,ml_texthide           ; boot done (or a sync overlay): hide
  inc a
  ld (boot_stage),a
  cp 2
  jr z,ml_texthide            ; was showing the build id: done
  ld hl,str_buildid           ; version done -> show the build id
  call text_draw
  ld a,TEXT_FRAMES
  ld (text_timer),a
  jr ml_nooverlay
ml_texthide:
  call text_hide
ml_nooverlay:
  ; per-frame corruption (B1+left/right = speed). speed_rate is in 1/8-frame
  ; units; accumulate and run floor(acc/8) passes, keeping the remainder so slow
  ; speeds fire only every few frames.
  ld a,(mosh_speed)
  ld e,a
  ld d,0
  ld hl,speed_rate
  add hl,de
  ld a,(hl)                   ; rate (<=248)
  ld hl,mosh_acc
  add a,(hl)                  ; acc + rate (no 8-bit overflow: acc<8)
  ld b,a
  and 7
  ld (hl),a                   ; new fractional remainder
  ld a,b
  srl a
  srl a
  srl a                       ; passes = (acc + rate) >> 3
  ld b,a
  or a
  jr z,ml_done                ; nothing this frame
ml_run:
  push bc
  call mosh_step
  pop bc
  djnz ml_run
ml_done:
  jp main_loop

speed_rate:
.db 1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128, 160, 192, 224, 240, 248

; Draw the current sync mode overlay ("SYNC OFF/IN/24") for TEXT_FRAMES.
show_sync_text:
  ld a,(sync_mode)
  cp SYNC_IN
  jr z,sst_in
  cp SYNC_IN24
  jr z,sst_in24
  ld hl,str_sync_off
  jr sst_draw
sst_in:
  ld hl,str_sync_in
  jr sst_draw
sst_in24:
  ld hl,str_sync_in24
sst_draw:
  call text_draw
  ld a,TEXT_FRAMES
  ld (text_timer),a
  ld a,2
  ld (boot_stage),a           ; a sync overlay ends the boot version/id sequence
  ret

str_version:   .db "V0.1",0
str_sync_off:  .db "SYNC OFF",0
str_sync_in:   .db "SYNC IN",0
str_sync_in24: .db "SYNC 24",0

; text font (64 Mode-4 tiles) -> VRAM tile $C0 by load_font
font_data:
.INCBIN "assets/font.bin"
.ENDS

.INCLUDE "vdp.asm"
.INCLUDE "clock.asm"
.INCLUDE "input.asm"
.INCLUDE "scene.asm"
.INCLUDE "buildid.inc"    ; generated: str_buildid = short git hash

; ---- embedded scene bank (four 16 KB pages -> ROM banks 2..5) --------------
.BANK 2 SLOT 2
.ORG $0000
.SECTION "page0" FORCE
.INCBIN "assets/look.svjb" SKIP $0000 READ $4000
.ENDS
.BANK 3 SLOT 2
.ORG $0000
.SECTION "page1" FORCE
.INCBIN "assets/look.svjb" SKIP $4000 READ $4000
.ENDS
.BANK 4 SLOT 2
.ORG $0000
.SECTION "page2" FORCE
.INCBIN "assets/look.svjb" SKIP $8000 READ $4000
.ENDS
.BANK 5 SLOT 2
.ORG $0000
.SECTION "page3" FORCE
.INCBIN "assets/look.svjb" SKIP $C000 READ $4000
.ENDS
