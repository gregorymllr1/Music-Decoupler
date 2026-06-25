import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Upload } from "../Upload";
import * as client from "../../api/client";

describe("Upload", () => {
  it("uploads selected file and reports created job", async () => {
    vi.spyOn(client, "listModels").mockResolvedValue([
      { name: "htdemucs", stems: ["drums", "bass", "other", "vocals"], description: "" },
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
});