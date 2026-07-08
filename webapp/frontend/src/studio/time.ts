export function fmtTime(t: number): string {
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  const m = Math.floor(t / 60).toString();
  return `${m}:${s}`;
}
