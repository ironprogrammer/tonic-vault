import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { factorySet } from '../factory.js';
import { packLink, unpackLink } from '../link.js';
import { fromBase64, toBase64 } from '../pattern.js';
import { emptyVault, FACTORY_SET_ID, saveLinked } from '../vault.js';

// Slot 3 with sound 1 on step 0.
const raw = new Uint8Array(213);
raw[0] = 2;
raw[1] = 0x01;
const pattern = { name: 'bossa · ñ', raw: toBase64(raw), bpm: 132, swing: 9 };

test('the bundled factory patches hash to the factory set id', () => {
	const joined = Buffer.concat(factorySet().sounds.map(fromBase64));
	assert.equal(createHash('sha256').update(joined).digest('hex').slice(0, 16), FACTORY_SET_ID);
});

test('a link carries the pattern and plays it with factory sounds', () => {
	const fragment = packLink(pattern);
	assert.match(fragment, /^[\w-]+$/);
	const back = unpackLink(fragment);
	assert.deepEqual(back.pattern, { name: 'bossa · ñ', bpm: 132, swing: 9, slot: 3, soundSetId: FACTORY_SET_ID, raw: pattern.raw });
	assert.equal(back.set.id, FACTORY_SET_ID);
});

test('a link cut short is refused', () => {
	assert.throws(() => unpackLink(packLink(pattern).slice(0, -10)));
});

test('saving a link adds its pattern and the factory set once', async () => {
	const vault = emptyVault();
	const saved = await saveLinked(vault, unpackLink(packLink(pattern)));
	assert.equal(await saveLinked(vault, unpackLink(packLink(pattern))), saved);
	assert.equal(vault.patterns.length, 1);
	assert.deepEqual([saved.name, saved.bpm, saved.swing, saved.slot, saved.soundSetId], ['bossa · ñ', 132, 9, 3, FACTORY_SET_ID]);
	assert.equal(vault.soundSets.length, 1);
	assert.equal(vault.soundSets[0].soundNames[0], 'kick 1');
});
