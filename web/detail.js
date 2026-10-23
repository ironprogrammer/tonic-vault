import { player, PLAY_ICON, STOP_ICON } from './audio.js';
import { FACTORY_SOUNDS, fromBase64, parsePattern, playableSoundSet } from './pattern.js';
import { isNew, loadVault, saveVault, shortDate } from './vault.js';

const $ = (id) => document.getElementById(id);
const vault = loadVault();
const pattern = vault.patterns.find((p) => p.id === new URLSearchParams(location.search).get('id'));

function save() {
	saveVault(vault);
}

function cell(className, content = '') {
	const span = document.createElement('span');
	span.className = className;
	span.innerHTML = content;
	return span;
}

// Rows for each sound the pattern uses, then accents and effects. Every cell carries data-step for the playhead.
function renderGrid(parsed) {
	const grid = $('grid');
	const row = (label, cells) => grid.append(label, ...cells.map((c, step) => {
		c.dataset.step = step;
		c.classList.toggle('gap', step % 4 === 3 && step < 15);
		return c;
	}));
	grid.replaceChildren();
	row(cell(''), Array.from({ length: 16 }, (_, step) => cell('num', String(step + 1))));
	const sounds = [...new Set(parsed.hits.map((h) => h.sound))].sort((a, b) => a - b);
	for (const sound of sounds) {
		const label = cell('row-label', `<span class="dim tiny">${sound} · ch ${((sound - 1) % 4) + 1}</span><span class="ellipsis">${FACTORY_SOUNDS[sound - 1]}</span>`);
		row(label, Array.from({ length: 16 }, (_, step) => {
			const h = parsed.hits.find((h) => h.sound === sound && h.step === step);
			if (!h) return cell('step');
			return cell('step hit', h.multiplier > 1 ? `<b>${h.multiplier}</b>` : h.lock ? '<b class="dot"></b>' : '');
		}));
	}
	row(cell('row-label rule', 'acc'), parsed.accents.map((on) => cell(`step short rule${on ? ' accent' : ''}`)));
	row(cell('row-label', 'fx'), parsed.effects.map((fx) => cell(`step short${fx ? ' fx' : ''}`)));
}

function showPlayhead(step) {
	for (const node of document.querySelectorAll('#grid [data-step]')) node.classList.toggle('now', Number(node.dataset.step) === step);
}

function renderTags() {
	const input = document.createElement('input');
	input.className = 'chip add';
	input.placeholder = '+ tag';
	input.setAttribute('aria-label', 'add a tag');
	const add = () => {
		const tag = input.value.trim().toLowerCase();
		if (tag && !pattern.tags.includes(tag)) {
			pattern.tags.push(tag);
			save();
		}
		renderTags();
	};
	input.addEventListener('change', add);
	$('tags').replaceChildren(...pattern.tags.map((tag) => {
		const chip = document.createElement('button');
		chip.type = 'button';
		chip.className = 'chip on';
		chip.setAttribute('aria-label', `remove tag ${tag}`);
		chip.textContent = `${tag} ×`;
		chip.addEventListener('click', () => {
			pattern.tags = pattern.tags.filter((t) => t !== tag);
			save();
			renderTags();
		});
		return chip;
	}), input);
}

function setPlayIcon(playing) {
	$('play').innerHTML = playing ? STOP_ICON : PLAY_ICON;
	$('play').setAttribute('aria-label', playing ? 'stop' : 'play pattern');
}

if (!pattern) {
	$('detail').hidden = true;
	$('missing').hidden = false;
} else {
	const parsed = parsePattern(fromBase64(pattern.raw));
	const set = vault.soundSets.find((s) => s.id === pattern.soundSetId);
	const playable = playableSoundSet(set);
	document.title = `Tonic vault ${pattern.name || `slot ${pattern.slot}`}`;
	$('meta').textContent = [`slot ${pattern.slot}`, set ? `sounds ${set.name || shortDate(set.firstSeen)}` : 'sounds missing', shortDate(pattern.firstSeen)].join(' · ');
	$('new').hidden = !isNew(vault, pattern);
	$('name').value = pattern.name;
	$('name').placeholder = `untitled · slot ${pattern.slot}`;
	$('name').addEventListener('change', () => { pattern.name = $('name').value.trim(); save(); });

	// The player reads pattern.bpm and pattern.swing every step, so edits apply while it plays.
	$('bpm').value = pattern.bpm;
	$('swing').value = pattern.swing;
	$('bpm').addEventListener('change', () => {
		pattern.bpm = Math.min(240, Math.max(60, Number($('bpm').value) || pattern.bpm));
		$('bpm').value = pattern.bpm;
		save();
	});
	$('swing').addEventListener('change', () => {
		pattern.swing = Math.min(18, Math.max(0, Math.round(Number($('swing').value)) || 0));
		$('swing').value = pattern.swing;
		save();
	});

	renderGrid(parsed);
	renderTags();
	setPlayIcon(false);
	$('play').disabled = !playable;
	$('no-sounds').hidden = Boolean(playable);
	$('play').addEventListener('click', () => {
		if (player.playing) return player.stop();
		player.play(parsed, playable, pattern, (step) => {
			showPlayhead(step);
			if (step === null) setPlayIcon(false);
		});
		setPlayIcon(true);
	});
	$('delete').addEventListener('click', () => {
		if (!confirm('delete this pattern?')) return;
		player.stop();
		vault.patterns = vault.patterns.filter((p) => p !== pattern);
		save();
		location.href = './';
	});
}
