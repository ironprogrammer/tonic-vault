// Wraps po32.wasm's streaming decoder. Works in browsers and node: pass the wasm bytes in.

export const TAG = { patch: 0x37b2, pattern: 0xd022, state: 0x505a };

export async function loadDecoder(wasmBytes) {
	const { instance } = await WebAssembly.instantiate(wasmBytes);
	const po32 = instance.exports;
	const cap = po32.input_capacity();
	let seen = 0;

	return {
		// Starts a new transfer at the given sample rate, dropping any packets from the last one.
		reset(sampleRate) {
			po32.decoder_init(sampleRate);
			seen = 0;
		},

		// Feeds mono float samples and returns { done, synced, packets } with only the packets new since the last push.
		push(samples) {
			let done = 0;
			for (let i = 0; i < samples.length && !done; i += cap) {
				const chunk = samples.subarray(i, i + cap);
				new Float32Array(po32.memory.buffer, po32.input_buffer(), cap).set(chunk);
				done = po32.decoder_push(chunk.length);
			}
			const packets = [];
			for (; seen < po32.packet_count(); seen++) {
				const len = po32.packet_length(seen);
				const payload = new Uint8Array(po32.memory.buffer, po32.packet_payload(seen), len).slice();
				packets.push({ tag: po32.packet_tag(seen), payload });
			}
			return { done: done === 1, synced: po32.decoder_synced() === 1, packets };
		},
	};
}
