import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadDecoder, loadSynth, TAG } from '../po32.js';
import { parsePattern, soundPatches } from '../pattern.js';
import { emptyVault, importTransfer } from '../vault.js';

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

// Streams the fixture through the decoder in 128-sample blocks, like an AudioWorklet delivers them.
async function decodeFixture() {
	const decoder = await loadDecoder(await readFile(wasmUrl));
	const { rate, samples } = readWav(await readFile(fixtureUrl));
	decoder.reset(rate);
	const packets = [];
	let done = false;
	for (let i = 0; i < samples.length && !done; i += 128) {
		const out = decoder.push(samples.subarray(i, i + 128));
		packets.push(...out.packets);
		done = out.done;
	}
	return { done, packets };
}

test('decodes the fixture backup', async () => {
	const { done, packets } = await decodeFixture();
	assert.equal(done, true);
	const tags = {};
	for (const { tag } of packets) tags[tag] = (tags[tag] || 0) + 1;
	assert.deepEqual(tags, { [TAG.patch]: 32, [TAG.pattern]: 16, [TAG.state]: 1 });
});

test('a second import of the same transfer finds nothing new', async () => {
	const { packets } = await decodeFixture();
	const vault = emptyVault();
	const first = await importTransfer(vault, packets);
	assert.ok(first.newPatterns.length > 0);
	assert.equal(first.newSoundSet, true);

	const second = await importTransfer(vault, packets);
	assert.equal(second.newPatterns.length, 0);
	assert.equal(second.knownPatterns.length, first.newPatterns.length);
	assert.equal(second.newSoundSet, false);
	assert.equal(vault.patterns.length, first.newPatterns.length);
});

test('parses hits, multipliers, and accents from slot 1', async () => {
	const { packets } = await decodeFixture();
	const pattern = parsePattern(packets.find((p) => p.tag === TAG.pattern && p.payload[0] === 0).payload);
	assert.equal(pattern.slot, 1);
	assert.deepEqual(pattern.accents.flatMap((on, i) => (on ? [i + 1] : [])), [1, 10]);
	assert.deepEqual(pattern.hits.filter((h) => h.sound === 1).map((h) => h.step + 1), [1, 4, 10, 13]);
});

test('renders an audible hit of every sound', async () => {
	const { packets } = await decodeFixture();
	const synth = await loadSynth(await readFile(wasmUrl));
	const sounds = soundPatches(packets.filter((p) => p.tag === TAG.patch).map((p) => p.payload));
	assert.equal(Object.keys(sounds).length, 16);
	for (const { left, right } of Object.values(sounds)) {
		const samples = synth.render(left, right, { sampleRate: 48000, morph: 0.5, seconds: 1 });
		assert.ok(samples.reduce((peak, s) => Math.max(peak, Math.abs(s)), 0) > 0.01);
	}
});

test('names a factory set\'s sounds from the guide', async () => {
	const { packets } = await decodeFixture();
	const { soundSet } = await importTransfer(emptyVault(), packets);
	assert.equal(soundSet.soundNames[2], 'shaker / zap');
});

test('a file import names its sound set and leaves the tonic alone', async () => {
	const { packets } = await decodeFixture();
	const vault = emptyVault();
	const result = await importTransfer(vault, packets, undefined, { fromTonic: false, setName: 'basic beats 1' });
	assert.equal(vault.tonic, null);
	assert.equal(result.soundSet.name, 'basic beats 1');
	assert.equal(result.soundSet.soundNames[2], 'shaker / zap');
});
