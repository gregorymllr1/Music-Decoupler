import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useStudioEngine } from "../useStudioEngine";
const job = {
    id: "j1", status: "done", source_filename: "s.wav", model: "htdemucs",
    output_format: "wav", progress: 1, stems: { vocals: "p", drums: "p" },
};
beforeEach(() => {
    // jsdom lacks Web Audio; provide minimal globals
    class FakeGain {
        constructor() {
            this.gain = { value: 1, setValueAtTime: () => { } };
            this.connect = () => { };
        }
    }
    class FakeSrc {
        constructor() {
            this.connect = () => { };
            this.start = () => { };
            this.stop = () => { };
        }
    }
    class FakeCtx {
        constructor() {
            this.currentTime = 0;
            this.destination = {};
            this.createGain = () => new FakeGain();
            this.createBufferSource = () => new FakeSrc();
            this.decodeAudioData = async () => ({ duration: 10 });
        }
    }
    vi.stubGlobal("AudioContext", FakeCtx);
    vi.stubGlobal("fetch", vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })));
});
describe("useStudioEngine", () => {
    it("loads channels and toggles mute", async () => {
        const { result } = renderHook(() => useStudioEngine(job));
        await waitFor(() => expect(result.current.stems).toEqual(["vocals", "drums"]));
        act(() => result.current.setMute("vocals", true));
        expect(result.current.channels.find((c) => c.stem === "vocals").muted).toBe(true);
    });
    it("initializes region to the full track", async () => {
        const { result } = renderHook(() => useStudioEngine(job));
        await waitFor(() => expect(result.current.transport.duration).toBe(10));
        expect(result.current.region).toEqual({ start: 0, end: 10 });
    });
    it("clamps setRegion to valid bounds with a 0.1s minimum gap", async () => {
        const { result } = renderHook(() => useStudioEngine(job));
        await waitFor(() => expect(result.current.transport.duration).toBe(10));
        act(() => result.current.setRegion(-5, 99));
        expect(result.current.region).toEqual({ start: 0, end: 10 });
        act(() => result.current.setRegion(4, 4));
        expect(result.current.region.start).toBe(4);
        expect(result.current.region.end).toBeCloseTo(4.1, 5);
    });
    it("includes start/end_sec in the mixdown request only when narrowed", async () => {
        const { result } = renderHook(() => useStudioEngine(job));
        await waitFor(() => expect(result.current.stems.length).toBe(2));
        let req = result.current.buildMixdownRequest("mp3", "clip");
        expect(req.start_sec).toBeUndefined();
        expect(req.end_sec).toBeUndefined();
        act(() => result.current.setRegion(2, 8));
        req = result.current.buildMixdownRequest("mp3", "clip");
        expect(req.start_sec).toBe(2);
        expect(req.end_sec).toBe(8);
        act(() => result.current.resetRegion());
        req = result.current.buildMixdownRequest("mp3", "clip");
        expect(req.start_sec).toBeUndefined();
    });
});
