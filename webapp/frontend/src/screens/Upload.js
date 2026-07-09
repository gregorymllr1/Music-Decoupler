import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { createJob, listModels } from "../api/client";
export function Upload({ onCreated }) {
    const [models, setModels] = useState([]);
    const [model, setModel] = useState("htdemucs");
    const [format, setFormat] = useState("wav");
    const [bitrate, setBitrate] = useState(320);
    const [bitdepth, setBitdepth] = useState(16);
    const [selected, setSelected] = useState({});
    const [files, setFiles] = useState([]);
    const [busy, setBusy] = useState(false);
    const inputRef = useRef(null);
    useEffect(() => {
        listModels().then(setModels).catch(() => setModels([]));
    }, []);
    const stems = useMemo(() => models.find((m) => m.name === model)?.stems ?? [], [models, model]);
    useEffect(() => {
        setSelected(Object.fromEntries(stems.map((s) => [s, true])));
    }, [stems.join(",")]);
    async function submit() {
        if (files.length === 0)
            return;
        setBusy(true);
        try {
            const chosen = stems.filter((s) => selected[s]);
            const allChosen = chosen.length === stems.length;
            const batch_id = files.length > 1 ? crypto.randomUUID() : undefined;
            for (const f of files) {
                onCreated(await createJob(f, {
                    model,
                    output_format: format,
                    output_bitrate: format === "mp3" ? bitrate : undefined,
                    output_bitdepth: format === "wav" ? bitdepth : undefined,
                    stems: allChosen ? undefined : chosen,
                    batch_id,
                }));
            }
            setFiles([]);
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs("div", { className: "upload", children: [_jsxs("div", { className: "upload-pick-row", children: [_jsx("input", { ref: inputRef, "data-testid": "file-input", type: "file", multiple: true, accept: ".mp3,.flac,.wav,.ogg,.m4a", onChange: (e) => setFiles(Array.from(e.target.files ?? [])), style: { display: "none" } }), _jsx("button", { type: "button", className: "btn-load-track", onClick: () => inputRef.current?.click(), children: "Load Track" }), _jsx("span", { className: "upload-picked", children: files.length === 0
                            ? "No tracks selected"
                            : files.length === 1
                                ? files[0].name
                                : `${files.length} tracks selected` })] }), _jsx("select", { value: model, onChange: (e) => setModel(e.target.value), children: models.map((m) => (_jsx("option", { value: m.name, children: m.name }, m.name))) }), _jsxs("select", { value: format, onChange: (e) => setFormat(e.target.value), children: [_jsx("option", { value: "wav", children: "WAV" }), _jsx("option", { value: "flac", children: "FLAC" }), _jsx("option", { value: "mp3", children: "MP3" })] }), format === "mp3" && (_jsx("select", { value: bitrate, onChange: (e) => setBitrate(Number(e.target.value)), children: [128, 192, 256, 320].map((b) => _jsxs("option", { value: b, children: [b, " kbps"] }, b)) })), format === "wav" && (_jsxs("select", { value: bitdepth, onChange: (e) => setBitdepth(Number(e.target.value)), children: [_jsx("option", { value: 16, children: "16-bit" }), _jsx("option", { value: 24, children: "24-bit" }), _jsx("option", { value: 32, children: "32-bit float" })] })), _jsx("fieldset", { className: "stems", children: stems.map((s) => (_jsxs("label", { children: [_jsx("input", { type: "checkbox", "aria-label": s, checked: selected[s] ?? true, onChange: (e) => setSelected((p) => ({ ...p, [s]: e.target.checked })) }), s] }, s))) }), _jsx("button", { className: "btn-primary", onClick: submit, disabled: files.length === 0 || busy, children: files.length > 1 ? `Separate ${files.length} files` : "Separate" })] }));
}
