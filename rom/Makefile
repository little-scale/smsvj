# SMSVJ ROM build (WLA-DX). Mirrors the sibling tracker's toolchain.
ROM     := smsvj.sms
MAIN    := src/main.asm
OBJ     := build/main.o
LINK    := build/link.tmp
SRCS    := $(wildcard src/*.asm src/*.inc)
ASSET   := assets/look.svjb

all: $(ROM)

# Regenerate the embedded scene bank from the browser emitter.
# ROM_SCENES = scenes embedded in the paged 96 KB ROM (4 banks of 4 = 16).
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
