// The vault document: decoding a transfer's packets into sounds and patterns, and merging them in.

import { TAG } from './po32.js';

const STORAGE_KEY = 'tonic-vault';

export function emptyVault() {
	return { version: 1, soundSets: [], patterns: [], tonic: null };
}

export function loadVault(storage = globalThis.localStorage) {
	try {
		const json = storage?.getItem(STORAGE_KEY);
		return json ? JSON.parse(json) : emptyVault();
	} catch {
		return emptyVault();
	}
}

export function saveVault(vault, storage = globalThis.localStorage) {
	storage.setItem(STORAGE_KEY, JSON.stringify(vault));
}

function toBase64(bytes) {
	return btoa(String.fromCharCode(...bytes));
}

async function hash(bytes) {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	return Array.from(digest.subarray(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

// A pattern payload is the slot number, then 4 lanes of 16 trigger bytes + 16 morph pairs, effects, and accents.
function isEmptyPattern(payload) {
	for (let lane = 0; lane < 4; lane++) {
		for (let step = 0; step < 16; step++) {
			if (payload[1 + lane * 48 + step] & 0x0f) return false;
		}
	}
	return true;
}

// Reads tempo, swing, and chain from a state payload: 16 morph pairs, then tempo, swing, count, and pattern numbers.
function readState(payload) {
	const count = payload[34];
	return { tempo: payload[32], swing: payload[33], chain: Array.from(payload.subarray(35, 35 + count), (n) => n + 1) };
}

// Merges one transfer's packets into the vault and reports what was new. Mutates and returns the vault.
export async function importTransfer(vault, packets, now = new Date().toISOString()) {
	const patches = packets.filter((p) => p.tag === TAG.patch);
	const patterns = packets.filter((p) => p.tag === TAG.pattern);
	const statePacket = packets.find((p) => p.tag === TAG.state);
	const state = statePacket ? readState(statePacket.payload) : null;
	const result = { newPatterns: [], knownPatterns: [], movedPatterns: [], soundSet: null, newSoundSet: false, state };

	if (patches.length) {
		const joined = new Uint8Array(patches.reduce((n, p) => n + p.payload.length, 0));
		patches.reduce((at, p) => (joined.set(p.payload, at), at + p.payload.length), 0);
		const id = await hash(joined);
		let set = vault.soundSets.find((s) => s.id === id);
		if (set) {
			set.lastSeen = now;
		} else {
			set = { id, name: '', sounds: patches.map((p) => toBase64(p.payload)), firstSeen: now, lastSeen: now };
			vault.soundSets.push(set);
			result.newSoundSet = true;
		}
		result.soundSet = set;
	}

	const slots = Array(16).fill(null);
	for (const { payload } of patterns) {
		const slot = payload[0] + 1;
		if (isEmptyPattern(payload)) continue;
		const id = await hash(payload.subarray(1));
		let pattern = vault.patterns.find((p) => p.id === id);
		if (pattern) {
			if (pattern.slot !== slot) result.movedPatterns.push(pattern);
			pattern.slot = slot;
			pattern.lastSeen = now;
			result.knownPatterns.push(pattern);
		} else {
			pattern = {
				id,
				name: '',
				tags: [],
				bpm: state?.tempo ?? 120,
				swing: state?.swing ?? 0,
				soundSetId: result.soundSet?.id ?? null,
				slot,
				firstSeen: now,
				lastSeen: now,
				raw: toBase64(payload),
			};
			vault.patterns.push(pattern);
			result.newPatterns.push(pattern);
		}
		slots[slot - 1] = id;
	}

	if (patterns.length) {
		vault.tonic = { seen: now, soundSetId: result.soundSet?.id ?? vault.tonic?.soundSetId ?? null, slots, ...state };
	}
	return result;
}
