import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ABToggle } from "../ABToggle";
import { ExportPanel } from "../ExportPanel";

describe("ABToggle", () => {
  it("reports mode changes", () => {
    const onMode = vi.fn();
    render(<ABToggle mode="mix" onMode={onMode} />);
    fireEvent.click(screen.getByRole("button", { name: /original/i }));
    expect(onMode).toHaveBeenCalledWith("original");
  });
});

describe("ExportPanel", () => {
  it("invokes export with chosen format and name", () => {
    const onExport = vi.fn();
    render(<ExportPanel onExport={onExport} />);
    fireEvent.change(screen.getByLabelText(/format/i), { target: { value: "flac" } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "karaoke" } });
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    expect(onExport).toHaveBeenCalledWith("flac", "karaoke");
  });
});