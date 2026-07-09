import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function ChannelStrip(p) {
    return (_jsxs("div", { className: `channel-strip ${p.muted ? "is-muted" : ""}`, children: [_jsx("div", { className: "channel-label", children: p.label }), _jsxs("div", { className: "channel-buttons", children: [_jsx("button", { "aria-pressed": p.solo, "aria-label": `solo ${p.label}`, onClick: () => p.onSolo(!p.solo), children: "S" }), _jsx("button", { "aria-pressed": p.muted, "aria-label": `mute ${p.label}`, onClick: () => p.onMute(!p.muted), children: "M" })] }), _jsx("input", { type: "range", min: 0, max: 1.5, step: 0.01, value: p.volume, "aria-label": `volume ${p.label}`, onChange: (e) => p.onVolume(Number(e.target.value)) })] }));
}
