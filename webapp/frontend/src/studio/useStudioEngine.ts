import { useEffect, useRef, useState } from "react";
import { StudioEngine } from "./StudioEngine";
import { stemUrl, sourceUrl } from "../api/client";
import type { Job, MixdownRequest } from "../types";

export interface Channel {
  stem: string;
  volume: number;
  muted: boolean;
  solo: boolean;
}

export interface Region {
  start: number;
  end: number;
}

const MIN_REGION_GAP = 0.1; // seconds
const REGION_EDGE_EPS = 0.05; // region within this of the edges counts as "full track"

async function decodeFromUrl(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return ctx.decodeAudioData(buf);
}

export function useStudioEngine(job: Job) {
  const engineRef = useRef<StudioEngine | null>(null);
  const [stems, setStems] = useState<string[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [master, setMaster] = useState(1);
  const [abMode, setAbModeState] = useState<"original" | "mix">("mix");
  const [transport, setTransport] = useState({ playing: false, currentTime: 0, duration: 0 });
  const [region, setRegionState] = useState<Region>({ start: 0, end: 0 });

  useEffect(() => {
    const ctx = new AudioContext();
    const engine = new StudioEngine(ctx, (url) => decodeFromUrl(ctx, url));
    engineRef.current = engine;
    const tracks = Object.keys(job.stems ?? {}).map((stem) => ({ stem, url: stemUrl(job.id, stem) }));
    let raf = 0;
    engine.load(tracks).then(() => {
      setStems(engine.stems);
      setChannels(engine.stems.map((stem) => ({ stem, volume: 1, muted: false, solo: false })));
      setTransport((t) => ({ ...t, duration: engine.duration }));
      setRegionState({ start: 0, end: engine.duration });
    });
    engine.loadOriginal(sourceUrl(job.id)).catch(() => {});
    const tick = () => {
      const e = engineRef.current;
      if (e) setTransport({ playing: e.isPlaying, currentTime: e.currentTime, duration: e.duration });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      engine.stop();
      ctx.close?.();
    };
  }, [job.id]);

  const update = (stem: string, patch: Partial<Channel>) =>
    setChannels((cs) => cs.map((c) => (c.stem === stem ? { ...c, ...patch } : c)));

  return {
    stems,
    channels,
    master,
    abMode,
    transport,
    region,
    setGain: (stem: string, v: number) => { engineRef.current?.setGain(stem, v); update(stem, { volume: v }); },
    setMute: (stem: string, b: boolean) => { engineRef.current?.setMute(stem, b); update(stem, { muted: b }); },
    setSolo: (stem: string, b: boolean) => { engineRef.current?.setSolo(stem, b); update(stem, { solo: b }); },
    setMaster: (v: number) => { engineRef.current?.setMasterGain(v); setMaster(v); },
    setABMode: (m: "original" | "mix") => { engineRef.current?.setABMode(m); setAbModeState(m); },
    setRegion: (start: number, end: number) => {
      const d = engineRef.current?.duration ?? 0;
      if (d <= 0) return;
      const s = Math.min(Math.max(0, start), Math.max(0, d - MIN_REGION_GAP));
      const e = Math.min(Math.max(end, s + MIN_REGION_GAP), d);
      setRegionState({ start: s, end: e });
    },
    resetRegion: () => setRegionState({ start: 0, end: engineRef.current?.duration ?? 0 }),
    playSelection: () => engineRef.current?.playSelection(region.start, region.end),
    buildMixdownRequest: (format: "wav" | "flac" | "mp3", name: string): MixdownRequest => {
      const d = engineRef.current?.duration ?? 0;
      const narrowed = d > 0 && (region.start > REGION_EDGE_EPS || region.end < d - REGION_EDGE_EPS);
      return {
        name, format,
        bitrate: format === "mp3" ? 320 : undefined,
        bitdepth: format === "wav" ? 16 : undefined,
        ...(narrowed ? { start_sec: region.start, end_sec: region.end } : {}),
        tracks: channels.map((c) => ({ stem: c.stem, gain: c.volume, muted: c.muted })),
      };
    },
    play: () => engineRef.current?.play(),
    pause: () => engineRef.current?.pause(),
    stop: () => engineRef.current?.stop(),
    seek: (t: number) => engineRef.current?.seek(t),
    engine: engineRef,
  };
}