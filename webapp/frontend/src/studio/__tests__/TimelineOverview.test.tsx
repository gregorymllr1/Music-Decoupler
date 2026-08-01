import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TimelineOverview } from "../TimelineOverview";

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
  left: 0, top: 0, width: 100, height: 18, right: 100, bottom: 18, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;

function setup(view = { start: 40, end: 50 }) {
  const onViewChange = vi.fn();
  render(
    <TimelineOverview duration={100} view={view} region={{ start: 42, end: 48 }}
      currentTime={5} onViewChange={onViewChange} />,
  );
  const track = screen.getByTestId("overview-track");
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue(rect);
  return { onViewChange, track };
}

describe("TimelineOverview", () => {
  it("positions the window box over the visible span", () => {
    setup();
    const box = screen.getByTestId("overview-window");
    expect(box.style.left).toBe("40%");
    expect(box.style.width).toBe("10%");
  });

  it("spans the full width when fitted", () => {
    setup({ start: 0, end: 100 });
    const box = screen.getByTestId("overview-window");
    expect(box.style.left).toBe("0%");
    expect(box.style.width).toBe("100%");
  });

  it("centres the span where the background is clicked", () => {
    const { onViewChange, track } = setup();
    fireEvent.pointerDown(track, { clientX: 20, pointerId: 1 });
    expect(onViewChange).toHaveBeenCalledWith(15, 25); // 20s +/- half of a 10s span
  });

  it("drags the window box to pan, preserving the grab offset", () => {
    const { onViewChange } = setup();
    const box = screen.getByTestId("overview-window");
    // Grab at 45s (5s into a 40-50s window), drop at 60s => window 55-65.
    fireEvent.pointerDown(box, { clientX: 45, pointerId: 1 });
    fireEvent.pointerMove(box, { clientX: 60, pointerId: 1 });
    expect(onViewChange).toHaveBeenLastCalledWith(55, 65);
  });

  it("does not centre the view when the box itself is grabbed", () => {
    const { onViewChange } = setup();
    fireEvent.pointerDown(screen.getByTestId("overview-window"), {
      clientX: 45, pointerId: 1,
    });
    expect(onViewChange).not.toHaveBeenCalled();
  });
});
