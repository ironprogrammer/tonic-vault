import { loadEncoder } from './po32.js';
import { sendFile, SHARE_ICON, SHARES } from './share.js';
import { toWav } from './wav.js';
import { exportPackets } from './transfer.js';
import { loadVault, patternName, saveVault, shortDate } from './vault.js';

const $ = (id) => document.getElementById(id);
const encoder = await loadEncoder(await (await fetch('po32.wasm')).arrayBuffer());
let vault = loadVault();
let picking = null;
let sending = null;

const plan = () => vault.export;
const byId = (id) => vault.patterns.find((p) => p.id === id);

function save() {
	saveVault(vault);
	render();
}

function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v);
	}
	node.append(...children);
	return node;
}

// Drops ids for patterns deleted since they were added, so a stale plan can't send nothing to a slot.
function prune() {
	plan().slots = plan().slots.map((id) => (byId(id) ? id : null));
	plan().pending = plan().pending.filter(byId);
	if (!vault.soundSets.some((s) => s.id === plan().soundSetId)) plan().soundSetId = null;
}

// A slot tap places the next pattern waiting for a slot, or opens the pattern list for that slot.
function tapSlot(slot) {
	if (plan().pending.length) {
		plan().slots[slot - 1] = plan().pending.shift();
		save();
	} else {
		picking = slot;
		render();
		$('picker').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}
}

function renderSlots() {
	const onTonic = vault.tonic?.slots ?? [];
	$('slots').replaceChildren(...plan().slots.map((id, i) => {
		const pattern = byId(id);
		const was = byId(onTonic[i]);
		const lines = pattern
			? [patternName(pattern, vault), was && was.id !== pattern.id ? `was ${patternName(was, vault)}` : '']
			: [was ? patternName(was, vault) : '', ''];
		return el('button', {
			type: 'button',
			class: `slot${pattern ? ' filled' : ''}${picking === i + 1 ? ' picking' : ''}`,
			'aria-label': `slot ${i + 1}${pattern ? `, ${lines[0]}` : ', not sent'}`,
			onclick: () => tapSlot(i + 1),
		}, el('span', { class: 'n' }, String(i + 1)), el('span', { class: 'name' }, lines[0]), el('span', { class: 'was' }, lines[1]));
	}));
	const n = plan().slots.filter(Boolean).length;
	$('slot-count').textContent = `${n} of 16 · tap a slot to pick`;

	const next = byId(plan().pending[0]);
	$('pending').hidden = !next;
	if (next) $('pending-label').textContent = `slot ${next.slot} is taken. tap a slot for ${patternName(next, vault)}${plan().pending.length > 1 ? ` (${plan().pending.length - 1} more)` : ''}.`;
}

function renderPicker() {
	$('picker').hidden = !picking;
	if (!picking) return;
	const current = plan().slots[picking - 1];
	$('picker-title').textContent = `slot ${picking}`;
	const choose = (id) => {
		plan().slots[picking - 1] = id;
		picking = null;
		save();
	};
	const patterns = [...vault.patterns].sort((a, b) => patternName(a, vault).localeCompare(patternName(b, vault), undefined, { numeric: true }));
	$('picker-list').replaceChildren(
		el('button', { type: 'button', class: `pick-row${current ? '' : ' on'}`, onclick: () => choose(null) }, el('span', {}, 'leave empty'), el('span', { class: 'dim small' }, 'the tonic keeps its pattern')),
		...patterns.map((p) => el('button', { type: 'button', class: `pick-row${p.id === current ? ' on' : ''}`, onclick: () => choose(p.id) },
			el('span', { class: 'ellipsis' }, patternName(p, vault)),
			el('span', { class: 'dim small' }, `slot ${p.slot} · ${p.bpm} · sw ${p.swing}${plan().slots.includes(p.id) && p.id !== current ? ' · in export' : ''}`))),
	);
}

function setName(set) {
	return set.name || `unnamed · ${shortDate(set.firstSeen)}`;
}

function renderOptions(result) {
	const sets = vault.soundSets;
	$('sound-set').replaceChildren(...sets.map((s) => new Option(setName(s), s.id)));
	$('sounds').disabled = !sets.length;
	$('sounds').checked = Boolean(plan().soundSetId);
	$('sound-set').disabled = !plan().soundSetId;
	const set = sets.find((s) => s.id === plan().soundSetId);
	if (set) $('sound-set').value = set.id;
	const count = (set ?? sets[0])?.sounds.length / 2;
	$('sounds-note').textContent = count ? `replaces sounds 1–${count}` : 'no sounds in the vault';

	$('state').checked = Boolean(set) || plan().sendState;
	$('state').disabled = Boolean(set);
	const { state } = result;
	$('state-note').textContent = state
		? `chain ${state.chain.join(' → ')}${set ? ' · required with sounds' : ''}`
		: 'leaves the tonic\'s tempo, swing, and chain';
	$('state-value').textContent = state ? `${state.tempo} · ${state.swing}` : '';
}

