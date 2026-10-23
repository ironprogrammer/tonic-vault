/*
 * WebAssembly glue over libpo32's streaming demodulator and drum synth.
 * Decoding: JS writes samples into input_buffer(), calls decoder_push(), and reads decoded packets back by index.
 * Synth: JS writes a sound's left and right patch payloads into patch_buffer(), calls render_hit(), and reads output_buffer().
 * Everything is static, since libpo32 is freestanding and this build has no libc.
 */
#include "po32.h"
#include "po32_synth.h"

#define EXPORT(name) __attribute__((export_name(name)))
#define INPUT_CAPACITY 8192
#define PACKET_CAPACITY 64
#define OUTPUT_CAPACITY (48000 * 4)

static float input[INPUT_CAPACITY];
static po32_demodulator_t demod;
static po32_packet_t packets[PACKET_CAPACITY];
static int stored;
static uint8_t patches[2 * PO32_PATCH_PAYLOAD_BYTES];
static float output[OUTPUT_CAPACITY];

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

EXPORT("patch_buffer") uint8_t *patch_buffer(void) { return patches; }
EXPORT("output_buffer") float *output_buffer(void) { return output; }
EXPORT("output_capacity") int output_capacity(void) { return OUTPUT_CAPACITY; }

/*
 * Renders one hit of the sound in patch_buffer() into output_buffer() and returns the sample count.
 * morph (0-1) blends the left patch toward the right one, as the Tonic's morph knob does.
 */
EXPORT("render_hit") int render_hit(int sample_rate, float morph, int velocity, float seconds) {
	po32_patch_params_t left, right;
	po32_synth_t synth;
	size_t len = 0;
	float *l = &left.OscWave, *r = &right.OscWave;

	if (po32_decode_patch(patches + 1, PO32_PATCH_PAYLOAD_BYTES - 1, &left) != PO32_OK) return -1;
	if (po32_decode_patch(patches + PO32_PATCH_PAYLOAD_BYTES + 1, PO32_PATCH_PAYLOAD_BYTES - 1, &right) != PO32_OK) return -1;
	for (int i = 0; i < PO32_PARAM_COUNT; i++) l[i] += (r[i] - l[i]) * morph;

	po32_synth_init(&synth, (uint32_t)sample_rate);
	if (po32_synth_render(&synth, &left, velocity, seconds, output, OUTPUT_CAPACITY, &len) != PO32_OK) return -1;
	return (int)len;
}
