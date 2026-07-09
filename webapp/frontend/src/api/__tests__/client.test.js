import { describe, it, expect, vi, beforeEach } from "vitest";
import * as client from "../client";
describe("api client", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });
    it("createJob posts multipart to /api/jobs", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ id: "x", status: "queued" }),
        });
        vi.stubGlobal("fetch", fetchMock);
        const file = new File([new Uint8Array([1, 2, 3])], "song.mp3");
        const job = await client.createJob(file, { model: "htdemucs", output_format: "wav" });
        expect(job.id).toBe("x");
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/jobs");
        expect(init.method).toBe("POST");
        expect(init.body).toBeInstanceOf(FormData);
    });
    it("stemUrl builds the download path", () => {
        expect(client.stemUrl("abc", "vocals")).toBe("/api/jobs/abc/stems/vocals");
    });
});
