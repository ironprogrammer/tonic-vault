// Plays patterns and single sounds through Web Audio. Each hit is rendered once by libpo32's synth and cached.

import { barHits, swingDelay } from './pattern.js';

const LOOKAHEAD = 0.12;
const HIT_SECONDS = 2.5;

// Each of the Tonic's four channels plays one sound at a time, so a new hit cuts off the last one on its channel.
function startOn(ctx, destination, voices, buffer, channel, when) {
	const prev = voices[channel];
	if (prev) {
		prev.gain.gain.setTargetAtTime(0, when, 0.004);
		prev.source.stop(when + 0.03);
	}
	const source = ctx.createBufferSource();
	const gain = ctx.createGain();
	source.buffer = buffer;
	source.connect(gain).connect(destination);
	source.start(when);
	voices[channel] = { source, gain };
}

export function createPlayer(synth) {
	let ctx = null;
	let master = null;
	let timer = 0;
	let frame = 0;
	let onStop = null;
	let idle = 0;
	const cache = new Map();
	const voices = [];

	// Browsers only allow audio to start from a tap, so the context is made on first use.
	function context() {
		clearTimeout(idle);
		if (!ctx) {
			ctx = new AudioContext();
			master = ctx.createGain();
			master.gain.value = 0.6;
			master.connect(ctx.destination);
		}
		ctx.resume();
		return ctx;
	}

	function hitBuffer(soundSet, sound, morph, accent, sampleRate = ctx.sampleRate) {
		const key = `${soundSet.id}:${sound}:${morph}:${accent}:${sampleRate}`;
		if (!cache.has(key)) {
			const { left, right } = soundSet.patches[sound];
			const samples = synth.render(left, right, { sampleRate, morph: morph / 255, velocity: accent ? 127 : 100, seconds: HIT_SECONDS });
			let end = samples.length;
			while (end > 1 && Math.abs(samples[end - 1]) < 1e-4) end--;
			const buffer = new AudioBuffer({ length: end, sampleRate });
			buffer.copyToChannel(samples.subarray(0, end), 0);
			cache.set(key, buffer);
		}
		return cache.get(key);
	}

	// Closes the context once playback ends. An open one holds the output device, and a Mac's headset jack carrying
	// the Tonic's line out reads about 34 dB quieter while its output is held.
	function releaseAfter(seconds) {
		clearTimeout(idle);
		idle = setTimeout(() => {
			ctx.close();
			ctx = null;
		}, seconds * 1000);
	}

	function start(buffer, channel, when) {
		startOn(ctx, master, voices, buffer, channel, when);
	}

	function stop() {
		clearInterval(timer);
		cancelAnimationFrame(frame);
		timer = 0;
		if (ctx) {
			for (const v of voices.splice(0)) if (v) {
				v.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
				v.source.stop(ctx.currentTime + 0.06);
			}
			releaseAfter(0.2);
		}
		const done = onStop;
		onStop = null;
		done?.();
	}

	return {
		get playing() {
			return timer !== 0;
		},

		stop,

		// Stops and releases the output device now rather than after a pause.
		close() {
			stop();
			clearTimeout(idle);
			ctx?.close();
			ctx = null;
		},

		// Starts a context that a touch made but couldn't start, since iOS only lets a tap's end start audio.
		resume() {
			ctx?.resume();
		},

		// Plays one sound at the given morph value (0-255).
		audition(soundSet, sound, morph = 0) {
			stop();
			context();
			const buffer = hitBuffer(soundSet, sound, morph, false);
			start(buffer, 0, ctx.currentTime + 0.01);
			releaseAfter(buffer.duration + 0.2);
		},

		/*
		 * Loops a parsed pattern until stop(). timing is { bpm, swing } and is read every step, so edits apply live.
		 * onStep gets the step index as it sounds, then null on stop.
		 * Swing and multiplier timing come from barHits.
		 */
		play(pattern, soundSet, timing, onStep = () => {}) {
			stop();
			context();
			const hits = pattern.hits.filter((h) => soundSet.patches[h.sound]?.right);
			for (const h of hits) hitBuffer(soundSet, h.sound, h.morph, h.accent);

			const queue = [];
			let step = 0;
			let next = ctx.currentTime + 0.05;
			const schedule = () => {
				while (next < ctx.currentTime + LOOKAHEAD) {
					const length = 60 / timing.bpm / 4;
					for (const { hit, time } of barHits(hits, timing.swing)) {
						if (Math.floor(time) === step) start(hitBuffer(soundSet, hit.sound, hit.morph, hit.accent), hit.lane, next + (time - step) * length);
					}
					queue.push({ step, at: next + swingDelay(step, timing.swing) * length });
					next += length;
					step = (step + 1) % 16;
				}
			};
			const draw = () => {
				while (queue.length && queue[0].at <= ctx.currentTime) onStep(queue.shift().step);
				frame = requestAnimationFrame(draw);
			};
			schedule();
			timer = setInterval(schedule, 25);
			frame = requestAnimationFrame(draw);
			onStop = () => onStep(null);
		},

		/*
		 * Renders bars of a parsed pattern offline: mono samples at sampleRate, peaking at 0.9, with the last hits rung out.
		 * Repeats that wrap past a bar play at the start of the next one, as they do when the pattern loops.
		 */
		async render(pattern, soundSet, timing, bars = 4, sampleRate = 48000) {
			const length = 60 / timing.bpm / 4;
			const hits = pattern.hits.filter((h) => soundSet.patches[h.sound]?.right);
			const events = [];
			for (let bar = 0; bar < bars; bar++) {
				for (const e of barHits(hits, timing.swing)) events.push({ ...e, at: ((bar + (e.wrapped ? 1 : 0)) * 16 + e.time) * length });
			}
			events.sort((a, b) => a.at - b.at);
			const loop = Math.round(bars * 16 * length * sampleRate);
			const offline = new OfflineAudioContext(1, loop + HIT_SECONDS * sampleRate, sampleRate);
			const voices = [];
			for (const e of events) {
				startOn(offline, offline.destination, voices, hitBuffer(soundSet, e.hit.sound, e.hit.morph, e.hit.accent, sampleRate), e.hit.lane, e.at);
			}
			const samples = (await offline.startRendering()).getChannelData(0);
			let end = samples.length;
			while (end > loop && Math.abs(samples[end - 1]) < 1e-4) end--;
			const peak = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0) || 1;
			return samples.subarray(0, end).map((s) => (s * 0.9) / peak);
		},
	};
}
