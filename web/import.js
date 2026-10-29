import { loadDecoder, TAG } from './po32.js';
import { player, PLAY_ICON, STOP_ICON } from './audio.js';
import { fromBase64, parsePattern, playableSoundSet } from './pattern.js';
import { importTransfer, loadVault, patternName, saveVault } from './vault.js';

const $ = (id) => document.getElementById(id);
const decoder = await loadDecoder(await (await fetch('po32.wasm')).arrayBuffer());
const vault = loadVault();
let capture = null;
let waiting = '';
let connection = 'cable';
const GIVE_UP_SECONDS = 30;
const GIVE_UP = {
	cable: 'nothing came through. check the cable, the input above, and tonic volume 16, and close any daw or app using the jack, then listen again.',
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
	// No output device: opening the headset jack's output on a Mac loads the Tonic's signal on the same cable, about 34 dB down.
	const ctx = new AudioContext({ sinkId: { type: 'none' } });
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

// Whether the decoder keeps its lock is the real test, since peaks near 8% have both decoded and lost lock.
// Only clipping, silence, and a faint signal the decoder hasn't locked onto get a hint.
function levelText(peak, synced) {
	const pct = Math.round(peak * 100);
	if (peak > 0.98) return `level ${pct}% · too loud, lower the input level`;
	if (peak < 0.01) return 'no signal';
	if (!synced && peak < 0.05) return `level ${pct}% · faint, check tonic volume 16`;
	return `level ${pct}%`;
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
				$('status').textContent = `lost the signal after ${packets.length} packet${packets.length === 1 ? '' : 's'}, peaking at ${Math.round(loudest * 100)}%. check tonic volume 16 and close any daw or app using the jack, then press write + sound again.`;
				decoder.reset(capture.sampleRate);
				started = 0;
			}
			synced = out.synced;
			packets.push(...out.packets);

			renderMeter(levels);
			renderStages(packets, synced);
			if (started) $('elapsed').textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`;
			$('level').textContent = levelText(Math.max(...levels.slice(-20)), synced);
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

	const skipped = new Set();
	const renderSave = () => {
		const n = result.newPatterns.length - skipped.size;
		$('save').textContent = n ? `import ${n}` : 'save';
	};
	$('name-list').replaceChildren(...result.newPatterns.map((p) => {
		const parsed = parsePattern(fromBase64(p.raw));
		const set = playableSoundSet(draft.soundSets.find((s) => s.id === p.soundSetId));
		const row = document.createElement('div');
		row.className = 'name-row';
		row.innerHTML = `<label class="check"><input type="checkbox" checked aria-label="import slot ${p.slot}"></label><span class="slot"><span class="dim small">slot</span><b>${p.slot}</b></span><input type="text" placeholder="${patternName(p, draft)}" aria-label="name for slot ${p.slot}"><button type="button" class="round" aria-label="play slot ${p.slot}">${PLAY_ICON}</button>`;
		const [box, name] = row.querySelectorAll('input');
		box.addEventListener('change', () => {
			box.checked ? skipped.delete(p.id) : skipped.add(p.id);
			row.classList.toggle('skipped', !box.checked);
			renderSave();
		});
		name.addEventListener('input', (e) => { p.name = e.target.value.trim(); });
		const play = row.querySelector('button');
		play.disabled = !set;
		play.addEventListener('click', () => {
			const on = play.classList.contains('playing');
			player.stop();
			if (on) return;
			player.play(parsed, set, p, (step) => {
				if (step !== null) return;
				play.classList.remove('playing');
				play.innerHTML = PLAY_ICON;
			});
			play.classList.add('playing');
			play.innerHTML = STOP_ICON;
		});
		return row;
	}));
	renderSave();
	$('save').onclick = () => {
		player.stop();
		draft.patterns = draft.patterns.filter((p) => !skipped.has(p.id));
		if (draft.tonic) draft.tonic.slots = draft.tonic.slots.map((id) => (skipped.has(id) ? null : id));
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
$('again').addEventListener('click', () => {
	player.stop();
	$('results').hidden = true;
	listen();
});
showVaultCount();
listInputs();
