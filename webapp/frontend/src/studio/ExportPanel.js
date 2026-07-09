import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
export function ExportPanel({ onExport, rangeSummary }) {
    const [format, setFormat] = useState("mp3");
    const [name, setName] = useState("mixdown");
    return (_jsxs("div", { className: "export-panel", children: [_jsxs("label", { children: ["Name", _jsx("input", { "aria-label": "name", value: name, onChange: (e) => setName(e.target.value) })] }), _jsxs("label", { children: ["Format", _jsxs("select", { "aria-label": "format", value: format, onChange: (e) => setFormat(e.target.value), children: [_jsx("option", { value: "mp3", children: "MP3" }), _jsx("option", { value: "flac", children: "FLAC" }), _jsx("option", { value: "wav", children: "WAV" })] })] }), rangeSummary ? _jsx("span", { className: "export-range", children: rangeSummary }) : null, _jsx("button", { onClick: () => onExport(format, name), children: "Export mixdown" })] }));
}
