export function fmtTime(t: number, decimals = 0): string {
  const clamped = t > 0 ? t : 0;
  if (decimals <= 0) {
    const s = Math.floor(clamped % 60).toString().padStart(2, "0");
    const m = Math.floor(clamped / 60).toString();
    return `${m}:${s}`;
  }
  // Round first, then split, so 59.96s at 1dp is "1:00.0" and never "0:60.0".
  const p = Math.pow(10, decimals);
  const total = Math.round(clamped * p) / p;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(decimals).padStart(decimals + 3, "0")}`;
}

export function decimalsForSpan(span: number): number {
  if (span > 60) return 0;
  if (span > 10) return 1;
  if (span > 1) return 2;
  return 3;
}
