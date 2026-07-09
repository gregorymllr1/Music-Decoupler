import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { HealthBanner } from "../HealthBanner";
import * as client from "../../api/client";
describe("HealthBanner", () => {
    it("warns when ffmpeg missing", async () => {
        vi.spyOn(client, "health").mockResolvedValue({ db: true, ffmpeg: false, worker_alive: true });
        render(_jsx(HealthBanner, {}));
        await waitFor(() => expect(screen.getByText(/ffmpeg/i)).toBeTruthy());
    });
    it("renders nothing when healthy", async () => {
        vi.spyOn(client, "health").mockResolvedValue({ db: true, ffmpeg: true, worker_alive: true });
        const { container } = render(_jsx(HealthBanner, {}));
        await waitFor(() => expect(container.textContent).toBe(""));
    });
});
