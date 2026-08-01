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
  private original: Track | null = null;
  private abMode: "original" | "mix" = "mix";
  private playing = false;
  private offset = 0; // seconds into the timeline when paused
  private startedAt = 0; // ctx.currentTime when play() began
  private stopAtTime: number | null = null; // bounded-playback stop point (seconds)
  private playToken = 0; // invalidates stale onended callbacks

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

  async loadOriginal(url: string): Promise<void> {
    const buffer = await this.decode(url);
    const gainNode = this.ctx.createGain();
    gainNode.connect(this.master);
    this.original = {
      stem: "__original__", buffer, gainNode, source: null,
      gain: 1, muted: false, solo: false,
    };
  }

  get stems(): string[] {
    return this.tracks.map((t) => t.stem);
  }

  get duration(): number {
    return this.tracks.reduce((m, t) => Math.max(m, t.buffer.duration), 0);
  }

  getBuffer(stem: string): AudioBuffer | null {
    return this.tracks.find((t) => t.stem === stem)?.buffer ?? null;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentTime(): number {
    const raw = this.playing ? this.ctx.currentTime - this.startedAt : this.offset;
    return this.playing && this.stopAtTime != null ? Math.min(raw, this.stopAtTime) : raw;
  }

  private anySolo(): boolean {
    return this.tracks.some((t) => t.solo);
  }

  private allTracks(): Track[] {
    return this.original ? [...this.tracks, this.original] : [...this.tracks];
  }

  effectiveGain(stem: string): number {
    if (this.abMode === "original") return stem === "__original__" ? 1 : 0;
    if (stem === "__original__") return 0;
    const t = this.tracks.find((x) => x.stem === stem);
    if (!t) return 0;
    if (t.muted) return 0;
    if (this.anySolo() && !t.solo) return 0;
    return t.gain;
  }

  private applyGains(): void {
    for (const t of this.allTracks()) {
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

  setABMode(mode: "original" | "mix"): void {
    this.abMode = mode;
    this.applyGains();
  }

  setMasterGain(v: number): void {
    this.master.gain.setValueAtTime(v, this.ctx.currentTime);
  }

  play(stopAt?: number): void {
    if (this.playing) return;
    this.startedAt = this.ctx.currentTime - this.offset;
    this.stopAtTime = stopAt != null && stopAt > this.offset ? stopAt : null;
    const token = ++this.playToken;
    let first = true;
    for (const t of this.allTracks()) {
      const src = this.ctx.createBufferSource();
      src.buffer = t.buffer;
      src.connect(t.gainNode);
      if (this.stopAtTime != null) {
        src.start(0, this.offset, this.stopAtTime - this.offset);
        if (first) {
          src.onended = () => {
            if (this.playToken === token && this.playing) this.pause();
          };
        }
      } else {
        src.start(0, this.offset);
      }
      t.source = src;
      first = false;
    }
    this.applyGains();
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) return;
    this.offset = this.currentTime; // clamped to stopAtTime when bounded
    this.stopAtTime = null;
    for (const t of this.allTracks()) {
      const src = t.source;
      t.source = null;
      if (src) {
        src.onended = null;
        src.stop();
      }
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

  playSelection(start: number, end: number): void {
    if (this.playing) this.pause();
    this.offset = Math.max(0, Math.min(start, this.duration));
    this.play(Math.min(end, this.duration));
  }
}