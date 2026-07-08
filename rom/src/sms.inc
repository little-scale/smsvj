; ---------------------------------------------------------------------------
; SMSVJ ROM — hardware constants, memory map, SMS header, RAM variables.
; 96 KB paged ROM. Code + SMS header live in banks 0/1 ($0000-$7FFF, always
; mapped). The .svjb bank data is paged through slot 2 ($8000-$BFFF): banks
; 2..5 hold four 16 KB "pages", selected by writing $FFFF. The emitter aligns
; every scene inside a single page, so a scene is read with one page-in.
; ---------------------------------------------------------------------------

.MEMORYMAP
DEFAULTSLOT 0
SLOTSIZE $4000
SLOT 0 $0000
SLOT 1 $4000
SLOT 2 $8000
.ENDME

.ROMBANKMAP
BANKSTOTAL 6
BANKSIZE $4000
BANKS 6
.ENDRO

.DEFINE SLOT2_CTRL  $FFFF     ; mapper register: ROM bank -> slot 2
.DEFINE DATA_BANK0  2         ; first data page (holds the bank header)
.DEFINE BANKHDR     $8000     ; slot 2 base = start of the paged-in page

.SMSTAG                 ; SEGA "TMR SEGA" header at $7FF0
.COMPUTESMSCHECKSUM     ; wlalink patches the checksum

; ---- VDP / IO ports -------------------------------------------------------
.DEFINE VDP_DATA    $BE
.DEFINE VDP_CTRL    $BF

; ---- sync + on-screen text ------------------------------------------------
.DEFINE SYNC_OFF    0         ; internal clock
.DEFINE SYNC_IN     1         ; follow an SMSGGDJ SYNC OUT (÷1)
.DEFINE SYNC_IN24   2         ; follow a 24-PPQN sender (ESP32 clock, ÷6)
.DEFINE SYNC_MODES  3
.DEFINE FONT_VTILE  $1800     ; font -> VRAM tile $C0; sprite tile = char + $A0
.DEFINE FONT_TILEBASE $A0     ; sprite tile number = ASCII char + this ($20 -> $C0)
.DEFINE TEXT_FRAMES 120       ; ~2 s overlay @60Hz
.DEFINE TEXT_Y      20        ; overlay sprite row (near the top)
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
.DEFINE BANK_SCENECOUNT 6
.DEFINE BANK_BPM        7
.DEFINE BANK_BOOTSCENE  8
.DEFINE BANK_BOOTPAL    9
.DEFINE BANK_BOOTFX     10
.DEFINE BANK_BOOTMV     11
.DEFINE BANK_SCENEPTR   12      ; scene_ptr[16] (4 banks x 4)
.DEFINE SC_TILECOUNT    0
.DEFINE SC_LAYOUTCOUNT  1
.DEFINE SC_OFF_TILES    4
.DEFINE SC_OFF_LAYOUTS  6
.DEFINE SC_OFF_PALETTES 8
.DEFINE SC_OFF_EFFECTS  10
.DEFINE SC_OFF_MOVES    12
.DEFINE SC_PRIMARY      16      ; primary[16] (PREFIX = 16 + 16 = 32)

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

cur_scene       db          ; slot within bank (0-3)
cur_bank        db          ; scene bank (0-3); effective index = bank*4 + scene
cur_pal         db
cur_fx          db
cur_mv          db
pend_scene      db
pend_bank       db
pend_pal        db
pend_fx         db
pend_mv         db

prev_pad        db          ; last frame's pad state (for edge detect)
b2_mod          db          ; a modifier fired during the current B2 hold
beat_flash      db          ; beat-flash indicator on/off (B2 tap; default off)
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
lfsr            dw          ; 16-bit LFSR for the corruption effects
tile_bytes      dw          ; current scene tile_count * 32 (mosh range)
tiles_src       dw          ; ROM address of the scene's clean tiles (for CHURN heal)
tile_count      db          ; current scene tile count (SCRAMBLE index range)
mosh_mask       db          ; (2^n)-1 covering tile_count (random-index masking)
tiles_dirty     db          ; VRAM pattern data has been corrupted (MELT/CHURN)
layout_dirty    db          ; VRAM name table has been scrambled (SCRAMBLE/SMEAR)
mosh_speed      db          ; corruption speed 0-15 -> fires every (16-speed) ticks
mosh_tickcnt    db          ; ticks until the next corruption step (down-counter)
fx_type         db          ; decoded active effect record
fx_p0           db
fx_p1           db
fx_p2           db
sync_mode       db          ; SYNC OFF / IN / IN24 (cycled by the Pause button)
sync_last       db          ; 2-bit counter value read last frame
sync_acc6       db          ; IN24: received clocks accumulated toward a tick (÷6)
sync_flash      db          ; border-flash countdown on a sync beat
text_timer      db          ; version / sync-mode overlay countdown (frames)
sync_pending    db          ; NMI -> main: sync mode changed, draw the overlay
boot_stage      db          ; boot text sequence: 0 version -> 1 build id -> 2 done
live_pal        dsb 32      ; live 32-entry CRAM shadow (CRAM isn't readable)
.ENDE
