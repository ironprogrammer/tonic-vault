// The vault document: decoding a transfer's packets into sounds and patterns, and merging them in.

import { toBase64 } from './pattern.js';
import { TAG } from './po32.js';

const STORAGE_KEY = 'tonic-vault';

// A sound set's id is a hash of its patches, so every PO-32 still on factory sounds has this one.
export const FACTORY_SET_ID = 'cdf8e256e5949113';

export const FACTORY_SOUNDS = [
	'kick 1', 'snare 1', 'shaker / zap', 'lfo effect',
	'kick 2', 'snare 3', 'close / open hi-hat', 'claves / cowbell',
	'low tom / kick 3', 'rimshot', 'tambourine / crash', 'hand clap',
	'bass', 'fm snare', 'cymbal', 'high tom',
];

// Each sound set keeps its own 16 sound names. Factory sets start with the guide's names; packs publish none.
function seedSoundNames(set) {
	set.soundNames ??= set.id === FACTORY_SET_ID ? [...FACTORY_SOUNDS] : Array(16).fill('');
	return set;
}

// Fills in anything a vault saved by an older version lacks.
export function upgradeVault(vault) {
	vault.soundSets.forEach(seedSoundNames);
	vault.export ??= emptyExport();
	return vault;
}

export function emptyVault() {
	return { version: 1, soundSets: [], patterns: [], tonic: null, export: emptyExport() };
}

// What to send next: a pattern id per slot (null leaves the Tonic's), patterns waiting for a slot, and options.
function emptyExport() {
	return { slots: Array(16).fill(null), pending: [], soundSetId: null, sendState: false };
}

export function loadVault(storage = globalThis.localStorage) {
	try {
		const json = storage?.getItem(STORAGE_KEY);
		return json ? upgradeVault(JSON.parse(json)) : emptyVault();
	} catch {
		return emptyVault();
	}
}

export function saveVault(vault, storage = globalThis.localStorage) {
	storage.setItem(STORAGE_KEY, JSON.stringify(vault));
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

/*
 * Merges one transfer's packets into the vault and reports what was new. Mutates the vault.
 * A transfer read from a file (fromTonic false) says nothing about what's on the Tonic, and setName names a new sound set.
 */
export async function importTransfer(vault, packets, now = new Date().toISOString(), { fromTonic = true, setName = '' } = {}) {
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
			set = seedSoundNames({ id, name: setName, sounds: patches.map((p) => toBase64(p.payload)), firstSeen: now, lastSeen: now });
			vault.soundSets.push(set);
			result.newSoundSet = true;
		}
		result.soundSet = set;
		// The state packet's morph pairs are the knob positions that go with these sounds, needed to send them back.
		if (statePacket) set.knobs = toBase64(statePacket.payload.subarray(0, 32));
	}

	const slots = Array(16).fill(null);
	for (const { payload } of patterns) {
		const slot = payload[0] + 1;
		if (isEmptyPattern(payload)) continue;
		const id = await hash(payload.subarray(1));
		let pattern = vault.patterns.find((p) => p.id === id);
		if (pattern) {
			if (fromTonic && pattern.slot !== slot) {
				result.movedPatterns.push(pattern);
				pattern.slot = slot;
			}
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

	if (fromTonic && patterns.length) {
		vault.tonic = { seen: now, soundSetId: result.soundSet?.id ?? vault.tonic?.soundSetId ?? null, slots, ...state };
	}
	return result;
}

// Unnamed patterns go by their sound set's name, such as a TE sound pack's, and their slot.
export function patternName(pattern, vault) {
	const set = vault.soundSets.find((s) => s.id === pattern.soundSetId);
	return pattern.name || `${set?.name || 'untitled'} · slot ${pattern.slot}`;
}

// Dates show the way the mock does, month.day, in local time.
export function shortDate(iso) {
	if (!iso) return '';
	const d = new Date(iso);
	return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

// The patterns from the most recent import are the new ones.
export function isNew(vault, pattern) {
	return pattern.firstSeen === vault.tonic?.seen;
}

// Puts patterns in their last slot when it's free in the export, and queues the rest to be given a slot.
export function addToExport(vault, ids) {
	const plan = vault.export;
	for (const id of ids) {
		const pattern = vault.patterns.find((p) => p.id === id);
		if (!pattern || plan.slots.includes(id) || plan.pending.includes(id)) continue;
		if (plan.slots[pattern.slot - 1]) plan.pending.push(id);
		else plan.slots[pattern.slot - 1] = id;
	}
}
