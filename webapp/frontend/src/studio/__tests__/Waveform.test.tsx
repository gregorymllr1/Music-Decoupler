import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Waveform } from "../Waveform";
import { buildPeakPyramid, type AudioSourceLike } from "../peaks";

const source: AudioSourceLike = {
  numberOfChannels: 1,
  length: 8000,
  sampleRate: 8000,
  getChannelData: () => new Float32Array(8000).fill(0.5),
};

describe("Waveform", () => {
  // jsdom implements neither a canvas 2D context nor ResizeObserver, so these
  // cases assert the component survives both being absent.
  it("mounts with no data without throwing", () => {
    render(<Waveform data={null} view={{ start: 0, end: 10 }} />);
    expect(screen.getByTestId("waveform")).toBeTruthy();
  });

  it("mounts with data without throwing", () => {
    const data = { source, pyramid: buildPeakPyramid(source) };
    render(<Waveform data={data} view={{ start: 0, end: 1 }} />);
    expect(screen.getByTestId("waveform")).toBeTruthy();
  });

  it("renders a canvas at the requested height", () => {
    const canvas = render(
      <Waveform data={null} view={{ start: 0, end: 10 }} height={64} />,
    ).getByTestId("waveform") as HTMLCanvasElement;
    expect(canvas.tagName).toBe("CANVAS");
    expect(canvas.style.height).toBe("64px");
  });
});
