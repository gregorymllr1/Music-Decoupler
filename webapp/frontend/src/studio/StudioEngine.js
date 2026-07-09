export class StudioEngine {
    constructor(ctx, decode) {
        this.tracks = [];
        this.original = null;
        this.abMode = "mix";
        this.playing = false;
        this.offset = 0; // seconds into the timeline when paused
        this.startedAt = 0; // ctx.currentTime when play() began
        this.stopAtTime = null; // bounded-playback stop point (seconds)
        this.playToken = 0; // invalidates stale onended callbacks
        this.ctx = ctx;
        this.decode = decode;
        this.master = ctx.createGain();
        this.master.connect(ctx.destination);
    }
    async load(tracks) {
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
    async loadOriginal(url) {
        const buffer = await this.decode(url);
        const gainNode = this.ctx.createGain();
        gainNode.connect(this.master);
        this.original = {
            stem: "__original__", buffer, gainNode, source: null,
            gain: 1, muted: false, solo: false,
        };
    }
    get stems() {
        return this.tracks.map((t) => t.stem);
    }
    get duration() {
        return this.tracks.reduce((m, t) => Math.max(m, t.buffer.duration), 0);
    }
    get isPlaying() {
        return this.playing;
    }
    get currentTime() {
        const raw = this.playing ? this.ctx.currentTime - this.startedAt : this.offset;
        return this.playing && this.stopAtTime != null ? Math.min(raw, this.stopAtTime) : raw;
    }
    anySolo() {
        return this.tracks.some((t) => t.solo);
    }
    allTracks() {
        return this.original ? [...this.tracks, this.original] : [...this.tracks];
    }
    effectiveGain(stem) {
        if (this.abMode === "original")
            return stem === "__original__" ? 1 : 0;
        if (stem === "__original__")
            return 0;
        const t = this.tracks.find((x) => x.stem === stem);
        if (!t)
            return 0;
        if (t.muted)
            return 0;
        if (this.anySolo() && !t.solo)
            return 0;
        return t.gain;
    }
    applyGains() {
        for (const t of this.allTracks()) {
            t.gainNode.gain.setValueAtTime(this.effectiveGain(t.stem), this.ctx.currentTime);
        }
    }
    setGain(stem, v) {
        const t = this.tracks.find((x) => x.stem === stem);
        if (t) {
            t.gain = v;
            this.applyGains();
        }
    }
    setMute(stem, b) {
        const t = this.tracks.find((x) => x.stem === stem);
        if (t) {
            t.muted = b;
            this.applyGains();
        }
    }
    setSolo(stem, b) {
        const t = this.tracks.find((x) => x.stem === stem);
        if (t) {
            t.solo = b;
            this.applyGains();
        }
    }
    setABMode(mode) {
        this.abMode = mode;
        this.applyGains();
    }
    setMasterGain(v) {
        this.master.gain.setValueAtTime(v, this.ctx.currentTime);
    }
    play(stopAt) {
        if (this.playing)
            return;
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
                        if (this.playToken === token && this.playing)
                            this.pause();
                    };
                }
            }
            else {
                src.start(0, this.offset);
            }
            t.source = src;
            first = false;
        }
        this.applyGains();
        this.playing = true;
    }
    pause() {
        if (!this.playing)
            return;
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
    stop() {
        this.pause();
        this.offset = 0;
    }
    seek(t) {
        const wasPlaying = this.playing;
        if (wasPlaying)
            this.pause();
        this.offset = Math.max(0, Math.min(t, this.duration));
        if (wasPlaying)
            this.play();
    }
    playSelection(start, end) {
        if (this.playing)
            this.pause();
        this.offset = Math.max(0, Math.min(start, this.duration));
        this.play(Math.min(end, this.duration));
    }
}
