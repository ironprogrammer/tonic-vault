# Native builds of libpo32's example tools, plus diag, for the Phase 0 device tests.
# cmake isn't required; clang is called directly.

CC := /usr/bin/clang
CFLAGS := -std=c99 -O2 -Wall -Wextra
LIB := ../vendor/libpo32/core
SRC := $(wildcard $(LIB)/src/*.c)
BIN := build

TOOLS := po32_decode_capture po32_demo po32_pattern_editor

all: $(addprefix $(BIN)/,$(TOOLS)) $(BIN)/diag $(BIN)/frame

$(BIN)/%: $(LIB)/examples/%.c $(SRC) | $(BIN)
	$(CC) $(CFLAGS) -I$(LIB)/include -I$(LIB)/src $< $(SRC) -lm -o $@

$(BIN)/%: %.c $(SRC) | $(BIN)
	$(CC) $(CFLAGS) -I$(LIB)/include -I$(LIB)/src $< $(SRC) -lm -o $@

$(BIN):
	mkdir -p $@

clean:
	rm -rf $(BIN)

.PHONY: all clean
