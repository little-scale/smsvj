# SMSVJ ROM build (WLA-DX). Mirrors the sibling tracker's toolchain.
ROM     := smsvj.sms
MAIN    := src/main.asm
OBJ     := build/main.o
LINK    := build/link.tmp
SRCS    := $(wildcard src/*.asm src/*.inc)
ASSET   := assets/look.svjb
FONT    := assets/font.bin
BUILDINC:= build/buildid.inc

# Version tag from str_version ("V0.1" -> v0_1) and a build stamp = short git
# hash (uppercased, so hex A-F is in the font; + if the tree is dirty).
VTAG    := $(shell sed -n 's/^str_version:.*"\([^"]*\)".*/\1/p' src/main.asm | tr -d ' ' | tr '.' '_' | tr 'A-Z' 'a-z')
BUILDID := $(shell h=$$(git rev-parse --short HEAD 2>/dev/null || echo NOGIT); git diff-index --quiet HEAD -- 2>/dev/null || h="$$h+"; printf '%s' "$$h" | tr 'a-z' 'A-Z')
VROM    := build/smsvj_$(VTAG)_$(BUILDID).sms

all: $(ROM)

# On-screen text font (ASCII $20-$5F as Mode 4 tiles).
$(FONT):
	python3 ../tools/makefont.py $@

# Build stamp -> str_buildid, shown at boot. Recomputed every build, only
# rewritten (forcing a relink) when it changes.
$(BUILDINC): FORCE
	@mkdir -p build
	@printf '.BANK 0 SLOT 0\n.SECTION "BuildID" FREE\nstr_buildid: .db "%s", 0\n.ENDS\n' '$(BUILDID)' > $@.tmp
	@cmp -s $@.tmp $@ 2>/dev/null || mv -f $@.tmp $@
	@rm -f $@.tmp
FORCE:

# A versioned, hash-stamped copy for distribution (a stale flash is obvious).
vrom: $(VROM)
$(VROM): $(ROM)
	cp -f $< $@
	@echo "-> $@"

# Regenerate the embedded scene bank from the browser emitter.
# ROM_SCENES = scenes embedded in the paged 96 KB ROM (4 banks of 4 = 16).
ROM_SCENES ?= 16

$(ASSET):
	node ../tool/export-bank.js $@ $(ROM_SCENES)

$(ROM): $(MAIN) $(SRCS) $(ASSET) $(FONT) $(BUILDINC)
	@mkdir -p build
	wla-z80 -I src -I build -o $(OBJ) $(MAIN)
	@printf '[objects]\n$(OBJ)\n' > $(LINK)
	wlalink $(LINK) $(ROM)

# Force a fresh bank export (e.g. after editing the look-patcher).
bank:
	node ../tool/export-bank.js $(ASSET) $(ROM_SCENES)

# Import a .svjb exported from the browser look-patcher into the ROM.
#   make import FILE=~/Downloads/look.svjb
# Routes through repage.js, so it works for both the current (page-aligned) exports
# and older compact ones. Follow with `make` to rebuild.
import:
	@test -n "$(FILE)" || { echo "usage: make import FILE=<path to .svjb>"; exit 1; }
	node ../tool/repage.js "$(FILE)" $(ASSET)

clean:
	rm -rf build $(ROM)

.PHONY: all bank import vrom clean FORCE
