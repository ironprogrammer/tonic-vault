// Writes a pattern as a standard MIDI file for a DAW.

import { swungStep } from './pattern.js';

const PPQ = 480;
const STEP = PPQ / 4;
const BAR = STEP * 16;

function varLen(n) {
	const bytes = [n & 0x7f];
	while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
	return bytes;
}

function meta(type, data) {
	return [0xff, type, ...varLen(data.length), ...data];
}

/*
 * One bar on channel 1 at 480 ticks per quarter note, ending exactly on the bar so a DAW loops it at one bar.
 * Sound n plays note 35 + n (sound 1 on C1, the first drum pad). Accents are velocity 127, other hits 100.
 * A multiplier repeats the hit evenly across its swung step, and each note lasts half the gap to the next repeat.
 */
export function patternMidi(parsed, { name, bpm, swing }) {
	const events = [];
	for (const h of parsed.hits) {
		const { offset, span } = swungStep(h.step, swing);
		const gap = (span * STEP) / h.multiplier;
		const note = 35 + h.sound;
		for (let k = 0; k < h.multiplier; k++) {
			const on = (h.step + offset) * STEP + k * gap;
			events.push({ tick: Math.round(on), data: [0x90, note, h.accent ? 127 : 100] });
			events.push({ tick: Math.round(on + gap / 2), data: [0x80, note, 0] });
		}
	}
	// Note-offs sort before note-ons on the same tick.
	events.sort((a, b) => a.tick - b.tick || a.data[0] - b.data[0]);

	const tempo = Math.round(60_000_000 / bpm);
	const track = [
		0, ...meta(0x03, [...new TextEncoder().encode(name)]),
		0, ...meta(0x51, [tempo >> 16, (tempo >> 8) & 0xff, tempo & 0xff]),
		0, ...meta(0x58, [4, 2, 24, 8]),
	];
	let tick = 0;
	for (const e of events) {
		track.push(...varLen(e.tick - tick), ...e.data);
		tick = e.tick;
	}
	track.push(...varLen(BAR - tick), ...meta(0x2f, []));

	const u32 = (n) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
	return new Uint8Array([
		...[0x4d, 0x54, 0x68, 0x64], ...u32(6), 0, 0, 0, 1, PPQ >> 8, PPQ & 0xff,
		...[0x4d, 0x54, 0x72, 0x6b], ...u32(track.length), ...track,
	]);
}

// The MIDI as a file named after the pattern, minus characters file systems reject.
export function midiFile(parsed, options) {
	return new File([patternMidi(parsed, options)], `${options.name.replace(/[\\/:*?"<>|]/g, '-')}.mid`, { type: 'audio/midi' });
}
