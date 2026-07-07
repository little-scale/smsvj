# SMSVJ ROM build (WLA-DX). Mirrors the sibling tracker's toolchain.
ROM     := smsvj.sms
MAIN    := src/main.asm
OBJ     := build/main.o
LINK    := build/link.tmp
SRCS    := $(wildcard src/*.asm src/*.inc)
ASSET   := assets/look.svjb

all: $(ROM)

# Regenerate the embedded scene bank from the browser emitter.
$(ASSET):
	node ../tool/export-bank.js $@

$(ROM): $(MAIN) $(SRCS) $(ASSET)
	@mkdir -p build
	wla-z80 -I src -o $(OBJ) $(MAIN)
	@printf '[objects]\n$(OBJ)\n' > $(LINK)
	wlalink $(LINK) $(ROM)

# Force a fresh bank export (e.g. after editing the look-patcher).
bank:
	node ../tool/export-bank.js $(ASSET)

clean:
	rm -rf build $(ROM)

.PHONY: all bank clean
