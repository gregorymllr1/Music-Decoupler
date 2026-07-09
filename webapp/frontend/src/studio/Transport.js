import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { fmtTime } from "./time";
export function Transport(p) {
    return (_jsxs("div", { className: "transport", children: [_jsx("button", { "aria-label": p.playing ? "pause" : "play", onClick: p.onPlayPause, children: p.playing ? "⏸" : "▶" }), _jsx("button", { "aria-label": "stop", onClick: p.onStop, children: "\u23F9" }), _jsx("button", { "aria-label": "play selection", title: "Play selection", disabled: p.duration <= 0, onClick: p.onPlaySelection, children: "\u25B6|" }), _jsxs("span", { className: "time", children: [fmtTime(p.currentTime), " / ", fmtTime(p.duration)] }), _jsx("input", { type: "range", min: 0, max: p.duration || 0, step: 0.1, value: p.currentTime, "aria-label": "seek", onChange: (e) => p.onSeek(Number(e.target.value)) })] }));
}
