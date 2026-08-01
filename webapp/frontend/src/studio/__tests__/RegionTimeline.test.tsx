import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RegionTimeline } from "../RegionTimeline";

// jsdom has no PointerEvent; polyfill so fireEvent.pointer* carries clientX
if (typeof window !== "undefined" && !("PointerEvent" in window)) {
  class FakePointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: any = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  vi.stubGlobal("PointerEvent", FakePointerEvent as any);
}

const rect = {
  left: 0, top: 0, width: 100, height: 28, right: 100, bottom: 28, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;

function setup(region = { start: 10, end: 60 }, view = { start: 0, end: 100 }) {
  const onRegionChange = vi.fn();
  const onSeek = vi.fn();
  render(
    <RegionTimeline duration={100} currentTime={5} region={region} view={view}
      onRegionChange={onRegionChange} onSeek={onSeek} />,
  );
  const track = screen.getByTestId("region-track");
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue(rect);
  return { onRegionChange, onSeek, track };
}

describe("RegionTimeline", () => {
  it("shows region times and resets to full width", () => {
    const { onRegionChange } = setup();
    expect(screen.getByText(/0:10 – 1:00 \(0:50\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /reset region/i }));
    expect(onRegionChange).toHaveBeenCalledWith(0, 100);
  });

  it("drags the start handle and stops reporting after pointer up", () => {
    const { onRegionChange } = setup();
    const handle = screen.getByRole("slider", { name: /region start/i });
    fireEvent.pointerDown(handle, { clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 25, pointerId: 1 });
    expect(onRegionChange).toHaveBeenLastCalledWith(25, 60);
    fireEvent.pointerUp(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 40, pointerId: 1 });
    expect(onRegionChange).toHaveBeenCalledTimes(1);
  });

  it("drags the end handle", () => {
    const { onRegionChange } = setup();
    const handle = screen.getByRole("slider", { name: /region end/i });
    fireEvent.pointerDown(handle, { clientX: 60, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 80, pointerId: 1 });
    expect(onRegionChange).toHaveBeenLastCalledWith(10, 80);
  });

  it("nudges handles with arrow keys (shift = 1s)", () => {
    const { onRegionChange } = setup();
    const start = screen.getByRole("slider", { name: /region start/i });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(onRegionChange).toHaveBeenCalledWith(10.1, 60);
    fireEvent.keyDown(start, { key: "ArrowLeft", shiftKey: true });
    expect(onRegionChange).toHaveBeenCalledWith(9, 60);
  });

  it("seeks when the ruler background is clicked", () => {
    const { onSeek, track } = setup();
    fireEvent.pointerDown(track, { clientX: 40, pointerId: 1 });
    expect(onSeek).toHaveBeenCalledWith(40);
  });

  it("does not seek when a handle is grabbed", () => {
    const { onSeek } = setup();
    const handle = screen.getByRole("slider", { name: /region start/i });
    fireEvent.pointerDown(handle, { clientX: 10, pointerId: 1 });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("maps drags to the visible window when zoomed", () => {
    // 100px wide showing 40s-50s: x=50 is halfway, i.e. t=45.
    const { onRegionChange } = setup({ start: 42, end: 48 }, { start: 40, end: 50 });
    const handle = screen.getByRole("slider", { name: /region start/i });
    fireEvent.pointerDown(handle, { clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 50, pointerId: 1 });
    expect(onRegionChange).toHaveBeenLastCalledWith(45, 48);
  });

  it("seeks to view-relative time when zoomed", () => {
    const { onSeek, track } = setup({ start: 42, end: 48 }, { start: 40, end: 50 });
    fireEvent.pointerDown(track, { clientX: 25, pointerId: 1 });
    expect(onSeek).toHaveBeenCalledWith(42.5);
  });

  it("scales the arrow nudge to the zoom level", () => {
    // 100px showing 1s => 0.01s per pixel, finer than the 0.1s default.
    const { onRegionChange } = setup({ start: 42, end: 48 }, { start: 42, end: 43 });
    const start = screen.getByRole("slider", { name: /region start/i });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(onRegionChange.mock.calls[0][0]).toBeCloseTo(42.01, 6);
  });

  it("shows sub-second times when zoomed in", () => {
    setup({ start: 42.1837, end: 42.9 }, { start: 42, end: 43 });
    expect(screen.getByText(/0:42\.184 – 0:42\.900/)).toBeTruthy();
  });
});
