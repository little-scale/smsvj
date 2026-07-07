; ---------------------------------------------------------------------------
; SMSVJ ROM — hardware constants, memory map, SMS header, RAM variables.
; Single 32 KB ROM: the whole image sits in $0000-$7FFF (mapper defaults), so
; the embedded .svjb bank is addressed linearly with no paging.
; ---------------------------------------------------------------------------

.MEMORYMAP
DEFAULTSLOT 0
SLOTSIZE $8000
SLOT 0 $0000
.ENDME

.ROMBANKMAP
BANKSTOTAL 1
BANKSIZE $8000
BANKS 1
.ENDRO

.SMSTAG                 ; SEGA "TMR SEGA" header at $7FF0
.COMPUTESMSCHECKSUM     ; wlalink patches the checksum

; ---- VDP / IO ports -------------------------------------------------------
.DEFINE VDP_DATA    $BE
.DEFINE VDP_CTRL    $BF
.DEFINE PORT_PAD1   $DC     ; controller 1: bits active-low
.DEFINE PSG_PORT    $7F

; controller 1 bit masks (as read: 0 = pressed; we invert to 1 = pressed)
.DEFINE PAD_UP      %00000001
.DEFINE PAD_DOWN    %00000010
.DEFINE PAD_LEFT    %00000100
.DEFINE PAD_RIGHT   %00001000
.DEFINE PAD_B1      %00010000   ; TL trigger
.DEFINE PAD_B2      %00100000   ; TR trigger

; ---- VRAM layout ----------------------------------------------------------
; tiles $0000-$1EFF (up to 248 patterns), SAT $3F00, four 2 KB layout slots at
; $3800/$3000/$2800/$2000 selected by VDP register 2.
.DEFINE VRAM_TILES  $0000
.DEFINE VRAM_SAT    $3F00
.DEFINE LAYOUT_BYTES 1536

; ---- .svjb field offsets (see SCENE_FORMAT.md) ----------------------------
.DEFINE BANK_REGION     5
.DEFINE BANK_BPM        7
.DEFINE BANK_BOOTSCENE  8
.DEFINE BANK_BOOTPAL    9
.DEFINE BANK_BOOTFX     10
.DEFINE BANK_BOOTMV     11
.DEFINE BANK_SCENEPTR   12
.DEFINE SC_TILECOUNT    0
.DEFINE SC_LAYOUTCOUNT  1
.DEFINE SC_OFF_TILES    4
.DEFINE SC_OFF_LAYOUTS  6
.DEFINE SC_OFF_PALETTES 8
.DEFINE SC_OFF_EFFECTS  10
.DEFINE SC_OFF_MOVES    12
.DEFINE SC_PRIMARY      16      ; primary[4]

; ---- RAM variables ($C000-$DFFF) -----------------------------------------
.ENUM $C000
frame_ready     db          ; set by the frame interrupt, cleared each loop
tick_lo         db          ; 16-bit tick counter
tick_hi         db
acc_lo          db          ; 8.8 fixed frame->tick accumulator
acc_hi          db
fpt_lo          db          ; frames-per-tick, 8.8 fixed
fpt_hi          db
bpm             db          ; current INT tempo (tempo-nudge adjusts it)
region          db          ; bit0: 1 = 50 Hz

cur_scene       db
cur_pal         db
cur_fx          db
cur_mv          db
pend_scene      db
pend_pal        db
pend_fx         db
pend_mv         db

prev_pad        db          ; last frame's pad state (for edge detect)
b2_mod          db          ; a modifier fired during the current B2 hold
overlay         db          ; overlay visible flag
freeze          db          ; freeze-to-primary active

scene_addr      dw          ; base of the current scene in ROM
layout_count    db          ; layouts baked into the current scene
mv_phase        db          ; movement rotation phase (steps)
mv_type         db          ; active movement type
mv_div          db          ; active movement division (ticks/step)
mv_start        db          ; active movement CRAM range start
mv_len          db          ; active movement CRAM range length
mv_count        db          ; ticks-until-next movement step (down-counter)
tmp_ptr         dw          ; scratch pointer (block copies)
fx_type         db          ; decoded active effect record
fx_p0           db
fx_p1           db
fx_p2           db
live_pal        dsb 32      ; live 32-entry CRAM shadow (CRAM isn't readable)
.ENDE
