import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Dashboard } from "../Dashboard";
const base = {
    id: "j1", status: "running", source_filename: "song.mp3",
    model: "htdemucs", output_format: "wav", progress: 0.42,
};
describe("Dashboard", () => {
    it("shows filename, status and progress", () => {
        render(_jsx(Dashboard, { jobs: [base] }));
        expect(screen.getByText("song.mp3")).toBeTruthy();
        expect(screen.getByText(/running/i)).toBeTruthy();
        expect(screen.getByTestId("progress-j1").style.width).toBe("42%");
    });
    it("renders stem download links when done", () => {
        const done = { ...base, status: "done", progress: 1, stems: { vocals: "p", drums: "p" } };
        render(_jsx(Dashboard, { jobs: [done] }));
        expect(screen.getByText("vocals")).toBeTruthy();
        expect(screen.getByText("drums")).toBeTruthy();
    });
});
