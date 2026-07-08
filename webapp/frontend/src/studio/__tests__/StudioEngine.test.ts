import { describe, it, expect, vi, beforeEach } from "vitest";
import { StudioEngine } from "../StudioEngine";

class FakeGain {
  gain = { value: 1, setValueAtTime: (v: number) => (this.gain.value = v) };
  connect = vi.fn();
}
class FakeSource {
  buffer: any = null;
  onended: any = null;
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}
class FakeCtx {
  currentTime = 0;
  destination = {};
  sources: FakeSource[] = [];
  createGain = () => new FakeGain();
  createBufferSource = () => {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  };
}

function buffer(dur = 10) {
  return { duration: dur } as unknown as AudioBuffer;
}

describe("StudioEngine", () => {
  let ctx: FakeCtx;
  let engine: StudioEngine;

  beforeEach(async () => {
    ctx = new FakeCtx();
    const decode = vi.fn(async (_url: string) => buffer(10));
    engine = new StudioEngine(ctx as unknown as AudioContext, decode);
    await engine.load([
      { stem: "vocals", url: "/v" },
      { stem: "drums", url: "/d" },
    ]);
  });

  it("loads stems and exposes duration", () => {
    expect(engine.stems).toEqual(["vocals", "drums"]);
    expect(engine.duration).toBe(10);
  });

  it("solo isolates a stem (others muted to 0)", () => {
    engine.setSolo("vocals", true);
    expect(engine.effectiveGain("vocals")).toBe(1);
    expect(engine.effectiveGain("drums")).toBe(0);
  });

  it("mute removes a stem", () => {
    engine.setMute("vocals", true);
    expect(engine.effectiveGain("vocals")).toBe(0);
    expect(engine.effectiveGain("drums")).toBe(1);
  });

  it("gain value is respected when audible", () => {
    engine.setGain("drums", 0.5);
    expect(engine.effectiveGain("drums")).toBe(0.5);
  });

  it("play then pause tracks currentTime from context clock", () => {
    engine.play();
    expect(engine.isPlaying).toBe(true);
    ctx.currentTime = 3;
    expect(engine.currentTime).toBeCloseTo(3, 5);
    engine.pause();
    expect(engine.isPlaying).toBe(false);
    expect(engine.currentTime).toBeCloseTo(3, 5);
  });

  it("play with stopAt schedules bounded sources", () => {
    engine.seek(2);
    engine.play(8);
    expect(ctx.sources[0].start).toHaveBeenCalledWith(0, 2, 6);
  });

  it("flips to paused at stopAt when sources end", () => {
    engine.play(8);
    ctx.currentTime = 8;
    ctx.sources[0].onended?.();
    expect(engine.isPlaying).toBe(false);
    expect(engine.currentTime).toBe(8);
  });

  it("currentTime never reads past stopAt while playing", () => {
    engine.play(8);
    ctx.currentTime = 9.5;
    expect(engine.currentTime).toBe(8);
  });

  it("manual pause before stopAt keeps the paused position", () => {
    engine.play(8);
    ctx.currentTime = 3;
    engine.pause();
    ctx.sources[0].onended?.(); // fires async after stop() in real browsers
    expect(engine.isPlaying).toBe(false);
    expect(engine.currentTime).toBeCloseTo(3, 5);
  });

  it("playSelection seeks to start and bounds playback at end", () => {
    engine.playSelection(2, 8);
    expect(engine.isPlaying).toBe(true);
    expect(engine.currentTime).toBeCloseTo(2, 5);
    expect(ctx.sources[0].start).toHaveBeenCalledWith(0, 2, 6);
  });
});