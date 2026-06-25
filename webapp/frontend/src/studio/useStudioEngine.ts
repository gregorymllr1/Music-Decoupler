import { useEffect, useRef, useState } from "react";
import { StudioEngine } from "./StudioEngine";
import { stemUrl } from "../api/client";
import type { Job } from "../types";

export interface Channel {
  stem: string;
  volume: number;
  muted: boolean;
  solo: boolean;
}

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
  const [transport, setTransport] = useState({ playing: false, currentTime: 0, duration: 0 });

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
    });
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
    transport,
    setGain: (stem: string, v: number) => { engineRef.current?.setGain(stem, v); update(stem, { volume: v }); },
    setMute: (stem: string, b: boolean) => { engineRef.current?.setMute(stem, b); update(stem, { muted: b }); },
    setSolo: (stem: string, b: boolean) => { engineRef.current?.setSolo(stem, b); update(stem, { solo: b }); },
    setMaster: (v: number) => { engineRef.current?.setMasterGain(v); setMaster(v); },
    play: () => engineRef.current?.play(),
    pause: () => engineRef.current?.pause(),
    stop: () => engineRef.current?.stop(),
    seek: (t: number) => engineRef.current?.seek(t),
    engine: engineRef,
  };
}