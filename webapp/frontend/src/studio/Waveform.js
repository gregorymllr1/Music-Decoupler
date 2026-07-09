import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";
export function Waveform({ url, height = 48 }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current)
            return;
        const ws = WaveSurfer.create({
            container: ref.current,
            height,
            interact: false,
            waveColor: "#7aa2f7",
            progressColor: "#7aa2f7",
            url,
        });
        return () => ws.destroy();
    }, [url, height]);
    return _jsx("div", { className: "waveform", ref: ref });
}
