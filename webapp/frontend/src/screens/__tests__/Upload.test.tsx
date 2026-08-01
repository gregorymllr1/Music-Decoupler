import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Upload } from "../Upload";
import * as client from "../../api/client";

describe("Upload", () => {
  it("uploads selected file and reports created job", async () => {
    vi.spyOn(client, "listModels").mockResolvedValue([
      { name: "htdemucs", stems: ["drums", "bass", "other", "vocals"], description: "" },
      { name: "htdemucs_ft", stems: ["drums", "bass", "other", "vocals"], description: "" },
    ]);
    const created = vi.fn();
    vi.spyOn(client, "createJob").mockResolvedValue({
      id: "j1", status: "queued", source_filename: "song.mp3",
      model: "htdemucs", output_format: "wav", progress: 0,
    });
    render(<Upload onCreated={created} />);
    const file = new File([new Uint8Array([1])], "song.mp3");
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByText(/separate/i));
    await waitFor(() => expect(created).toHaveBeenCalledWith(expect.objectContaining({ id: "j1" })));
  });

  it("sends only the chosen stem subset", async () => {
    vi.spyOn(client, "listModels").mockResolvedValue([
      { name: "htdemucs", stems: ["drums", "bass", "other", "vocals"], description: "" },
      { name: "htdemucs_ft", stems: ["drums", "bass", "other", "vocals"], description: "" },
    ]);
    const create = vi.spyOn(client, "createJob").mockResolvedValue({
      id: "j2", status: "queued", source_filename: "s.mp3",
      model: "htdemucs", output_format: "wav", progress: 0,
    });
    render(<Upload onCreated={vi.fn()} />);
    await screen.findByLabelText("vocals");
    fireEvent.click(screen.getByLabelText("drums")); // uncheck drums
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [new File([new Uint8Array([1])], "s.mp3")] },
    });
    fireEvent.click(screen.getByText(/separate/i));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const opts = create.mock.calls[0][1];
    expect(opts.stems).toEqual(["bass", "other", "vocals"]);
  });

  it("creates one job per file sharing a batch_id", async () => {
    vi.spyOn(client, "listModels").mockResolvedValue([
      { name: "htdemucs", stems: ["drums", "bass", "other", "vocals"], description: "" },
      { name: "htdemucs_ft", stems: ["drums", "bass", "other", "vocals"], description: "" },
    ]);
    const create = vi.spyOn(client, "createJob").mockImplementation(async (f) => ({
      id: f.name, status: "queued", source_filename: f.name,
      model: "htdemucs", output_format: "wav", progress: 0,
    }));
    render(<Upload onCreated={vi.fn()} />);
    await screen.findByLabelText("vocals");
    const f1 = new File([new Uint8Array([1])], "a.mp3");
    const f2 = new File([new Uint8Array([2])], "b.mp3");
    fireEvent.change(screen.getByTestId("file-input"), { target: { files: [f1, f2] } });
    fireEvent.click(screen.getByText(/separate/i));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    const batchA = create.mock.calls[0][1].batch_id;
    const batchB = create.mock.calls[1][1].batch_id;
    expect(batchA).toBeTruthy();
    expect(batchA).toBe(batchB);
  });

  it("defaults to the High preset (htdemucs_ft, shifts 1, overlap 0.25)", async () => {
    vi.spyOn(client, "listModels").mockResolvedValue([
      { name: "htdemucs", stems: ["drums", "bass", "other", "vocals"], description: "" },
      { name: "htdemucs_ft", stems: ["drums", "bass", "other", "vocals"], description: "" },
    ]);
    const create = vi.spyOn(client, "createJob").mockResolvedValue({
      id: "j4", status: "queued", source_filename: "s.mp3",
      model: "htdemucs_ft", output_format: "wav", progress: 0,
    });
    render(<Upload onCreated={vi.fn()} />);
    await screen.findByLabelText("vocals");
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [new File([new Uint8Array([1])], "s.mp3")] },
    });
    fireEvent.click(screen.getByText(/separate/i));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const opts = create.mock.calls[0][1];
    expect(opts.model).toBe("htdemucs_ft");
    expect(opts.shifts).toBe(1);
    expect(opts.overlap).toBe(0.25);
  });

  it("Max preset sends shifts 2 and overlap 0.5", async () => {
    vi.spyOn(client, "listModels").mockResolvedValue([
      { name: "htdemucs", stems: ["drums", "bass", "other", "vocals"], description: "" },
      { name: "htdemucs_ft", stems: ["drums", "bass", "other", "vocals"], description: "" },
    ]);
    const create = vi.spyOn(client, "createJob").mockResolvedValue({
      id: "j5", status: "queued", source_filename: "s.mp3",
      model: "htdemucs_ft", output_format: "wav", progress: 0,
    });
    render(<Upload onCreated={vi.fn()} />);
    await screen.findByLabelText("vocals");
    fireEvent.change(screen.getByLabelText("quality"), { target: { value: "max" } });
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [new File([new Uint8Array([1])], "s.mp3")] },
    });
    fireEvent.click(screen.getByText(/separate/i));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const opts = create.mock.calls[0][1];
    expect(opts.model).toBe("htdemucs_ft");
    expect(opts.shifts).toBe(2);
    expect(opts.overlap).toBe(0.5);
  });

  it("manual model override keeps the preset quality knobs", async () => {
    vi.spyOn(client, "listModels").mockResolvedValue([
      { name: "htdemucs", stems: ["drums", "bass", "other", "vocals"], description: "" },
      { name: "htdemucs_ft", stems: ["drums", "bass", "other", "vocals"], description: "" },
    ]);
    const create = vi.spyOn(client, "createJob").mockResolvedValue({
      id: "j6", status: "queued", source_filename: "s.mp3",
      model: "htdemucs", output_format: "wav", progress: 0,
    });
    render(<Upload onCreated={vi.fn()} />);
    await screen.findByLabelText("vocals");
    fireEvent.change(screen.getByLabelText("model"), { target: { value: "htdemucs" } });
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [new File([new Uint8Array([1])], "s.mp3")] },
    });
    fireEvent.click(screen.getByText(/separate/i));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const opts = create.mock.calls[0][1];
    expect(opts.model).toBe("htdemucs");
    expect(opts.shifts).toBe(1); // High preset knobs retained
    expect(opts.overlap).toBe(0.25);
  });
});