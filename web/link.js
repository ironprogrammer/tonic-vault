// Packs one pattern into a URL fragment, so a link plays it with factory sounds without a vault and can save it to one.

import { factorySet } from './factory.js';
import { fromBase64, toBase64 } from './pattern.js';

const VERSION = 1;

// Bytes: version, bpm, swing, then the name (up to 255 bytes) and the pattern payload, each after its length. Sent as base64url.
export function packLink(pattern) {
	const name = new TextEncoder().encode(pattern.name).subarray(0, 255);
	const bytes = new Uint8Array([VERSION, pattern.bpm, pattern.swing, ...[name, fromBase64(pattern.raw)].flatMap((p) => [p.length, ...p])]);
	return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Reads a link back into a pattern and sound set shaped like the vault's. Throws on a link that's cut short.
export function unpackLink(fragment) {
	const bytes = fromBase64(fragment.replace(/-/g, '+').replace(/_/g, '/'));
	if (bytes[0] !== VERSION) throw new Error('unknown link version');
	const [name, raw] = chunks(bytes.subarray(3));
	if (!raw?.length) throw new Error('broken link');
	const set = factorySet();
	return {
		pattern: { name: new TextDecoder().decode(name), bpm: bytes[1], swing: bytes[2], slot: raw[0] + 1, soundSetId: set.id, raw: toBase64(raw) },
		set,
	};
}

// Splits bytes into the chunks that each follow a length byte.
function chunks(bytes) {
	const out = [];
	for (let pos = 0; pos < bytes.length; pos += 1 + bytes[pos]) {
		if (pos + 1 + bytes[pos] > bytes.length) throw new Error('broken link');
		out.push(bytes.subarray(pos + 1, pos + 1 + bytes[pos]));
	}
	return out;
}
