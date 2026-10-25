import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packLink, unpackLink } from '../link.js';
import { toBase64 } from '../pattern.js';
import { emptyVault, saveLinked } from '../vault.js';

// Slot 3 with sound 1 on step 0 and sound 6 (lane 2, bit 0x10) on step 4, plus a full set of 32 patches.
const raw = new Uint8Array(211);
raw[0] = 2;
raw[1] = 0x01;
raw[1 + 48 + 4] = 0x11;
const sounds = [];
for (let sound = 1; sound <= 16; sound++) {
	for (const side of [1, 2]) sounds.push(toBase64(new Uint8Array(45).fill(sound).fill((side << 4) | (sound - 1), 0, 1)));
}
const set = { id: 'abc', name: 'kit', soundNames: Array.from({ length: 16 }, (_, i) => `s${i + 1}`), sounds };
const pattern = { name: 'bossa · ñ', raw: toBase64(raw), bpm: 132, swing: 9 };

test('a link carries the pattern and its sound set', () => {
	const fragment = packLink(pattern, set);
	assert.match(fragment, /^[\w-]+$/);
	const back = unpackLink(fragment);
	assert.deepEqual(back.pattern, { name: 'bossa · ñ', bpm: 132, swing: 9, slot: 3, soundSetId: 'link', raw: pattern.raw });
	assert.deepEqual(back.set, { id: 'link', name: 'kit', soundNames: set.soundNames, sounds });
});

test('a link cut short is refused', () => {
	assert.throws(() => unpackLink(packLink(pattern, set).slice(0, -10)));
});

test('saving a link adds its pattern and set once', async () => {
	const vault = emptyVault();
	const shared = unpackLink(packLink(pattern, set));
	const saved = await saveLinked(vault, shared);
	assert.equal(await saveLinked(vault, shared), saved);
	assert.equal(vault.patterns.length, 1);
	assert.deepEqual([saved.name, saved.bpm, saved.swing, saved.slot], ['bossa · ñ', 132, 9, 3]);
	assert.deepEqual([vault.soundSets.length, vault.soundSets[0].name, vault.soundSets[0].soundNames], [1, 'kit', set.soundNames]);
	assert.equal(saved.soundSetId, vault.soundSets[0].id);
});
