import { player, PLAY_ICON, STOP_ICON } from './audio.js';
import { fromBase64, parsePattern, playableSoundSet } from './pattern.js';
import { addToExport, emptyVault, isNew, loadVault, patternName, saveVault, shortDate, upgradeVault } from './vault.js';

const $ = (id) => document.getElementById(id);
let vault = loadVault();
const FILTER_KEY = 'tonic-vault-filter';
const SEARCH_KEY = 'tonic-vault-search';
let filter = readFilter();
let search = readStored(SEARCH_KEY);
let hearSetId = null;
let playingId = null;
const selected = new Set();

function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
		else if (k === 'html') node.innerHTML = v;
		else node.setAttribute(k, v);
	}
	node.append(...children);
	return node;
}

// The pattern filter is remembered per browser. Storage can be unavailable, so it falls back to all.
function readFilter() {
	try {
		return localStorage.getItem(FILTER_KEY) || 'all';
	} catch {
		return 'all';
	}
}

function readStored(key) {
	try {
		return localStorage.getItem(key) || '';
	} catch {
		return '';
	}
}

function setSearch(text) {
	search = text;
	try {
		localStorage.setItem(SEARCH_KEY, text);
	} catch {}
	renderPatterns();
}

function setFilter(key) {
	filter = key;
	try {
		localStorage.setItem(FILTER_KEY, key);
	} catch {}
	render();
}

function setName(set) {
	return set.name || `unnamed · ${shortDate(set.firstSeen)}`;
}

// One sound set at a time fills the 4×4 grid to hear. It starts on the set last seen on the Tonic.
function renderKit() {
	const set = vault.soundSets.find((s) => s.id === hearSetId)
		?? vault.soundSets.find((s) => s.id === vault.tonic?.soundSetId)
		?? vault.soundSets[0];
	hearSetId = set?.id ?? null;
	if (!set) return;
	const playable = playableSoundSet(set);
	$('kit').replaceChildren(...Array.from({ length: 16 }, (_, i) => {
		const name = set.soundNames[i];
		const button = el('button', {
			type: 'button',
			class: name ? 'named' : '',
			'aria-label': `hear sound ${i + 1}${name ? `, ${name}` : ''}`,
			onclick: () => player.audition(playable, i + 1),
		}, ...(name ? [el('span', { class: 'dim tiny' }, String(i + 1)), el('span', { class: 'ellipsis' }, name)] : [String(i + 1)]));
		button.disabled = !playable.patches[i + 1]?.right;
		return button;
	}));
}

function stepStrip(parsed) {
	return el('div', { class: 'strip' }, ...Array.from({ length: 16 }, (_, step) => {
		const hit = parsed.hits.some((h) => h.step === step);
		return el('span', { class: hit ? (parsed.accents[step] ? 'accent' : 'hit') : '' });
	}));
}

function renderFilters() {
	const newCount = vault.patterns.filter((p) => isNew(vault, p)).length;
	const tags = [...new Set(vault.patterns.flatMap((p) => p.tags))].sort();
	const chips = [['all', 'all'], ...(newCount ? [['new', `new ${newCount}`]] : []), ...tags.map((t) => [`#${t}`, t])];
	if (!chips.some(([key]) => key === filter)) filter = 'all';
	$('filters').replaceChildren(...chips.map(([key, label]) => el('button', {
		type: 'button',
		class: `chip${key === filter ? ' on' : ''}`,
		onclick: () => setFilter(key),
	}, label)));
}

function visiblePatterns() {
	const words = search.toLowerCase().split(/\s+/).filter(Boolean);
	const list = vault.patterns.filter((p) =>
		(filter === 'all' || (filter === 'new' ? isNew(vault, p) : p.tags.includes(filter.slice(1))))
		&& words.every((w) => patternName(p, vault).toLowerCase().includes(w)));
	return list.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || a.slot - b.slot);
}

// The list re-renders while a pattern plays, so the playing pattern is tracked by id rather than by button.
function playButton(pattern, parsed) {
	const set = playableSoundSet(vault.soundSets.find((s) => s.id === pattern.soundSetId));
	const on = playingId === pattern.id;
	const button = el('button', { type: 'button', class: `round${on ? ' playing' : ''}`, 'aria-label': `${on ? 'stop' : 'play'} ${patternName(pattern, vault)}`, html: on ? STOP_ICON : PLAY_ICON });
	button.disabled = !set;
	button.addEventListener('click', () => {
		if (on) return player.stop();
		player.play(parsed, set, pattern, (step) => {
			if (step !== null) return;
			playingId = null;
			renderPatterns();
		});
		playingId = pattern.id;
		renderPatterns();
	});
	return button;
}

