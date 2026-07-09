import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Library } from "../Library";
const jobs = [
    { id: "1", status: "done", source_filename: "Song A.mp3", model: "htdemucs", output_format: "wav", progress: 1, stems: { vocals: "p" } },
    { id: "2", status: "done", source_filename: "Track B.flac", model: "htdemucs_6s", output_format: "flac", progress: 1, stems: { vocals: "p" } },
];
describe("Library", () => {
    it("filters by filename", () => {
        render(_jsx(Library, { jobs: jobs, onOpen: vi.fn(), onDelete: vi.fn() }));
        fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "track" } });
        expect(screen.queryByText("Song A.mp3")).toBeNull();
        expect(screen.getByText("Track B.flac")).toBeTruthy();
    });
    it("fires open and delete", () => {
        const onOpen = vi.fn(), onDelete = vi.fn();
        render(_jsx(Library, { jobs: jobs, onOpen: onOpen, onDelete: onDelete }));
        fireEvent.click(screen.getAllByRole("button", { name: /open/i })[0]);
        fireEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]);
        expect(onOpen).toHaveBeenCalledWith(jobs[0]);
        expect(onDelete).toHaveBeenCalledWith("1");
    });
});
