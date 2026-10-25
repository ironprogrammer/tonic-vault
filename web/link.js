// Packs one pattern and its sound set into a URL fragment, so a link plays it without a vault and can save it to one.

import { fromBase64, toBase64 } from './pattern.js';

const VERSION = 1;

/*
 * Bytes: version, bpm, swing, a 2-byte text length, the text (pattern name, set name, then 16 sound names, joined by
 * newlines), then the pattern payload and every patch in the set, each after its length. Sent as base64url, about 2.5 KB.
 * The whole set goes along so a saved pattern lands on the same sound set it has in the sender's vault.
 */
export function packLink(pattern, set) {
	const raw = fromBase64(pattern.raw);
	const text = new TextEncoder().encode([pattern.name, set.name ?? '', ...(set.soundNames ?? [])].map((t) => t.replace(/\n/g, ' ')).join('\n'));
	const patches = set.sounds.map(fromBase64);
	const bytes = new Uint8Array([
		VERSION, pattern.bpm, pattern.swing, text.length >> 8, text.length & 0xff, ...text, ...[raw, ...patches].flatMap((p) => [p.length, ...p]),
	]);
	return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Reads a link back into a pattern and sound set shaped like the vault's. Throws on a link that's cut short.
export function unpackLink(fragment) {
	const bytes = fromBase64(fragment.replace(/-/g, '+').replace(/_/g, '/'));
	if (bytes[0] !== VERSION) throw new Error('unknown link version');
	const textEnd = 5 + ((bytes[3] << 8) | bytes[4]);
	const [name, setName, ...soundNames] = new TextDecoder().decode(bytes.subarray(5, textEnd)).split('\n');
	const [raw, ...patches] = chunks(bytes.subarray(textEnd));
	const sounds = patches.map(toBase64);
	return {
		pattern: { name, bpm: bytes[1], swing: bytes[2], slot: raw[0] + 1, soundSetId: 'link', raw: toBase64(raw) },
		set: { id: 'link', name: setName, soundNames, sounds },
	};
}

// Splits bytes into the chunks that each follow a length byte.
function chunks(bytes) {
	const out = [];
	for (let pos = 0; pos < bytes.length; pos += 1 + bytes[pos]) {
		if (pos + 1 + bytes[pos] > bytes.length) throw new Error('broken link');
		out.push(bytes.subarray(pos + 1, pos + 1 + bytes[pos]));
	}
	if (!out.length) throw new Error('broken link');
	return out;
}
