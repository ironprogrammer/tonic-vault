/*
 * Build a transfer frame from raw packet payloads and write it as 48 kHz f32 audio to stdout.
 * Usage: frame <tag-hex>:<payload.bin> ... | sox -t f32 -r 48000 -c 1 - out.wav
 * Payload files are the payload.bin dumps from po32_decode_capture, so captured packets can be resent as-is.
 * frame --raw <frame.bin> renders a whole captured frame byte for byte instead.
 * PAD=<bytes> lengthens the preamble; the Tonic's own is about 128 bytes longer than libpo32's.
 * TRAIL=<bytes> (default 4) keeps the carrier going after the final tail, as the Tonic does (about 25 ms).
 * Without it the Tonic shows err at the end of every transfer.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "po32.h"

int main(int argc, char **argv) {
	static uint8_t frame[65536];
	po32_builder_t b;
	size_t len = 0, pad = getenv("PAD") ? (size_t)atol(getenv("PAD")) : 0;
	if (argc < 2) {
		fputs("usage: frame <tag-hex>:<payload.bin> ...\n", stderr);
		return 2;
	}
	if (argc == 3 && strcmp(argv[1], "--raw") == 0) {
		FILE *f = fopen(argv[2], "rb");
		if (!f) return 1;
		len = fread(frame, 1, sizeof frame, f);
		fclose(f);
		pad = 0;
		goto render;
	}
	if (pad > 4096) return 2;
	for (size_t i = 0; i < pad; ++i) frame[i] = 0x55;
	po32_builder_init(&b, frame + pad, sizeof frame - pad);
	for (int i = 1; i < argc; ++i) {
		char *path;
		unsigned tag = (unsigned)strtoul(argv[i], &path, 16);
		uint8_t payload[256];
		FILE *f = *path == ':' ? fopen(path + 1, "rb") : NULL;
		if (!f) {
			fprintf(stderr, "can't read %s\n", argv[i]);
			return 1;
		}
		size_t n = fread(payload, 1, sizeof payload, f);
		fclose(f);
		if (po32_builder_append_packet(&b, (uint16_t)tag, payload, n, NULL) != PO32_OK) {
			fprintf(stderr, "can't append %s\n", argv[i]);
			return 1;
		}
	}
	if (po32_builder_finish(&b, &len) != PO32_OK) return 1;
	len += pad;
render:;
	size_t trail = getenv("TRAIL") ? (size_t)atol(getenv("TRAIL")) : 4;
	if (trail > 64) return 2;
	for (size_t i = 0; i < trail; ++i) frame[len++] = 0x55;
	size_t count = po32_render_sample_count(len, 48000);
	float *samples = malloc(count * sizeof *samples);
	if (!samples || po32_render_dpsk_f32(frame, len, 48000, samples, count) != PO32_OK) return 1;
	fwrite(samples, sizeof *samples, count, stdout);
	free(samples);
	return 0;
}
