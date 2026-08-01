export const PEAK_BUCKET = 256;

/** Structural subset of AudioBuffer — jsdom has no AudioBuffer to test against. */
export interface AudioSourceLike {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface PeakPyramid {
  min: Float32Array; // one entry per bucket
  max: Float32Array;
  bucketSize: number;
  sampleRate: number;
  length: number; // source sample count
}

/** Everything a Waveform needs to draw itself at any zoom level. */
export interface WaveformData {
  source: AudioSourceLike;
  pyramid: PeakPyramid;
}

export interface Columns {
  min: Float32Array;
  max: Float32Array;
}

export function buildPeakPyramid(
  source: AudioSourceLike,
  bucketSize = PEAK_BUCKET,
): PeakPyramid {
  const { length, sampleRate, numberOfChannels } = source;
  const buckets = bucketSize > 0 ? Math.ceil(length / bucketSize) : 0;
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  if (buckets === 0 || numberOfChannels === 0) {
    return { min, max, bucketSize, sampleRate, length };
  }

  const channels: Float32Array[] = [];
  for (let c = 0; c < numberOfChannels; c++) channels.push(source.getChannelData(c));

  for (let b = 0; b < buckets; b++) {
    const s0 = b * bucketSize;
    const s1 = Math.min(s0 + bucketSize, length);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = s0; i < s1; i++) {
      let sum = 0;
      for (let c = 0; c < channels.length; c++) sum += channels[c][i];
      const v = sum / channels.length;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo === Infinity ? 0 : lo;
    max[b] = hi === -Infinity ? 0 : hi;
  }
  return { min, max, bucketSize, sampleRate, length };
}

export function computeColumns(
  source: AudioSourceLike,
  pyramid: PeakPyramid,
  viewStart: number,
  viewEnd: number,
  width: number,
): Columns {
  const w = Math.max(0, Math.floor(width));
  const min = new Float32Array(w);
  const max = new Float32Array(w);
  const span = viewEnd - viewStart;
  if (w === 0 || span <= 0 || pyramid.length === 0) return { min, max };

  const sr = pyramid.sampleRate;
  // Zoomed out, one pixel spans many buckets: read the pyramid. Zoomed in,
  // a pixel spans fewer samples than a bucket, so the pyramid would look
  // stair-stepped — read raw samples instead.
  const samplesPerPixel = (span * sr) / w;
  const usePyramid = samplesPerPixel >= pyramid.bucketSize;

  const channels: Float32Array[] = [];
  if (!usePyramid) {
    for (let c = 0; c < source.numberOfChannels; c++) channels.push(source.getChannelData(c));
  }

  for (let i = 0; i < w; i++) {
    const t0 = viewStart + (span * i) / w;
    const t1 = viewStart + (span * (i + 1)) / w;
    let s0 = Math.floor(t0 * sr);
    let s1 = Math.max(s0 + 1, Math.floor(t1 * sr));
    s0 = Math.max(0, Math.min(s0, pyramid.length));
    s1 = Math.max(s0, Math.min(s1, pyramid.length));
    if (s0 >= s1) continue; // past the end of a short stem: leave 0/0

    let lo = Infinity;
    let hi = -Infinity;
    if (usePyramid) {
      const b0 = Math.floor(s0 / pyramid.bucketSize);
      const b1 = Math.min(Math.ceil(s1 / pyramid.bucketSize), pyramid.min.length);
      for (let b = b0; b < b1; b++) {
        if (pyramid.min[b] < lo) lo = pyramid.min[b];
        if (pyramid.max[b] > hi) hi = pyramid.max[b];
      }
    } else {
      for (let s = s0; s < s1; s++) {
        let sum = 0;
        for (let c = 0; c < channels.length; c++) sum += channels[c][s];
        const v = channels.length ? sum / channels.length : 0;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    min[i] = lo === Infinity ? 0 : lo;
    max[i] = hi === -Infinity ? 0 : hi;
  }
  return { min, max };
}
