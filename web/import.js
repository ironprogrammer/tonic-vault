import { loadDecoder, TAG } from './po32.js';
import { importTransfer, loadVault, patternName, saveVault } from './vault.js';

const $ = (id) => document.getElementById(id);
const decoder = await loadDecoder(await (await fetch('po32.wasm')).arrayBuffer());
const vault = loadVault();
let capture = null;
let waiting = '';
let connection = 'cable';
const GIVE_UP_SECONDS = 30;
const GIVE_UP = {
	cable: 'nothing came through. check the cable is in the tonic\'s line out, the input above, and that the tonic\'s volume is 16, then listen again.',
	air: 'nothing came through. hold the tonic closer to the mic, set its volume to 16, keep the room quiet, then listen again.',
};

function showVaultCount() {
	const n = vault.patterns.length;
	$('vault-count').textContent = `${n} pattern${n === 1 ? '' : 's'}`;
}

// Lists audio inputs. Labels only appear once the page has microphone permission.
async function listInputs() {
	const devices = await navigator.mediaDevices.enumerateDevices();
	const select = $('input');
	const current = select.value;
	select.replaceChildren(new Option('default input', ''));
	for (const d of devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')) {
		select.add(new Option(d.label || 'input', d.deviceId));
	}
	select.value = current || savedInput();
	if (select.selectedIndex < 0) select.value = '';
}

function savedInput() {
	try {
		return localStorage.getItem('tonic-vault-input') || '';
	} catch {
		return '';
	}
}

// Opens the chosen input with browser processing off, since echo cancellation and gain control mangle the modem signal.
async function startCapture(onSamples) {
	const deviceId = $('input').value;
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: {
			deviceId: deviceId ? { exact: deviceId } : undefined,
			echoCancellation: false,
			noiseSuppression: false,
			autoGainControl: false,
			channelCount: 1,
		},
	});
	const ctx = new AudioContext();
	await ctx.audioWorklet.addModule('capture-worklet.js');
	const node = new AudioWorkletNode(ctx, 'capture');
	node.port.onmessage = (e) => onSamples(e.data);
	ctx.createMediaStreamSource(stream).connect(node);
	return {
		label: stream.getAudioTracks()[0]?.label || 'the input',
		sampleRate: ctx.sampleRate,
		stop() {
			stream.getTracks().forEach((t) => t.stop());
			ctx.close();
		},
	};
}

function renderStages(packets, synced) {
	const count = (tag) => packets.filter((p) => p.tag === tag).length;
	const sounds = count(TAG.patch) / 2;
	const patterns = count(TAG.pattern);
	const state = count(TAG.state);
	const rows = [
		['sync', synced || packets.length ? 1 : 0, synced || packets.length ? '✓' : '–'],
		['sounds', sounds / 16, `${Math.floor(sounds)}/16`],
		['patterns', patterns / 16, `${patterns}/16`],
		['state', state, state ? '✓' : '–'],
	];
	$('stages').replaceChildren(...rows.map(([label, pct, text]) => {
		const row = document.createElement('div');
		row.className = 'stage';
		row.innerHTML = `<span>${label}</span><span class="bar"><span style="width:${Math.min(pct, 1) * 100}%"></span></span><span class="count">${text}</span>`;
		return row;
	}));
}

// Bars are peak levels, scaled so half of full scale fills the meter.
function renderMeter(levels) {
	$('meter').replaceChildren(...levels.map((v) => {
		const bar = document.createElement('span');
		bar.style.height = `${Math.min(1, v * 2) * 100}%`;
		return bar;
	}));
}

// Transfers decoded reliably with peaks around 15% and up; 8% lost the signal partway.
function levelText(peak) {
	const pct = Math.round(peak * 100);
	if (peak > 0.98) return `level ${pct}% · too loud, lower the volume`;
	if (peak < 0.01) return 'no signal';
	if (peak < 0.12) return `level ${pct}% · low, raise the volume`;
	return `level ${pct}% · ok`;
}

