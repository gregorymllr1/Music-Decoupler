import { describe, it, expect } from "vitest";
import { fmtTime, decimalsForSpan } from "../time";

describe("fmtTime", () => {
  it("keeps the existing whole-second format by default", () => {
    expect(fmtTime(10)).toBe("0:10");
    expect(fmtTime(60)).toBe("1:00");
    expect(fmtTime(50)).toBe("0:50");
    expect(fmtTime(9.9)).toBe("0:09");
  });

  it("renders fractional seconds when asked", () => {
    expect(fmtTime(43.1837, 3)).toBe("0:43.184");
    expect(fmtTime(43.18, 2)).toBe("0:43.18");
    expect(fmtTime(3.2, 2)).toBe("0:03.20");
    expect(fmtTime(0.5, 3)).toBe("0:00.500");
  });

  it("carries the minute when rounding reaches 60 seconds", () => {
    expect(fmtTime(59.96, 1)).toBe("1:00.0");
    expect(fmtTime(119.999, 2)).toBe("2:00.00");
  });

  it("clamps negative input to zero", () => {
    expect(fmtTime(-5)).toBe("0:00");
    expect(fmtTime(-5, 2)).toBe("0:00.00");
  });
});

describe("decimalsForSpan", () => {
  it("picks precision from the visible span, first match wins", () => {
    expect(decimalsForSpan(232)).toBe(0);
    expect(decimalsForSpan(60.1)).toBe(0);
    expect(decimalsForSpan(60)).toBe(1);
    expect(decimalsForSpan(10.5)).toBe(1);
    expect(decimalsForSpan(10)).toBe(2);
    expect(decimalsForSpan(1.5)).toBe(2);
    expect(decimalsForSpan(1)).toBe(3);
    expect(decimalsForSpan(0.25)).toBe(3);
  });
});
