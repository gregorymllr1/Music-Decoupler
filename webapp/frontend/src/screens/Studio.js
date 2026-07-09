import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useStudioEngine, REGION_EDGE_EPS } from "../studio/useStudioEngine";
import { ChannelStrip } from "../studio/ChannelStrip";
import { Transport } from "../studio/Transport";
import { Waveform } from "../studio/Waveform";
import { ABToggle } from "../studio/ABToggle";
import { ExportPanel } from "../studio/ExportPanel";
import { RegionTimeline } from "../studio/RegionTimeline";
import { fmtTime } from "../studio/time";
import { stemUrl, createMixdown, mixdownDownloadUrl } from "../api/client";
export function Studio({ job, onBack }) {
    const s = useStudioEngine(job);
    const dur = s.transport.duration;
    const pct = (t) => (dur > 0 ? Math.min(100, Math.max(0, (t / dur) * 100)) : 0);
    const narrowed = dur > 0 && (s.region.start > REGION_EDGE_EPS || s.region.end < dur - REGION_EDGE_EPS);
    const rangeSummary = narrowed
        ? `Selection ${fmtTime(s.region.start)} – ${fmtTime(s.region.end)} (${fmtTime(s.region.end - s.region.start)})`
        : "Full track";
    async function handleExport(format, name) {
        const req = s.buildMixdownRequest(format, name);
        const out = await createMixdown(job.id, req);
        window.location.href = mixdownDownloadUrl(out.id);
    }
    return (_jsxs("div", { className: "studio", children: [_jsxs("header", { children: [_jsx("button", { onClick: onBack, children: "\u25C0 Back" }), _jsx("strong", { children: job.source_filename }), _jsxs("span", { children: [job.model, " \u00B7 ", job.device_used ?? ""] }), _jsx(ABToggle, { mode: s.abMode, onMode: s.setABMode })] }), _jsx(RegionTimeline, { duration: dur, currentTime: s.transport.currentTime, region: s.region, onRegionChange: s.setRegion, onSeek: s.seek }), _jsxs("div", { className: "tracks", children: [s.channels.map((c) => (_jsxs("div", { className: "track-row", children: [_jsx(ChannelStrip, { stem: c.stem, label: c.stem, volume: c.volume, muted: c.muted, solo: c.solo, onVolume: (v) => s.setGain(c.stem, v), onMute: (b) => s.setMute(c.stem, b), onSolo: (b) => s.setSolo(c.stem, b) }), _jsx(Waveform, { url: stemUrl(job.id, c.stem) })] }, c.stem))), _jsxs("div", { className: "tracks-overlay", "aria-hidden": "true", children: [_jsx("div", { className: "overlay-dim", style: { left: 0, width: `${pct(s.region.start)}%` } }), _jsx("div", { className: "overlay-dim", style: { left: `${pct(s.region.end)}%`, right: 0 } }), _jsx("div", { className: "overlay-playhead", style: { left: `${pct(s.transport.currentTime)}%` } })] })] }), _jsx(Transport, { playing: s.transport.playing, currentTime: s.transport.currentTime, duration: s.transport.duration, onPlayPause: () => (s.transport.playing ? s.pause() : s.play()), onStop: s.stop, onSeek: s.seek, onPlaySelection: s.playSelection }), _jsxs("label", { className: "master", children: ["Master", _jsx("input", { type: "range", min: 0, max: 1.5, step: 0.01, value: s.master, onChange: (e) => s.setMaster(Number(e.target.value)) })] }), _jsx(ExportPanel, { onExport: handleExport, rangeSummary: rangeSummary })] }));
}
