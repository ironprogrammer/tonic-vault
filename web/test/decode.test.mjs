import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wasmUrl = new URL('../po32.wasm', import.meta.url);
const fixtureUrl = new URL('../../tests/fixtures/tonic-backup-2026-10-22.wav', import.meta.url);

// Reads a 16-bit PCM mono WAV into floats, walking chunks to find fmt and data.
function readWav(buf) {
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	let rate = 0;
	for (let pos = 12; pos + 8 <= buf.length;) {
		const id = buf.toString('ascii', pos, pos + 4);
		const size = view.getUint32(pos + 4, true);
		if (id === 'fmt ') rate = view.getUint32(pos + 12, true);
		if (id === 'data') {
			const samples = new Float32Array(size / 2);
			for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(pos + 8 + i * 2, true) / 32768;
			return { rate, samples };
		}
		pos += 8 + size + (size & 1);
	}
	throw new Error('no data chunk');
}

test('decodes the fixture backup in chunks', async () => {
	const { instance } = await WebAssembly.instantiate(await readFile(wasmUrl));
	const po32 = instance.exports;
	const { rate, samples } = readWav(await readFile(fixtureUrl));
	const cap = po32.input_capacity();
	po32.decoder_init(rate);
	let done = 0;
	for (let i = 0; i < samples.length && !done; i += cap) {
		const chunk = samples.subarray(i, i + cap);
		new Float32Array(po32.memory.buffer, po32.input_buffer(), cap).set(chunk);
		done = po32.decoder_push(chunk.length);
	}
	assert.equal(done, 1);

	const tags = {};
	for (let i = 0; i < po32.packet_count(); i++) {
		const tag = po32.packet_tag(i);
		tags[tag] = (tags[tag] || 0) + 1;
	}
	assert.deepEqual(tags, { 0x37b2: 32, 0xd022: 16, 0x505a: 1 });
});