function renderPatterns() {
	const rows = visiblePatterns().map((p) => {
		const parsed = parsePattern(fromBase64(p.raw));
		const meta = [`slot ${p.slot}`, shortDate(p.firstSeen), ...p.tags].join(' · ');
		const box = el('input', { type: 'checkbox', 'aria-label': `select ${patternName(p, vault)}` });
		box.checked = selected.has(p.id);
		box.addEventListener('change', () => {
			box.checked ? selected.add(p.id) : selected.delete(p.id);
			render();
		});
		return el('div', { class: `pattern-row${selected.has(p.id) ? ' selected' : ''}` },
			el('label', { class: 'check' }, box),
			el('a', { href: `pattern.html?id=${p.id}`, class: 'pattern-link' },
				el('span', { class: 'split' }, el('span', { class: 'name ellipsis' }, patternName(p, vault)), el('span', { class: 'dim small' }, `${p.bpm} · sw ${p.swing}`)),
				stepStrip(parsed),
				el('span', { class: 'meta dim small' }, meta, ...(isNew(vault, p) ? [el('span', { class: 'badge' }, 'new')] : []))),
			playButton(p, parsed));
	});
	$('patterns').replaceChildren(...rows);
	$('empty').hidden = vault.patterns.length > 0;
	$('no-match').hidden = !vault.patterns.length || rows.length > 0;
}

function renderSets() {
	$('sets-section').hidden = !vault.soundSets.length;
	$('sets').replaceChildren(...vault.soundSets.map((set) => {
		const used = vault.patterns.filter((p) => p.soundSetId === set.id).length;
		const name = el('input', { type: 'text', class: 'inline-name', placeholder: setName(set), 'aria-label': 'sound set name' });
		name.value = set.name;
		name.addEventListener('change', () => { set.name = name.value.trim(); save(); });
		const onTonic = set.id === vault.tonic?.soundSetId;
		const hearing = set.id === hearSetId;
		return el('div', { class: `set-row${hearing ? ' selected' : ''}` },
			el('div', { class: 'grow' }, name, el('span', { class: 'meta dim small' }, `${set.sounds.length / 2} sounds · ${used} pattern${used === 1 ? '' : 's'} · ${shortDate(set.lastSeen)}`, ...(onTonic ? [el('span', { class: 'badge' }, 'last on tonic')] : []))),
			el('button', {
				type: 'button',
				class: `chip${hearing ? ' on' : ''}`,
				'aria-pressed': String(hearing),
				onclick: () => { hearSetId = set.id; render(); },
			}, 'hear'),
			el('button', {
				type: 'button',
				class: 'square',
				'aria-label': `delete sounds ${setName(set)}`,
				html: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v5M9.5 6.5v5"/></svg>',
				onclick: () => {
					if (!confirm(`delete sounds ${setName(set)}?${used ? ` ${used} pattern${used === 1 ? '' : 's'} use them and won't play.` : ''}`)) return;
					vault.soundSets = vault.soundSets.filter((s) => s !== set);
					save();
				},
			}));
	}));
}

function renderSelection() {
	$('selection').hidden = !selected.size;
	$('selection-label').textContent = `${selected.size} selected`;
}

function render() {
	const n = vault.patterns.length;
	$('vault-count').textContent = `${n} pattern${n === 1 ? '' : 's'}`;
	const queued = vault.export.slots.filter(Boolean).length;
	$('export-count').textContent = queued ? ` · ${queued} ready` : '';
	renderFilters();
	renderPatterns();
	renderKit();
	renderSets();
	renderSelection();
}

function save() {
	saveVault(vault);
	render();
}

function downloadVault() {
	const blob = new Blob([JSON.stringify(vault, null, '\t')], { type: 'application/json' });
	const a = el('a', { href: URL.createObjectURL(blob), download: `tonic-vault-${new Date().toISOString().slice(0, 10)}.json` });
	a.click();
	URL.revokeObjectURL(a.href);
}

// Replaces the vault with a saved .json, after a confirm, since the current one is lost unless saved first.
async function loadFile(file) {
	try {
		const loaded = { ...emptyVault(), ...JSON.parse(await file.text()) };
		if (!Array.isArray(loaded.patterns) || !Array.isArray(loaded.soundSets)) throw new Error('not a vault file');
		upgradeVault(loaded);
		if (!confirm(`replace this vault (${vault.patterns.length} patterns) with ${file.name} (${loaded.patterns.length} patterns)?`)) return;
		vault = loaded;
		selected.clear();
		save();
	} catch (err) {
		alert(`couldn't load ${file.name}: ${err.message}`);
	}
}

$('search').value = search;
$('search').addEventListener('input', (e) => setSearch(e.target.value));
$('download').addEventListener('click', downloadVault);
$('load').addEventListener('change', (e) => {
	if (e.target.files[0]) loadFile(e.target.files[0]);
	e.target.value = '';
});
$('add-selected').addEventListener('click', () => {
	addToExport(vault, [...selected]);
	saveVault(vault);
	location.href = 'export.html';
});
$('delete-selected').addEventListener('click', () => {
	if (!confirm(`delete ${selected.size} pattern${selected.size === 1 ? '' : 's'}?`)) return;
	player.stop();
	vault.patterns = vault.patterns.filter((p) => !selected.has(p.id));
	selected.clear();
	save();
});
// Browser back can restore this page from memory, so re-read the vault in case another page changed it.
addEventListener('pageshow', (e) => {
	if (!e.persisted) return;
	vault = loadVault();
	render();
});
render();
