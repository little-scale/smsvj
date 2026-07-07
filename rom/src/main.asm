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
  retn                        ; pause button: ignored
.ENDS

; ---- boot + main loop -----------------------------------------------------
.SECTION "main" FREE
boot:
  ld sp,$DFF0
  call vdp_init               ; registers (screen off), clear VRAM/CRAM
  call bank_init              ; parse header, timing, load boot scene
  ; enable display + frame interrupt (reg1 = %11100000)
  ld a,$E0
  ld b,$81
  call vdp_reg
main_loop:
  ei
  halt                        ; wait for VBlank
  xor a
  ld (frame_ready),a
  call read_input             ; controller 1 -> pending nudges (capture-instant)
  call clock_update           ; advance accumulator -> ticks, latch on boundaries
  jp main_loop
.ENDS

.INCLUDE "vdp.asm"
.INCLUDE "clock.asm"
.INCLUDE "input.asm"
.INCLUDE "scene.asm"

; ---- embedded scene bank --------------------------------------------------
.SECTION "bankdata" FREE
bank_data:
.INCBIN "assets/look.svjb"
.ENDS
