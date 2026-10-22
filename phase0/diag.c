/*
 * Run libpo32's streaming demodulator over raw mono f32 audio and report
 * sync events, decoded packets, and where lock is lost.
 * Usage: sox in.wav -t f32 -c 1 - | build/diag <sample_rate>
 */
#include <stdio.h>
#include <stdlib.h>
#include "po32.h"

static int on_packet(const po32_packet_t *pkt, void *user) {
	const double *t = user;
	printf("%8.3fs packet %-7s len=%u\n", *t, po32_tag_name(pkt->tag_code), (unsigned)pkt->payload_len);
	return 0;
}

int main(int argc, char **argv) {
	float rate = argc > 1 ? (float)atof(argv[1]) : 48000.0f;
	po32_demodulator_t d;
	float s;
	double t = 0.0;
	size_t n = 0;
	int was_synced = 0, syncs = 0;
	uint64_t last_window = 0;

	po32_demodulator_init(&d, rate);
	while (fread(&s, sizeof s, 1, stdin) == 1) {
		t = (double)n++ / rate;
		po32_demodulator_push(&d, &s, 1, on_packet, &t);
		if (d.synced && !was_synced) {
			printf("%8.3fs sync #%d\n", t, ++syncs);
		} else if (!d.synced && was_synced) {
			printf("%8.3fs lost lock after %d packets, %zu bytes, work_len=%zu\n", t, d.packet_count, d.byte_offset, d.work_len);
		}
		if (!d.synced && d.sync_window != last_window && getenv("BITS") && t >= atof(getenv("BITS")) && t < atof(getenv("BITS")) + (getenv("BITS_LEN") ? atof(getenv("BITS_LEN")) : 0.25)) {
			printf("%8.3fs bit %d\n", t, (int)(d.sync_window >> 63));
		}
		last_window = d.sync_window;
		was_synced = d.synced;
		if (d.done) {
			printf("%8.3fs done, %d packets\n", t, d.packet_count);
			return 0;
		}
	}
	printf("end of audio at %.3fs, %d syncs, done=%d\n", t, syncs, d.done);
	return 1;
}
