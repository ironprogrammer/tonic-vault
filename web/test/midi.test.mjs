import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patternMidi } from '../midi.js';

// Reads a one-track MIDI file back into its division and events with absolute ticks.
function readMidi(bytes) {
	const view = new DataView(bytes.buffer);
	const ppq = view.getUint16(12);
	const end = 22 + view.getUint32(18);
	const events = [];
	let pos = 22;
	let tick = 0;
	const varLen = () => {
		let n = 0;
		let b;
		do {
			b = bytes[pos++];
			n = (n << 7) | (b & 0x7f);
		} while (b & 0x80);
		return n;
	};
	while (pos < end) {
		tick += varLen();
		const status = bytes[pos++];
		if (status === 0xff) {
			const type = bytes[pos++];
			const length = varLen();
			events.push({ tick, meta: type, data: [...bytes.subarray(pos, pos + length)] });
			pos += length;
		} else {
			events.push({ tick, status, note: bytes[pos], velocity: bytes[pos + 1] });
			pos += 2;
		}
	}
	return { ppq, events };
}

const hit = (step, sound, extra = {}) => ({ step, sound, multiplier: 1, accent: false, ...extra });

test('a pattern becomes one looping bar of drum pad notes', () => {
	const parsed = { hits: [hit(0, 1), hit(4, 2, { accent: true }), hit(8, 16, { multiplier: 3 })] };
	const { ppq, events } = readMidi(patternMidi(parsed, { name: 'bossa', bpm: 125, swing: 0 }));
	const ons = events.filter((e) => e.status === 0x90).map((e) => [e.tick, e.note, e.velocity]);
	assert.equal(ppq, 480);
	assert.deepEqual(ons, [[0, 36, 100], [480, 37, 127], [960, 51, 100], [1000, 51, 100], [1040, 51, 100]]);
	assert.deepEqual(events.find((e) => e.meta === 0x51).data, [0x07, 0x53, 0x00]);
	assert.deepEqual(events.at(-1), { tick: 1920, meta: 0x2f, data: [] });
});

test('swing delays odd steps and keeps every note inside the bar', () => {
	const parsed = { hits: [hit(1, 1), hit(15, 3, { multiplier: 15 })] };
	const { events } = readMidi(patternMidi(parsed, { name: 'swung', bpm: 120, swing: 18 }));
	const notes = events.filter((e) => e.status);
	assert.equal(notes[0].tick, 120 + 43);
	assert.equal(notes.filter((e) => e.status === 0x90).length, 16);
	assert.ok(notes.every((e) => e.tick < 1920 || (e.status === 0x80 && e.tick === 1920)));
	assert.equal(events.at(-1).tick, 1920);
});
