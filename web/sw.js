/*
 * Keeps the app working offline. Every request goes to the network first and refreshes the cache,
 * so an update never mixes old and new modules; the cache only answers when the network fails.
 */
const CACHE = 'tonic-vault';
const SHELL = [
	'./', 'index.html', 'import.html', 'export.html', 'pattern.html', 'style.css', 'manifest.webmanifest',
	'audio.js', 'capture-worklet.js', 'detail.js', 'exporter.js', 'import.js', 'library.js', 'midi.js', 'pattern.js',
	'player.js', 'po32.js', 'share.js', 'po32.wasm', 'transfer.js', 'vault.js', 'wav.js',
	'icons/app.svg', 'icons/app-192.png', 'icons/apple-touch-icon.png', 'icons/key-held.svg', 'icons/key-pressed.svg',
];

self.addEventListener('install', (e) => {
	e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
	if (e.request.method !== 'GET') return;
	e.respondWith(fetch(e.request).then((res) => {
		if (res.ok || res.type === 'opaque') {
			const copy = res.clone();
			caches.open(CACHE).then((cache) => cache.put(e.request, copy));
		}
		return res;
	}).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
