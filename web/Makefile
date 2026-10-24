# Builds libpo32 plus the glue in po32_wasm.c into a standalone po32.wasm (no Emscripten, no JS glue).
# Needs Homebrew's llvm and lld by default, since Apple's clang has no WebAssembly target. Override CLANG and WASM_LD elsewhere.

CLANG ?= /opt/homebrew/opt/llvm/bin/clang
WASM_LD ?= /opt/homebrew/opt/lld/bin/wasm-ld
LIB := ../vendor/libpo32/core
SRC := $(wildcard $(LIB)/src/*.c)

po32.wasm: po32_wasm.c $(SRC)
	$(CLANG) --target=wasm32 -std=c99 -O2 -Wall -Wextra -nostdlib -ffreestanding \
		-fuse-ld=$(WASM_LD) -Wl,--no-entry -Wl,--strip-all \
		-I$(LIB)/include -I$(LIB)/src po32_wasm.c $(SRC) -o $@

test: po32.wasm
	node --test test/

clean:
	rm -f po32.wasm

.PHONY: test clean
