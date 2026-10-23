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

export async function loadSynth(wasmBytes) {
	const { instance } = await WebAssembly.instantiate(wasmBytes);
	const po32 = instance.exports;
	const size = 43;

	return {
		// Renders one hit of a sound from its left and right patch payloads. morph is 0-1, velocity is MIDI 0-127.
		render(left, right, { sampleRate, morph = 0, velocity = 100, seconds = 3 }) {
			const patches = new Uint8Array(po32.memory.buffer, po32.patch_buffer(), size * 2);
			patches.set(left);
			patches.set(right, size);
			const len = po32.render_hit(sampleRate, morph, velocity, Math.min(seconds, po32.output_capacity() / sampleRate));
			if (len < 0) throw new Error('bad patch payload');
			return new Float32Array(po32.memory.buffer, po32.output_buffer(), len).slice();
		},
	};
}

export async function loadEncoder(wasmBytes) {
	const { instance } = await WebAssembly.instantiate(wasmBytes);
	const po32 = instance.exports;

	return {
		/*
		 * Renders packets ([{ tag, payload }]) as one transfer's modem audio.
		 * Returns the samples, plus each packet's start as a fraction of the whole for progress.
		 */
		render(packets, sampleRate) {
			po32.frame_begin();
			const offsets = packets.map(({ tag, payload }) => {
				new Uint8Array(po32.memory.buffer, po32.payload_buffer(), payload.length).set(payload);
				const offset = po32.frame_add(tag, payload.length);
				if (offset < 0) throw new Error('packet rejected');
				return offset;
			});
			const length = po32.frame_finish(4);
			if (length < 0) throw new Error('frame rejected');
			const samples = new Float32Array(po32.modulator_start(sampleRate));
			for (let at = 0, n; (n = po32.modulator_render()) > 0; at += n) {
				samples.set(new Float32Array(po32.memory.buffer, po32.output_buffer(), n), at);
			}
			return { samples, starts: offsets.map((o) => o / length) };
		},
	};
}
