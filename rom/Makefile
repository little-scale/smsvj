# SMSVJ ROM build (WLA-DX). Mirrors the sibling tracker's toolchain.
ROM     := smsvj.sms
MAIN    := src/main.asm
OBJ     := build/main.o
LINK    := build/link.tmp
SRCS    := $(wildcard src/*.asm src/*.inc)
ASSET   := assets/look.svjb

all: $(ROM)

# Regenerate the embedded scene bank from the browser emitter.
# ROM_SCENES caps the embedded scenes to what fits a 32 KB ROM (2 banks of 4)
# until ROM paging lands; the browser tool always uses the full 16.
ROM_SCENES ?= 8

$(ASSET):
	node ../tool/export-bank.js $@ $(ROM_SCENES)

$(ROM): $(MAIN) $(SRCS) $(ASSET)
	@mkdir -p build
	wla-z80 -I src -o $(OBJ) $(MAIN)
	@printf '[objects]\n$(OBJ)\n' > $(LINK)
	wlalink $(LINK) $(ROM)

# Force a fresh bank export (e.g. after editing the look-patcher).
bank:
	node ../tool/export-bank.js $(ASSET) $(ROM_SCENES)

clean:
	rm -rf build $(ROM)

.PHONY: all bank clean
