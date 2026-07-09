import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from "react";
export function Library({ jobs, onOpen, onDelete, }) {
    const [q, setQ] = useState("");
    const filtered = useMemo(() => jobs.filter((j) => j.source_filename.toLowerCase().includes(q.toLowerCase())), [jobs, q]);
    return (_jsxs("div", { className: "library", children: [_jsx("input", { placeholder: "Search\u2026", value: q, onChange: (e) => setQ(e.target.value) }), _jsx("ul", { children: filtered.map((j) => (_jsxs("li", { children: [_jsx("span", { className: "name", children: j.source_filename }), _jsxs("span", { className: "meta", children: [j.model, " \u00B7 ", j.status] }), j.status === "done" && _jsx("button", { onClick: () => onOpen(j), children: "Open" }), _jsx("button", { onClick: () => onDelete(j.id), children: "Delete" })] }, j.id))) })] }));
}
