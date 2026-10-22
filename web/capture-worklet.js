// Posts the first input channel to the main thread in 2048-sample batches.
class CaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.batch = new Float32Array(2048);
		this.filled = 0;
	}

	process(inputs) {
		const channel = inputs[0]?.[0];
		if (!channel) return true;
		for (let i = 0; i < channel.length; i++) {
			this.batch[this.filled++] = channel[i];
			if (this.filled === this.batch.length) {
				this.port.postMessage(this.batch);
				this.batch = new Float32Array(2048);
				this.filled = 0;
			}
		}
		return true;
	}
}

registerProcessor('capture', CaptureProcessor);
