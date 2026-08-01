import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useTimelineView, clampView, zoomAnchor, MIN_VIEW_SPAN } from "../useTimelineView";

describe("clampView", () => {
  it("returns a zero view when the duration is unknown", () => {
    expect(clampView(0, 10, 0)).toEqual({ start: 0, end: 0 });
  });

  it("never lets the span go below MIN_VIEW_SPAN", () => {
    const v = clampView(5, 5.01, 100);
    expect(v.end - v.start).toBeCloseTo(MIN_VIEW_SPAN, 6);
  });

  it("never lets the span exceed the duration", () => {
    expect(clampView(-50, 500, 100)).toEqual({ start: 0, end: 100 });
  });

  it("never scrolls past either end", () => {
    expect(clampView(-10, -5, 100).start).toBe(0);
    const right = clampView(98, 108, 100);
    expect(right.end).toBe(100);
    expect(right.start).toBeCloseTo(90, 6);
  });

  it("collapses the minimum span for tracks shorter than it", () => {
    expect(clampView(0, 0.1, 0.1)).toEqual({ start: 0, end: 0.1 });
  });
});

describe("useTimelineView", () => {
  it("starts at the full track once the duration is known", () => {
    const { result } = renderHook(() => useTimelineView(100));
    expect(result.current.view).toEqual({ start: 0, end: 100 });
  });

  it("keeps the anchor at the same screen fraction while zooming", () => {
    const { result } = renderHook(() => useTimelineView(100));
    act(() => result.current.setView(20, 60)); // anchor 30 sits 25% in
    act(() => result.current.zoomBy(2, 30));
    const v = result.current.view;
    expect(v.end - v.start).toBeCloseTo(20, 6);
    expect((30 - v.start) / (v.end - v.start)).toBeCloseTo(0.25, 6);
  });

  it("clamps rather than overscrolling when zooming out at an edge", () => {
    const { result } = renderHook(() => useTimelineView(100));
    act(() => result.current.setView(0, 10));
    act(() => result.current.zoomBy(0.5, 0));
    expect(result.current.view).toEqual({ start: 0, end: 20 });
  });

  it("stops zooming in at MIN_VIEW_SPAN", () => {
    const { result } = renderHook(() => useTimelineView(100));
    act(() => result.current.setView(50, 50.3));
    act(() => result.current.zoomBy(100, 50.1));
    expect(result.current.view.end - result.current.view.start).toBeCloseTo(MIN_VIEW_SPAN, 6);
  });

  it("anchors on the playhead when it is inside the view", () => {
    expect(zoomAnchor({ start: 40, end: 50 }, 45)).toBe(45);
  });

  it("anchors on the view centre when the playhead is outside it", () => {
    expect(zoomAnchor({ start: 40, end: 50 }, 5)).toBe(45);
  });

  it("frames the selection with 5% padding", () => {
    const { result } = renderHook(() => useTimelineView(100));
    act(() => result.current.zoomToSelection(40, 50));
    expect(result.current.view.start).toBeCloseTo(39.5, 6);
    expect(result.current.view.end).toBeCloseTo(50.5, 6);
  });

  it("centres a MIN_VIEW_SPAN window on a selection shorter than it", () => {
    const { result } = renderHook(() => useTimelineView(100));
    act(() => result.current.zoomToSelection(50, 50.05));
    const v = result.current.view;
    expect(v.end - v.start).toBeCloseTo(MIN_VIEW_SPAN, 6);
    expect((v.start + v.end) / 2).toBeCloseTo(50.025, 6);
  });

  it("pans by a fraction of the span and clamps at the ends", () => {
    const { result } = renderHook(() => useTimelineView(100));
    act(() => result.current.setView(20, 30));
    act(() => result.current.panBy(0.15));
    expect(result.current.view).toEqual({ start: 21.5, end: 31.5 });
    act(() => result.current.panBy(-100));
    expect(result.current.view).toEqual({ start: 0, end: 10 });
  });

  it("fit restores the whole track", () => {
    const { result } = renderHook(() => useTimelineView(100));
    act(() => result.current.setView(20, 30));
    act(() => result.current.fit());
    expect(result.current.view).toEqual({ start: 0, end: 100 });
  });
});
