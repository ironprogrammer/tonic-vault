import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packLink, unpackLink } from '../link.js';
import { toBase64 } from '../pattern.js';

// Slot 3 with sound 1 on step 0 and sound 6 (lane 2, bit 0x10) on step 4, plus a full set of 32 patches.
const raw = new Uint8Array(211);
raw[0] = 2;
raw[1] = 0x01;
raw[1 + 48 + 4] = 0x11;
const sounds = [];
for (let sound = 1; sound <= 16; sound++) {
	for (const side of [1, 2]) sounds.push(toBase64(new Uint8Array(45).fill(sound).fill((side << 4) | (sound - 1), 0, 1)));
}
const set = { id: 'abc', soundNames: Array.from({ length: 16 }, (_, i) => `s${i + 1}`), sounds };
const pattern = { raw: toBase64(raw), bpm: 132, swing: 9 };

test('a link carries the pattern and only the sounds it plays', () => {
	const fragment = packLink(pattern, set, 'bossa · ñ');
	assert.match(fragment, /^[\w-]+$/);
	const back = unpackLink(fragment);
	assert.deepEqual(back.pattern, { name: 'bossa · ñ', bpm: 132, swing: 9, slot: 3, raw: pattern.raw });
	assert.deepEqual(back.set.sounds, [sounds[0], sounds[1], sounds[10], sounds[11]]);
	assert.deepEqual(back.set.soundNames.filter(Boolean), ['s1', 's6']);
});

test('a link cut short is refused', () => {
	assert.throws(() => unpackLink(packLink(pattern, set, 'x').slice(0, -10)));
});
