// Reads a raw pattern payload into hits, accents, and effects.

/*
 * Payload layout: slot - 1, then 4 lanes of 16 trigger bytes + 16 knob pairs, 16 effect bytes, and a 16-bit accent mask.
 * Lane n plays sounds n+1, n+5, n+9, and n+13; trigger bits 0x10 and 0x20 pick which. The low nibble is the multiplier.
 * Each hit carries the pitch and morph knob values it was recorded with.
 */
export function parsePattern(bytes) {
	const accentBits = bytes[209] | (bytes[210] << 8);
	const accents = Array.from({ length: 16 }, (_, step) => Boolean(accentBits & (1 << step)));
	const effects = Array.from(bytes.subarray(193, 209));
	const hits = [];
	for (let lane = 0; lane < 4; lane++) {
		const base = 1 + lane * 48;
		for (let step = 0; step < 16; step++) {
			const trigger = bytes[base + step];
			if (!(trigger & 0x0f)) continue;
			hits.push({
				step,
				lane,
				sound: lane + 1 + (trigger & 0x10 ? 4 : 0) + (trigger & 0x20 ? 8 : 0),
				multiplier: trigger & 0x0f,
				accent: accents[step],
				pitch: bytes[base + 16 + step * 2],
				morph: bytes[base + 17 + step * 2],
			});
		}
	}
	markLocks(hits);
	return { slot: bytes[0] + 1, hits, accents, effects };
}

// How far swing (0-18, S00-S18 on the Tonic) delays a step, in steps. It's ticks of a 96 ppqn clock: S12 delays odd steps by half a step.
export function swingDelay(step, swing) {
	return step % 2 ? swing / 24 : 0;
}

/*
 * When each hit and multiplier repeat sounds in a looping bar, in steps from 0 to 16, as measured on the Tonic.
 * Repeats are a straight step / multiplier apart from the swung hit, and stop when the next hit on the same channel
 * starts, wrapping into the next bar if they run past it (marked wrapped). end is when the note should stop, for MIDI.
 */
export function barHits(hits, swing) {
	const at = (h) => h.step + swingDelay(h.step, swing);
	const out = [];
	for (const h of hits) {
		const start = at(h);
		const lane = hits.filter((o) => o.lane === h.lane).map(at);
		const next = Math.min(...lane.filter((t) => t > start), Math.min(...lane) + 16);
		for (let k = 0; k < h.multiplier; k++) {
			let time = start + k / h.multiplier;
			if (k && time >= next) break;
			let end = Math.min(time + 0.5 / h.multiplier, next);
			const wrapped = time >= 16;
			if (wrapped) {
				time -= 16;
				end -= 16;
			} else end = Math.min(end, 16);
			out.push({ hit: h, time, end, wrapped });
		}
	}
	return out.sort((a, b) => a.time - b.time);
}

// A hit whose knob values differ from that sound's most common values in the pattern is a parameter lock.
function markLocks(hits) {
	const counts = new Map();
	for (const h of hits) {
		const key = `${h.sound}:${h.pitch}:${h.morph}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	const usual = new Map();
	for (const [key, n] of counts) {
		const sound = key.split(':')[0];
		if (!usual.has(sound) || n > counts.get(usual.get(sound))) usual.set(sound, key);
	}
	for (const h of hits) h.lock = usual.get(String(h.sound)) !== `${h.sound}:${h.pitch}:${h.morph}`;
}

// Splits a sound set's patch payloads into { left, right } per sound number. Byte 0 is side (1 or 2) << 4 | sound - 1.
export function soundPatches(payloads) {
	const sounds = {};
	for (const p of payloads) {
		const sound = (p[0] & 0x0f) + 1;
		sounds[sound] ??= {};
		sounds[sound][p[0] >> 4 === 1 ? 'left' : 'right'] = p;
	}
	return sounds;
}

export function toBase64(bytes) {
	return btoa(String.fromCharCode(...bytes));
}

export function fromBase64(text) {
	return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

// Turns a stored sound set into what the player needs: its id plus left and right patches per sound.
export function playableSoundSet(set) {
	return set && { id: set.id, patches: soundPatches(set.sounds.map(fromBase64)) };
}
