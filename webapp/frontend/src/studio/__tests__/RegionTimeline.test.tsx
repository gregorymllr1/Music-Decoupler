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
  const onZoom = vi.fn();
  const onFit = vi.fn();
  const onZoomToSelection = vi.fn();
  const onPan = vi.fn();
  render(
    <RegionTimeline duration={100} currentTime={5} region={region} view={view}
      onRegionChange={onRegionChange} onSeek={onSeek}
      onZoom={onZoom} onFit={onFit} onZoomToSelection={onZoomToSelection} onPan={onPan} />,
  );
  const track = screen.getByTestId("region-track");
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue(rect);
  return { onRegionChange, onSeek, onZoom, onFit, onZoomToSelection, onPan, track };
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

  it("zooms about the playhead when it is inside the view", () => {
    const { onZoom } = setup({ start: 10, end: 60 }, { start: 0, end: 100 });
    fireEvent.click(screen.getByRole("button", { name: /zoom in/i }));
    expect(onZoom).toHaveBeenCalledWith(2, 5); // currentTime is 5
  });

  it("zooms about the view centre when the playhead is off-screen", () => {
    const { onZoom } = setup({ start: 42, end: 48 }, { start: 40, end: 50 });
    fireEvent.click(screen.getByRole("button", { name: /zoom in/i }));
    expect(onZoom).toHaveBeenCalledWith(2, 45);
  });

  it("zooms out with the inverse factor", () => {
    const { onZoom } = setup();
    fireEvent.click(screen.getByRole("button", { name: /zoom out/i }));
    expect(onZoom).toHaveBeenCalledWith(0.5, 5);
  });

  it("fits and frames the selection", () => {
    const { onFit, onZoomToSelection } = setup();
    fireEvent.click(screen.getByRole("button", { name: /fit to track/i }));
    expect(onFit).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /zoom to selection/i }));
    expect(onZoomToSelection).toHaveBeenCalled();
  });

  it("ctrl+wheel zooms about the time under the cursor", () => {
    const { onZoom } = setup({ start: 42, end: 48 }, { start: 40, end: 50 });
    fireEvent.wheel(screen.getByTestId("region-track"), {
      deltaY: -100, ctrlKey: true, clientX: 30,
    });
    expect(onZoom).toHaveBeenCalledWith(2, 43); // 30% of 40s-50s
  });

  it("ctrl+wheel down zooms out", () => {
    const { onZoom } = setup({ start: 42, end: 48 }, { start: 40, end: 50 });
    fireEvent.wheel(screen.getByTestId("region-track"), {
      deltaY: 100, ctrlKey: true, clientX: 30,
    });
    expect(onZoom).toHaveBeenCalledWith(0.5, 43);
  });

  it("shift+wheel pans", () => {
    const { onPan } = setup();
    const track = screen.getByTestId("region-track");
    fireEvent.wheel(track, { deltaY: 100, shiftKey: true, clientX: 30 });
    expect(onPan).toHaveBeenCalledWith(0.15);
    fireEvent.wheel(track, { deltaY: -100, shiftKey: true, clientX: 30 });
    expect(onPan).toHaveBeenCalledWith(-0.15);
  });

  it("ignores a plain wheel so the page still scrolls", () => {
    const { onZoom, onPan } = setup();
    fireEvent.wheel(screen.getByTestId("region-track"), { deltaY: 100, clientX: 30 });
    expect(onZoom).not.toHaveBeenCalled();
    expect(onPan).not.toHaveBeenCalled();
  });

  it("pins an off-screen handle to the view edge and refuses to drag it", () => {
    // View 45s-50s; the start handle at 42s is off the left edge.
    const { onRegionChange } = setup({ start: 42, end: 48 }, { start: 45, end: 50 });
    const start = screen.getByRole("slider", { name: /region start/i });
    expect(start.getAttribute("data-offscreen")).toBe("true");
    expect(start.className).toContain("is-offscreen");
    expect(start.style.left).toBe("0%");
    fireEvent.pointerDown(start, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(start, { clientX: 50, pointerId: 1 });
    expect(onRegionChange).not.toHaveBeenCalled();
  });

  it("still reports the true time of an off-screen handle", () => {
    setup({ start: 42, end: 48 }, { start: 45, end: 50 });
    const start = screen.getByRole("slider", { name: /region start/i });
    expect(start.getAttribute("aria-valuenow")).toBe("42");
  });

  it("leaves on-screen handles draggable", () => {
    const { onRegionChange } = setup({ start: 46, end: 48 }, { start: 45, end: 50 });
    const start = screen.getByRole("slider", { name: /region start/i });
    expect(start.getAttribute("data-offscreen")).toBe("false");
    fireEvent.pointerDown(start, { clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(start, { clientX: 50, pointerId: 1 });
    expect(onRegionChange).toHaveBeenLastCalledWith(47.5, 48);
  });
});
