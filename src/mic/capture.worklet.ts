/* ====================================================================
   CAPTURE (AudioWorklet) — the microphone's samples, off the audio
   thread and straight to the transcriber worker. It runs inside an
   AudioContext pinned to the model's 22.05 kHz, so the browser has
   already resampled whatever the device delivers (44.1, 48, 96 kHz …).

   Its only decisions are which channel to keep — one input of an
   interface, or all of them averaged — and how much to gather before
   posting. CHUNK is the trade: every post is a message, every sample
   held back is latency; 512 samples is ~23 ms, small beside the model's
   own lookahead. The main thread never sees audio: it hands this node
   one end of a MessageChannel whose other end is the worker's.
   ==================================================================== */

// The AudioWorkletGlobalScope is not in lib.dom; declare what we use.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

type Channel = "mix" | number; // settings.ts's Channel; a worklet imports nothing

type Message = { type: "sink"; port: MessagePort } | { type: "channel"; channel: Channel };

const CHUNK = 512;

class Capture extends AudioWorkletProcessor {
  private sink: MessagePort | null = null;
  private channel: Channel = "mix";
  private buf = new Float32Array(CHUNK);
  private filled = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<Message>) => {
      if (e.data.type === "sink") this.sink = e.data.port;
      else this.channel = e.data.channel;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const chans = inputs[0];
    if (!this.sink || !chans?.length) return true;
    const n = chans[0].length;
    const pick = this.channel === "mix" ? null : chans[Math.min(this.channel, chans.length - 1)];
    for (let i = 0; i < n; i++) {
      let v: number;
      if (pick) v = pick[i];
      else {
        v = 0;
        for (const c of chans) v += c[i];
        v /= chans.length;
      }
      this.buf[this.filled++] = v;
      if (this.filled === CHUNK) {
        this.sink.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Float32Array(CHUNK);
        this.filled = 0;
      }
    }
    return true; // keep running while the mic is connected
  }
}

registerProcessor("mic-capture", Capture);
