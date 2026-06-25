import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useStudioEngine } from "../useStudioEngine";
import type { Job } from "../../types";

const job: Job = {
  id: "j1", status: "done", source_filename: "s.wav", model: "htdemucs",
  output_format: "wav", progress: 1, stems: { vocals: "p", drums: "p" },
};

beforeEach(() => {
  // jsdom lacks Web Audio; provide minimal globals
  class FakeGain { gain = { value: 1, setValueAtTime: () => {} }; connect = () => {}; }
  class FakeSrc { buffer: any; onended: any; connect = () => {}; start = () => {}; stop = () => {}; }
  class FakeCtx {
    currentTime = 0; destination = {};
    createGain = () => new FakeGain();
    createBufferSource = () => new FakeSrc();
    decodeAudioData = async () => ({ duration: 10 });
  }
  vi.stubGlobal("AudioContext", FakeCtx as any);
  vi.stubGlobal("fetch", vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })));
});

describe("useStudioEngine", () => {
  it("loads channels and toggles mute", async () => {
    const { result } = renderHook(() => useStudioEngine(job));
    await waitFor(() => expect(result.current.stems).toEqual(["vocals", "drums"]));
    act(() => result.current.setMute("vocals", true));
    expect(result.current.channels.find((c) => c.stem === "vocals")!.muted).toBe(true);
  });
});