function render() {
	prune();
	const result = exportPackets(vault);
	renderSlots();
	renderPicker();
	renderOptions(result);
	$('send').disabled = !result.valid || Boolean(sending);
	$('download').disabled = !result.valid;
	if (!sending) $('send-note').textContent = result.valid ? '' : 'pick at least one pattern to send.';
}

function download() {
	const { packets } = exportPackets(vault);
	const { samples } = encoder.render(packets, 48000);
	sendFile(new File([toWav(samples.map((s) => s * 0.7), 48000)], `tonic-export-${new Date().toISOString().slice(0, 10)}.wav`, { type: 'audio/wav' }));
}

// Plays the transfer out of the default output, about -3 dB, with progress per packet.
async function send() {
	const { packets } = exportPackets(vault);
	const ctx = new AudioContext();
	const { samples, starts } = encoder.render(packets, ctx.sampleRate);
	const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
	buffer.copyToChannel(samples, 0);
	const source = ctx.createBufferSource();
	const gain = ctx.createGain();
	gain.gain.value = 0.7;
	source.buffer = buffer;
	source.connect(gain).connect(ctx.destination);
	await ctx.resume();
	const startedAt = ctx.currentTime + 0.1;
	source.start(startedAt);
	sending = { ctx, source, stopped: false };

	$('sending').hidden = false;
	$('sending-title').textContent = 'sending';
	$('stop').hidden = false;
	render();
	const patterns = packets.filter((p) => p.label.startsWith('slot')).length;
	const tick = () => {
		if (!sending) return;
		const t = Math.max(0, ctx.currentTime - startedAt);
		const fraction = Math.min(1, t / buffer.duration);
		const index = starts.findLastIndex((s) => s <= fraction);
		const packet = packets[Math.max(0, index)];
		const nth = packets.slice(0, index + 1).filter((p) => p.label.startsWith('slot')).length;
		$('sending-time').textContent = `${t.toFixed(1)} / ${buffer.duration.toFixed(1)}s`;
		$('sending-now').textContent = packet.label.startsWith('slot') ? `pattern ${nth} of ${patterns} → ${packet.label}` : packet.label;
		$('progress').replaceChildren(...Array.from({ length: 16 }, (_, i) => el('span', { class: i < Math.round(fraction * 16) ? 'on' : '' })));
		requestAnimationFrame(tick);
	};
	tick();
	source.onended = () => {
		const stopped = sending?.stopped;
		sending = null;
		ctx.close();
		$('stop').hidden = true;
		$('sending-title').textContent = stopped ? 'stopped' : 'sent';
		$('sending-now').textContent = stopped
			? 'the tonic will show err. press acc + sound to try again.'
			: 'the tonic shows end when it worked, or err if not.';
		render();
	};
}

function showConnection(kind) {
	for (const b of document.querySelectorAll('[data-connection]')) b.setAttribute('aria-pressed', String(b.dataset.connection === kind));
	for (const p of document.querySelectorAll('[data-for]')) p.hidden = p.dataset.for !== kind;
	try {
		localStorage.setItem('tonic-vault-send-connection', kind);
	} catch {}
}

for (const b of document.querySelectorAll('[data-connection]')) b.addEventListener('click', () => showConnection(b.dataset.connection));
try {
	showConnection(localStorage.getItem('tonic-vault-send-connection') || 'cable');
} catch {
	showConnection('cable');
}

$('sounds').addEventListener('change', () => {
	const tonicSet = vault.soundSets.find((s) => s.id === vault.tonic?.soundSetId);
	plan().soundSetId = $('sounds').checked ? (tonicSet ?? vault.soundSets[0]).id : null;
	save();
});
$('sound-set').addEventListener('change', () => {
	plan().soundSetId = $('sound-set').value;
	save();
});
$('state').addEventListener('change', () => {
	plan().sendState = $('state').checked;
	save();
});
$('picker-close').addEventListener('click', () => {
	picking = null;
	render();
});
$('pending-skip').addEventListener('click', () => {
	plan().pending.shift();
	save();
});
$('send').addEventListener('click', send);
$('stop').addEventListener('click', () => {
	sending.stopped = true;
	sending.source.stop();
});
if (SHARES) {
	$('download').innerHTML = `${SHARE_ICON}.wav`;
	$('download').setAttribute('aria-label', 'share backup .wav');
}
$('download').addEventListener('click', download);
addEventListener('pageshow', (e) => {
	if (!e.persisted) return;
	vault = loadVault();
	render();
});
render();
