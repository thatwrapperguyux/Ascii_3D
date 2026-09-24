const CANDIDATES: [string, string][] = [
  ['video/mp4;codecs=avc1.640033', 'mp4'],
  ['video/mp4;codecs=avc1', 'mp4'],
  ['video/webm;codecs=vp9', 'webm'],
  ['video/webm;codecs=vp8', 'webm'],
  ['video/webm', 'webm'],
  ['video/mp4', 'mp4'],
];

export function pickVideoFormat(): { mimeType: string; extension: string } | null {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    return null;
  }
  for (const [mimeType, extension] of CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType, extension };
  }
  return null;
}

/** Records a canvas in real time for a fixed duration (or until stopped). */
export class CanvasRecorder {
  readonly extension: string;
  private readonly recorder: MediaRecorder;
  private readonly chunks: Blob[] = [];
  private timer = 0;
  private readonly started = performance.now();
  readonly finished: Promise<Blob>;

  constructor(canvas: HTMLCanvasElement, durationSeconds: number, format: { mimeType: string; extension: string }) {
    this.extension = format.extension;
    const stream = canvas.captureStream(60);
    // ASCII frames are all hard edges; a generous bitrate keeps glyphs readable.
    const pixels = canvas.width * canvas.height;
    const bitrate = Math.round(Math.min(40e6, Math.max(8e6, pixels * 8)));
    this.recorder = new MediaRecorder(stream, { mimeType: format.mimeType, videoBitsPerSecond: bitrate });
    this.finished = new Promise((resolve, reject) => {
      this.recorder.ondataavailable = (event) => event.data.size && this.chunks.push(event.data);
      this.recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        resolve(new Blob(this.chunks, { type: format.mimeType.split(';')[0] }));
      };
      this.recorder.onerror = () => reject(new Error('The browser stopped the recording.'));
    });
    this.recorder.start(250);
    this.timer = window.setTimeout(() => this.stop(), durationSeconds * 1000);
  }

  get elapsed(): number {
    return (performance.now() - this.started) / 1000;
  }

  get active(): boolean {
    return this.recorder.state === 'recording';
  }

  stop(): void {
    window.clearTimeout(this.timer);
    if (this.recorder.state !== 'inactive') this.recorder.stop();
  }
}
