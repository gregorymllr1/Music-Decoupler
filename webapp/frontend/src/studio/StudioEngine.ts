interface Track {
  stem: string;
  buffer: AudioBuffer;
  gainNode: GainNode;
  source: AudioBufferSourceNode | null;
  gain: number;
  muted: boolean;
  solo: boolean;
}

export class StudioEngine {
  private ctx: AudioContext;
  private decode: (url: string) => Promise<AudioBuffer>;
  private master: GainNode;
  private tracks: Track[] = [];
  private playing = false;
  private offset = 0; // seconds into the timeline when paused
  private startedAt = 0; // ctx.currentTime when play() began

  constructor(ctx: AudioContext, decode: (url: string) => Promise<AudioBuffer>) {
    this.ctx = ctx;
    this.decode = decode;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
  }

  async load(tracks: { stem: string; url: string }[]): Promise<void> {
    this.tracks = [];
    for (const t of tracks) {
      const buffer = await this.decode(t.url);
      const gainNode = this.ctx.createGain();
      gainNode.connect(this.master);
      this.tracks.push({
        stem: t.stem, buffer, gainNode, source: null,
        gain: 1, muted: false, solo: false,
      });
    }
  }

  get stems(): string[] {
    return this.tracks.map((t) => t.stem);
  }

  get duration(): number {
    return this.tracks.reduce((m, t) => Math.max(m, t.buffer.duration), 0);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentTime(): number {
    return this.playing ? this.ctx.currentTime - this.startedAt : this.offset;
  }

  private anySolo(): boolean {
    return this.tracks.some((t) => t.solo);
  }

  effectiveGain(stem: string): number {
    const t = this.tracks.find((x) => x.stem === stem);
    if (!t) return 0;
    if (t.muted) return 0;
    if (this.anySolo() && !t.solo) return 0;
    return t.gain;
  }

  private applyGains(): void {
    for (const t of this.tracks) {
      t.gainNode.gain.setValueAtTime(this.effectiveGain(t.stem), this.ctx.currentTime);
    }
  }

  setGain(stem: string, v: number): void {
    const t = this.tracks.find((x) => x.stem === stem);
    if (t) {
      t.gain = v;
      this.applyGains();
    }
  }

  setMute(stem: string, b: boolean): void {
    const t = this.tracks.find((x) => x.stem === stem);
    if (t) {
      t.muted = b;
      this.applyGains();
    }
  }

  setSolo(stem: string, b: boolean): void {
    const t = this.tracks.find((x) => x.stem === stem);
    if (t) {
      t.solo = b;
      this.applyGains();
    }
  }

  setMasterGain(v: number): void {
    this.master.gain.setValueAtTime(v, this.ctx.currentTime);
  }

  play(): void {
    if (this.playing) return;
    this.startedAt = this.ctx.currentTime - this.offset;
    for (const t of this.tracks) {
      const src = this.ctx.createBufferSource();
      src.buffer = t.buffer;
      src.connect(t.gainNode);
      src.start(0, this.offset);
      t.source = src;
    }
    this.applyGains();
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) return;
    this.offset = this.currentTime;
    for (const t of this.tracks) {
      t.source?.stop();
      t.source = null;
    }
    this.playing = false;
  }

  stop(): void {
    this.pause();
    this.offset = 0;
  }

  seek(t: number): void {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.offset = Math.max(0, Math.min(t, this.duration));
    if (wasPlaying) this.play();
  }
}