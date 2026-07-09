import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function ABToggle({ mode, onMode }) {
    return (_jsxs("div", { className: "ab-toggle", role: "group", "aria-label": "A/B comparison", children: [_jsx("button", { "aria-pressed": mode === "original", onClick: () => onMode("original"), children: "Original" }), _jsx("button", { "aria-pressed": mode === "mix", onClick: () => onMode("mix"), children: "Mix" })] }));
}
