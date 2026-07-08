import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ChannelStrip } from "../ChannelStrip";
import { Transport } from "../Transport";

describe("ChannelStrip", () => {
  it("fires mute/solo/volume callbacks", () => {
    const onMute = vi.fn(), onSolo = vi.fn(), onVolume = vi.fn();
    render(
      <ChannelStrip stem="vocals" label="vocals" volume={1} muted={false} solo={false}
        onMute={onMute} onSolo={onSolo} onVolume={onVolume} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /mute/i }));
    fireEvent.click(screen.getByRole("button", { name: /solo/i }));
    fireEvent.change(screen.getByLabelText(/volume/i), { target: { value: "0.5" } });
    expect(onMute).toHaveBeenCalledWith(true);
    expect(onSolo).toHaveBeenCalledWith(true);
    expect(onVolume).toHaveBeenCalledWith(0.5);
  });
});

describe("Transport", () => {
  it("toggles play and reports seek", () => {
    const onPlayPause = vi.fn(), onSeek = vi.fn();
    render(
      <Transport playing={false} currentTime={5} duration={60}
        onPlayPause={onPlayPause} onStop={vi.fn()} onSeek={onSeek}
        onPlaySelection={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^play$/i }));
    fireEvent.change(screen.getByLabelText(/seek/i), { target: { value: "12" } });
    expect(onPlayPause).toHaveBeenCalled();
    expect(onSeek).toHaveBeenCalledWith(12);
  });

  it("plays the selection via its own button", () => {
    const onPlaySelection = vi.fn();
    render(
      <Transport playing={false} currentTime={0} duration={60}
        onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()}
        onPlaySelection={onPlaySelection} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /play selection/i }));
    expect(onPlaySelection).toHaveBeenCalled();
  });

  it("disables play selection while stems are loading", () => {
    render(
      <Transport playing={false} currentTime={0} duration={0}
        onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()}
        onPlaySelection={vi.fn()} />,
    );
    const btn = screen.getByRole("button", { name: /play selection/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
