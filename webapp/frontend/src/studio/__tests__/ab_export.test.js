import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ABToggle } from "../ABToggle";
import { ExportPanel } from "../ExportPanel";
describe("ABToggle", () => {
    it("reports mode changes", () => {
        const onMode = vi.fn();
        render(_jsx(ABToggle, { mode: "mix", onMode: onMode }));
        fireEvent.click(screen.getByRole("button", { name: /original/i }));
        expect(onMode).toHaveBeenCalledWith("original");
    });
});
describe("ExportPanel", () => {
    it("invokes export with chosen format and name", () => {
        const onExport = vi.fn();
        render(_jsx(ExportPanel, { onExport: onExport }));
        fireEvent.change(screen.getByLabelText(/format/i), { target: { value: "flac" } });
        fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "karaoke" } });
        fireEvent.click(screen.getByRole("button", { name: /export/i }));
        expect(onExport).toHaveBeenCalledWith("flac", "karaoke");
    });
    it("shows the export range summary when provided", () => {
        render(_jsx(ExportPanel, { onExport: vi.fn(), rangeSummary: "Selection 0:02 \u2013 0:08 (0:06)" }));
        expect(screen.getByText("Selection 0:02 – 0:08 (0:06)")).toBeTruthy();
    });
});
