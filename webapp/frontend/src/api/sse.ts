export interface JobHandlers {
  onProgress?: (d: { progress: number; stage?: string; device?: string }) => void;
  onDone?: (d: { stems: Record<string, string> }) => void;
  onError?: (d: { message?: string }) => void;
}

export function subscribeJob(id: string, h: JobHandlers): () => void {
  const es = new EventSource(`/api/jobs/${id}/events`);
  es.addEventListener("progress", (e) => h.onProgress?.(JSON.parse((e as MessageEvent).data)));
  es.addEventListener("done", (e) => {
    h.onDone?.(JSON.parse((e as MessageEvent).data));
    es.close();
  });
  es.addEventListener("error", (e) => {
    // EventSource fires a generic error on disconnect with no data
    const data = (e as MessageEvent).data;
    if (data) h.onError?.(JSON.parse(data));
  });
  es.addEventListener("canceled", () => es.close());
  return () => es.close();
}