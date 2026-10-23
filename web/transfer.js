// Turns the vault's export plan into the packets to send, in the order the Tonic accepts them.

import { TAG } from './po32.js';
import { fromBase64 } from './pattern.js';

// libpo32's default morph pairs, used when the vault has no knob positions for the sounds.
const DEFAULT_KNOBS = new Uint8Array(32).map((_, i) => (i % 2 ? 0x01 : 0x80));

/*
 * Returns { packets, sends } where sends lists the slots and their patterns, and state is null or what the state
 * packet carries. Sounds go first and need at least one pattern and a state packet after them, or the Tonic
 * shows err. Tempo and swing come from the first sent slot's pattern; the chain plays the sent slots in order.
 */
export function exportPackets(vault) {
	const plan = vault.export;
	const sends = plan.slots
		.map((id, i) => ({ slot: i + 1, pattern: vault.patterns.find((p) => p.id === id) }))
		.filter((s) => s.pattern);
	const set = vault.soundSets.find((s) => s.id === plan.soundSetId) ?? null;
	const packets = [];

	if (set) {
		for (const sound of set.sounds) packets.push({ tag: TAG.patch, payload: fromBase64(sound), label: 'sounds' });
	}
	for (const { slot, pattern } of sends) {
		const payload = fromBase64(pattern.raw);
		payload[0] = slot - 1;
		packets.push({ tag: TAG.pattern, payload, label: `slot ${slot}` });
	}

	let state = null;
	if ((set || plan.sendState) && sends.length) {
		const knobsFrom = set ?? vault.soundSets.find((s) => s.id === vault.tonic?.soundSetId);
		const knobs = knobsFrom?.knobs ? fromBase64(knobsFrom.knobs) : DEFAULT_KNOBS;
		state = { tempo: sends[0].pattern.bpm, swing: sends[0].pattern.swing, chain: sends.map((s) => s.slot) };
		const payload = new Uint8Array(35 + state.chain.length);
		payload.set(knobs);
		payload[32] = state.tempo;
		payload[33] = state.swing;
		payload[34] = state.chain.length;
		payload.set(state.chain.map((slot) => slot - 1), 35);
		packets.push({ tag: TAG.state, payload, label: 'tempo, swing, and chain' });
	}
	return { packets, sends, state, valid: sends.length > 0 };
}
