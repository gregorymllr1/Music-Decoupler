import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useRef } from "react";
import { fmtTime } from "./time";
export function RegionTimeline(p) {
    const trackRef = useRef(null);
    const dragging = useRef(null);
    const pct = (t) => p.duration > 0 ? Math.min(100, Math.max(0, (t / p.duration) * 100)) : 0;
    const timeFromClientX = (clientX) => {
        const el = trackRef.current;
        if (!el || p.duration <= 0)
            return 0;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0)
            return 0;
        const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
        return (x / rect.width) * p.duration;
    };
    const moveHandle = (which, t) => {
        if (which === "start")
            p.onRegionChange(t, p.region.end);
        else
            p.onRegionChange(p.region.start, t);
    };
    const handleProps = (which) => ({
        onPointerDown: (e) => {
            e.stopPropagation();
            dragging.current = which;
            e.target.setPointerCapture?.(e.pointerId);
        },
        onPointerMove: (e) => {
            if (dragging.current !== which)
                return;
            moveHandle(which, timeFromClientX(e.clientX));
        },
        onPointerUp: () => {
            dragging.current = null;
        },
        onKeyDown: (e) => {
            const step = e.shiftKey ? 1 : 0.1;
            const delta = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
            if (!delta)
                return;
            e.preventDefault();
            moveHandle(which, (which === "start" ? p.region.start : p.region.end) + delta);
        },
    });
    return (_jsxs("div", { className: "region-timeline", children: [_jsxs("div", { className: "region-info", children: [_jsxs("span", { className: "region-times", children: [fmtTime(p.region.start), " \u2013 ", fmtTime(p.region.end), " (", fmtTime(p.region.end - p.region.start), ")"] }), _jsx("button", { "aria-label": "reset region", onClick: () => p.onRegionChange(0, p.duration), children: "Reset" })] }), _jsxs("div", { className: "region-track", "data-testid": "region-track", ref: trackRef, onPointerDown: (e) => p.onSeek(timeFromClientX(e.clientX)), children: [_jsx("div", { className: "region-shade", style: { left: `${pct(p.region.start)}%`, width: `${pct(p.region.end) - pct(p.region.start)}%` } }), _jsx("div", { role: "slider", tabIndex: 0, "aria-label": "region start", "aria-valuemin": 0, "aria-valuemax": p.duration, "aria-valuenow": p.region.start, className: "region-handle start", style: { left: `${pct(p.region.start)}%` }, ...handleProps("start") }), _jsx("div", { role: "slider", tabIndex: 0, "aria-label": "region end", "aria-valuemin": 0, "aria-valuemax": p.duration, "aria-valuenow": p.region.end, className: "region-handle end", style: { left: `${pct(p.region.end)}%` }, ...handleProps("end") }), _jsx("div", { className: "region-playhead", style: { left: `${pct(p.currentTime)}%` } })] })] }));
}
