/*
 * WebAssembly glue over libpo32's streaming demodulator.
 * JS writes samples into input_buffer(), calls decoder_push(), and reads decoded packets back by index.
 * Everything is static, since libpo32 is freestanding and this build has no libc.
 */
#include "po32.h"

#define EXPORT(name) __attribute__((export_name(name)))
#define INPUT_CAPACITY 8192
#define PACKET_CAPACITY 64

static float input[INPUT_CAPACITY];
static po32_demodulator_t demod;
static po32_packet_t packets[PACKET_CAPACITY];
static int stored;

/* clang can lower struct copies to these, and there's no libc to provide them. */
void *memcpy(void *dst, const void *src, unsigned long n) {
	unsigned char *d = dst;
	const unsigned char *s = src;
	while (n--) *d++ = *s++;
	return dst;
}

void *memset(void *dst, int c, unsigned long n) {
	unsigned char *d = dst;
	while (n--) *d++ = (unsigned char)c;
	return dst;
}

static int on_packet(const po32_packet_t *pkt, void *user) {
	(void)user;
	if (stored < PACKET_CAPACITY) packets[stored++] = *pkt;
	return 0;
}

EXPORT("input_buffer") float *input_buffer(void) { return input; }
EXPORT("input_capacity") int input_capacity(void) { return INPUT_CAPACITY; }

EXPORT("decoder_init") void decoder_init(float sample_rate) {
	po32_demodulator_init(&demod, sample_rate);
	stored = 0;
}

/* Decode count samples from input_buffer(). Returns 1 once the transfer's final tail has arrived. */
EXPORT("decoder_push") int decoder_push(int count) {
	if (count < 0 || count > INPUT_CAPACITY) return -1;
	po32_demodulator_push(&demod, input, (size_t)count, on_packet, 0);
	return po32_demodulator_done(&demod);
}

EXPORT("decoder_synced") int decoder_synced(void) { return demod.synced; }
EXPORT("packet_count") int packet_count(void) { return stored; }
EXPORT("packet_tag") int packet_tag(int i) { return i >= 0 && i < stored ? packets[i].tag_code : 0; }
EXPORT("packet_length") int packet_length(int i) { return i >= 0 && i < stored ? (int)packets[i].payload_len : 0; }
EXPORT("packet_payload") const uint8_t *packet_payload(int i) { return i >= 0 && i < stored ? packets[i].payload : 0; }
