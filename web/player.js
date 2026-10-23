// Plays patterns and single sounds through Web Audio. Each hit is rendered once by libpo32's synth and cached.

const LOOKAHEAD = 0.12;
const HIT_SECONDS = 2.5;

export function createPlayer(synth) {
	let ctx = null;
	let master = null;
	let timer = 0;
	let frame = 0;
	let onStop = null;
	const cache = new Map();
	const voices = [];

	// Browsers only allow audio to start from a tap, so the context is made on first use.
	function context() {
		if (!ctx) {
			ctx = new AudioContext();
			master = ctx.createGain();
			master.gain.value = 0.6;
			master.connect(ctx.destination);
		}
		ctx.resume();
		return ctx;
	}

	function hitBuffer(soundSet, sound, morph, accent) {
		const key = `${soundSet.id}:${sound}:${morph}:${accent}`;
		if (!cache.has(key)) {
			const { left, right } = soundSet.patches[sound];
			const samples = synth.render(left, right, { sampleRate: ctx.sampleRate, morph: morph / 255, velocity: accent ? 127 : 100, seconds: HIT_SECONDS });
			let end = samples.length;
			while (end > 1 && Math.abs(samples[end - 1]) < 1e-4) end--;
			const buffer = ctx.createBuffer(1, end, ctx.sampleRate);
			buffer.copyToChannel(samples.subarray(0, end), 0);
			cache.set(key, buffer);
		}
		return cache.get(key);
	}

	// Each of the Tonic's four channels plays one sound at a time, so a new hit cuts off the last one on its channel.
	function start(buffer, channel, when) {
		const prev = voices[channel];
		if (prev) {
			prev.gain.gain.setTargetAtTime(0, when, 0.004);
			prev.source.stop(when + 0.03);
		}
		const source = ctx.createBufferSource();
		const gain = ctx.createGain();
		source.buffer = buffer;
		source.connect(gain).connect(master);
		source.start(when);
		voices[channel] = { source, gain };
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

		// Plays one sound at the given morph value (0-255).
		audition(soundSet, sound, morph = 0) {
			stop();
			context();
			start(hitBuffer(soundSet, sound, morph, false), 0, ctx.currentTime + 0.01);
		},

		/*
		 * Loops a parsed pattern until stop(). timing is { bpm, swing } and is read every step, so edits apply live.
		 * onStep gets the step index as it sounds, then null on stop.
		 * Swing (0-18, shown on the Tonic as S00-S18) delays every second step; the exact curve is a guess.
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
					const at = next + (step % 2 ? length * 2 * timing.swing / 100 : 0);
					for (const h of hits.filter((h) => h.step === step)) {
						const buffer = hitBuffer(soundSet, h.sound, h.morph, h.accent);
						for (let k = 0; k < h.multiplier; k++) start(buffer, h.lane, at + (k * length) / h.multiplier);
					}
					queue.push({ step, at });
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
	};
}