async function listen() {
	$('listen').disabled = true;
	$('listen').textContent = 'listening…';
	$('listen-note').textContent = '';
	$('results').hidden = true;
	let packets = [];
	let synced = false;
	let levels = Array(48).fill(0);
	let started = 0;
	let batches = 0;
	let lastSynced = 0;
	let loudest = 0;

	try {
		capture = await startCapture((samples) => {
			let peak = 0;
			for (const s of samples) peak = Math.max(peak, Math.abs(s));
			levels = [...levels.slice(1), peak];

			const out = decoder.push(samples);
			if (out.synced && !synced) {
				started = performance.now();
				packets = [];
				$('status').textContent = 'receiving';
			}
			if (synced && !out.synced && !out.done) {
				$('status').textContent = `lost the signal after ${packets.length} packet${packets.length === 1 ? '' : 's'}, peaking at ${Math.round(loudest * 100)}%. check the tonic's volume is 16, then press write + sound again.`;
				decoder.reset(capture.sampleRate);
				started = 0;
			}
			synced = out.synced;
			packets.push(...out.packets);

			renderMeter(levels);
			renderStages(packets, synced);
			if (started) $('elapsed').textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`;
			$('level').textContent = levelText(Math.max(...levels.slice(-20)));
			batches++;
			if (synced) {
				lastSynced = batches;
				loudest = Math.max(loudest, peak);
			}
			if (!synced && !packets.length) $('status').textContent = batches > levels.length && levels.every((v) => v < 0.01) ? `no signal from ${capture?.label}. cancel, pick the input the cable is in, and listen again.` : waiting;
			if (out.done) finish(packets);
			else if (!synced && (batches - lastSynced) * samples.length / capture.sampleRate > GIVE_UP_SECONDS) {
				const lost = $('status').textContent;
				stopListening();
				$('listen-note').textContent = packets.length ? lost : GIVE_UP[connection];
			}
		});
	} catch (err) {
		$('listen').disabled = false;
		alert(`couldn't open the input: ${err.message}`);
		return;
	}
	await listInputs();
	decoder.reset(capture.sampleRate);
	waiting = `waiting for the tonic on ${capture.label}…`;
	$('status').textContent = waiting;
	$('elapsed').textContent = '0.0s';
	renderStages([], false);
	$('receiving').hidden = false;
	$('receiving').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function stopListening() {
	capture?.stop();
	capture = null;
	$('receiving').hidden = true;
	$('listen').disabled = false;
	$('listen').textContent = 'start listening';
}

// options: done (false when the audio ended mid-transfer), fromTonic, and setName, as importTransfer takes them.
async function finish(packets, { done = true, ...options } = {}) {
	stopListening();
	const draft = structuredClone(vault);
	const result = await importTransfer(draft, packets, undefined, options);

	$('new-count').textContent = result.newPatterns.length;
	$('known-count').textContent = result.knownPatterns.length;
	$('sounds-mark').textContent = result.soundSet ? (result.newSoundSet ? '+' : '=') : '–';
	$('sounds-label').textContent = result.soundSet ? (result.newSoundSet ? 'new sounds' : `sounds ${result.soundSet.name || 'known'}`) : 'no sounds';
	const notes = [];
	if (!done) notes.push(`the audio ended before the transfer finished, so only ${packets.length} packets came through.`);
	if (result.state) notes.push(`${options.fromTonic === false ? 'the file' : 'the tonic'} was at ${result.state.tempo} bpm · swing ${result.state.swing}; saved with each new pattern.`);
	if (result.movedPatterns.length) notes.push(`${result.movedPatterns.length} known pattern${result.movedPatterns.length === 1 ? '' : 's'} changed slots.`);
	$('results-note').textContent = notes.join(' ');

	$('name-list').replaceChildren(...result.newPatterns.map((p) => {
		const row = document.createElement('label');
		row.className = 'name-row';
		row.innerHTML = `<span class="slot"><span class="dim small">slot</span><b>${p.slot}</b></span><input type="text" placeholder="${patternName(p, draft)}" aria-label="name for slot ${p.slot}">`;
		row.querySelector('input').addEventListener('input', (e) => { p.name = e.target.value.trim(); });
		return row;
	}));
	$('save').textContent = result.newPatterns.length ? `save ${result.newPatterns.length} to vault` : 'save';
	$('save').onclick = () => {
		saveVault(draft);
		location.href = './';
	};
	$('results').hidden = false;
	$('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Decodes a transfer saved as audio, such as a TE sound pack's data .wav. A pack's file name names its sound set.
async function importFile(file) {
	$('file-status').textContent = `reading ${file.name}…`;
	try {
		const ctx = new OfflineAudioContext(1, 1, 48000);
		const audio = await ctx.decodeAudioData(await file.arrayBuffer());
		decoder.reset(audio.sampleRate);
		const out = decoder.push(audio.getChannelData(0));
		if (!out.packets.length) throw new Error('no tonic data found in it');
		$('file-status').textContent = '';
		const setName = file.name.replace(/\.wav$/i, '').replace(/po-?32/i, '').replace(/[-_ ]*data$/i, '').replace(/_/g, ' ').replace(/^[-\s]+|[-\s]+$/g, '');
		await finish(out.packets, { done: out.done, fromTonic: false, setName });
	} catch (err) {
		$('file-status').textContent = `couldn't import ${file.name}: ${err.message}`;
	}
}

$('file').addEventListener('change', (e) => {
	if (e.target.files[0]) importFile(e.target.files[0]);
	e.target.value = '';
});

// Cable or over the air only changes the setup hints. The choice is remembered per browser.
function showConnection(kind) {
	connection = kind;
	for (const b of document.querySelectorAll('[data-connection]')) b.setAttribute('aria-pressed', String(b.dataset.connection === kind));
	for (const p of document.querySelectorAll('[data-for]')) p.hidden = p.dataset.for !== kind;
	try {
		localStorage.setItem('tonic-vault-connection', kind);
	} catch {}
}

for (const b of document.querySelectorAll('[data-connection]')) b.addEventListener('click', () => showConnection(b.dataset.connection));
try {
	showConnection(localStorage.getItem('tonic-vault-connection') || 'cable');
} catch {
	showConnection('cable');
}

$('input').addEventListener('change', (e) => {
	try {
		localStorage.setItem('tonic-vault-input', e.target.value);
	} catch {}
});
$('listen').addEventListener('click', listen);
$('cancel').addEventListener('click', stopListening);
$('again').addEventListener('click', () => { $('results').hidden = true; listen(); });
showVaultCount();
listInputs();
