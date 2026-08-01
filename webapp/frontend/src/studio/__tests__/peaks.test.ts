import { describe, it, expect } from "vitest";
import {
  buildPeakPyramid, computeColumns, PEAK_BUCKET, type AudioSourceLike,
} from "../peaks";

/** Mono source of `length` samples at 1000 Hz, filled by `fn`. */
function src(length: number, fn: (i: number) => number, channels = 1): AudioSourceLike {
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const arr = new Float32Array(length);
    for (let i = 0; i < length; i++) arr[i] = fn(i);
    data.push(arr);
  }
  return {
    numberOfChannels: channels,
    length,
    sampleRate: 1000,
    getChannelData: (c: number) => data[c],
  };
}

describe("buildPeakPyramid", () => {
  it("records the min and max of every bucket", () => {
    // Sawtooth: +1 on even samples, -0.5 on odd ones.
    const s = src(1024, (i) => (i % 2 === 0 ? 1 : -0.5));
    const p = buildPeakPyramid(s);
    expect(p.bucketSize).toBe(PEAK_BUCKET);
    expect(p.length).toBe(1024);
    expect(p.min.length).toBe(4);
    expect(p.max.length).toBe(4);
    for (let b = 0; b < 4; b++) {
      expect(p.max[b]).toBeCloseTo(1, 5);
      expect(p.min[b]).toBeCloseTo(-0.5, 5);
    }
  });

  it("averages channels to mono", () => {
    const s = src(256, () => 1, 2);
    // Both channels are 1.0, so the mono average is 1.0 (not 2.0).
    expect(buildPeakPyramid(s).max[0]).toBeCloseTo(1, 5);
  });

  it("covers a trailing partial bucket", () => {
    const s = src(300, (i) => (i >= 256 ? 0.75 : 0));
    const p = buildPeakPyramid(s);
    expect(p.min.length).toBe(2);
    expect(p.max[1]).toBeCloseTo(0.75, 5);
  });

  it("returns an empty pyramid for an empty source", () => {
    const p = buildPeakPyramid(src(0, () => 0));
    expect(p.min.length).toBe(0);
    expect(p.length).toBe(0);
  });
});

describe("computeColumns", () => {
  const s = src(10_000, (i) => Math.sin((i / 50) * Math.PI));
  const p = buildPeakPyramid(s);

  it("returns exactly `width` columns", () => {
    const c = computeColumns(s, p, 0, 10, 128);
    expect(c.min.length).toBe(128);
    expect(c.max.length).toBe(128);
  });

  it("returns empty arrays for degenerate inputs", () => {
    expect(computeColumns(s, p, 0, 10, 0).min.length).toBe(0);
    expect(computeColumns(s, p, 5, 5, 64).min.length).toBe(64);
    expect(computeColumns(s, p, 5, 5, 64).max.every((v) => v === 0)).toBe(true);
  });

  it("uses the raw tier when zoomed past one bucket per pixel", () => {
    // 0.05s at 1000Hz over 100px = 0.5 samples/px, far below PEAK_BUCKET.
    const c = computeColumns(s, p, 1, 1.05, 100);
    expect(c.min.length).toBe(100);
    expect(c.max.some((v) => v !== 0)).toBe(true);
  });

  it("pyramid tier envelopes the raw tier over the same window", () => {
    // Zoomed out: pyramid tier. Bucket-aligned scanning may widen the
    // envelope, so it must contain the exact raw envelope, not equal it.
    const wide = computeColumns(s, p, 0, 10, 50);
    const exact = computeColumns(s, { ...p, bucketSize: 1e9 }, 0, 10, 50);
    for (let i = 0; i < 50; i++) {
      expect(wide.min[i]).toBeLessThanOrEqual(exact.min[i] + 1e-6);
      expect(wide.max[i]).toBeGreaterThanOrEqual(exact.max[i] - 1e-6);
    }
  });

  it("yields silence for columns past the end of a short stem", () => {
    const short = src(1000, () => 1); // 1 second of audio
    const sp = buildPeakPyramid(short);
    const c = computeColumns(short, sp, 0, 4, 40); // 4-second view
    expect(c.max[5]).toBeCloseTo(1, 5);   // inside the audio
    expect(c.max[35]).toBe(0);            // past its end
    expect(c.min[35]).toBe(0);
  });
});
