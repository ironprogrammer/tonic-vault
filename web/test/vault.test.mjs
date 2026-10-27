import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyVault, hasVault, saveVault, unsavedPatterns } from '../vault.js';

test('patterns count as unsaved once the oldest has gone a week without a backup', () => {
	const vault = emptyVault();
	const now = new Date('2026-10-25T12:00:00Z');
	vault.patterns = [{ firstSeen: '2026-10-20T12:00:00Z' }, { firstSeen: '2026-10-24T12:00:00Z' }];
	assert.equal(unsavedPatterns(vault, now).length, 0);
	vault.patterns.push({ firstSeen: '2026-10-10T12:00:00Z' });
	assert.equal(unsavedPatterns(vault, now).length, 3);
	vault.savedAt = '2026-10-15T12:00:00Z';
	assert.equal(unsavedPatterns(vault, now).length, 0);
	vault.patterns.push({ firstSeen: '2026-10-16T12:00:00Z' });
	assert.equal(unsavedPatterns(vault, now).length, 3);
});

test('a vault counts as stored once saved, even with nothing in it', () => {
	const store = new Map();
	const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
	assert.equal(hasVault(storage), false);
	saveVault(emptyVault(), storage);
	assert.equal(hasVault(storage), true);
});
