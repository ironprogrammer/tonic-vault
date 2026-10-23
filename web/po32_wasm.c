/*
 * WebAssembly glue over libpo32's streaming demodulator and drum synth.
 * Decoding: JS writes samples into input_buffer(), calls decoder_push(), and reads decoded packets back by index.
 * Synth: JS writes a sound's left and right patch payloads into patch_buffer(), calls render_hit(), and reads output_buffer().
 * Encoding: JS adds packets through payload_buffer() and frame_add(), calls frame_finish(), then renders the modem audio
 * into output_buffer() a chunk at a time with modulator_start() and modulator_render().
 * Everything is static, since libpo32 is freestanding and this build has no libc.
 */
#include "po32.h"
#include "po32_synth.h"

#define EXPORT(name) __attribute__((export_name(name)))
#define INPUT_CAPACITY 8192
#define PACKET_CAPACITY 64
#define OUTPUT_CAPACITY (48000 * 4)
#define FRAME_CAPACITY 8192

static float input[INPUT_CAPACITY];
static po32_demodulator_t demod;
static po32_packet_t packets[PACKET_CAPACITY];
static int stored;
static uint8_t patches[2 * PO32_PATCH_PAYLOAD_BYTES];
static float output[OUTPUT_CAPACITY];
static uint8_t payload[PO32_MAX_PAYLOAD];
static uint8_t frame[FRAME_CAPACITY];
static size_t frame_len;
static po32_builder_t builder;
static po32_modulator_t modulator;

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

EXPORT("payload_buffer") uint8_t *payload_buffer(void) { return payload; }

EXPORT("frame_begin") void frame_begin(void) {
	po32_builder_init(&builder, frame, FRAME_CAPACITY);
	frame_len = 0;
}

/* Appends the len-byte packet in payload_buffer() and returns its byte offset in the frame, or -1. */
EXPORT("frame_add") int frame_add(int tag, int len) {
	size_t offset = 0;
	if (len < 0 || len > PO32_MAX_PAYLOAD) return -1;
	if (po32_builder_append_packet(&builder, (uint16_t)tag, payload, (size_t)len, &offset) != PO32_OK) return -1;
	return (int)offset;
}

/*
 * Ends the frame and returns its length, or -1. trail bytes of 0x55 follow the final tail, since the Tonic
 * shows err when the audio stops right on the last bit. Its own transfers keep the carrier going about 25 ms.
 */
EXPORT("frame_finish") int frame_finish(int trail) {
	if (po32_builder_finish(&builder, &frame_len) != PO32_OK) return -1;
	for (int i = 0; i < trail && frame_len < FRAME_CAPACITY; i++) frame[frame_len++] = 0x55;
	return (int)frame_len;
}

/* Starts rendering the finished frame and returns the total sample count. */
EXPORT("modulator_start") int modulator_start(int sample_rate) {
	po32_modulator_init(&modulator, frame, frame_len, (uint32_t)sample_rate);
	return (int)po32_modulator_samples_remaining(&modulator);
}

/* Renders the next chunk into output_buffer() and returns its sample count, 0 when done. */
EXPORT("modulator_render") int modulator_render(void) {
	size_t len = 0;
	if (po32_modulator_render_f32(&modulator, output, OUTPUT_CAPACITY, &len) != PO32_OK) return -1;
	return (int)len;
}
