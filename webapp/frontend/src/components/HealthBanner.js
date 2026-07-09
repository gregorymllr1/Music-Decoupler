import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { health } from "../api/client";
export function HealthBanner() {
    const [warnings, setWarnings] = useState([]);
    useEffect(() => {
        health()
            .then((h) => {
            const w = [];
            if (!h.ffmpeg)
                w.push("ffmpeg not found on PATH — audio decoding will fail. Install ffmpeg.");
            if (!h.worker_alive)
                w.push("Worker is offline — start it with `python -m app.worker`.");
            setWarnings(w);
        })
            .catch(() => setWarnings(["Cannot reach the backend API."]));
    }, []);
    if (warnings.length === 0)
        return null;
    return (_jsx("div", { className: "health-banner", role: "alert", children: warnings.map((w) => _jsxs("div", { children: ["\u26A0 ", w] }, w)) }));
}
