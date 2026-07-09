export function subscribeJob(id, h) {
    const es = new EventSource(`/api/jobs/${id}/events`);
    es.addEventListener("progress", (e) => h.onProgress?.(JSON.parse(e.data)));
    es.addEventListener("done", (e) => {
        h.onDone?.(JSON.parse(e.data));
        es.close();
    });
    es.addEventListener("error", (e) => {
        // EventSource fires a generic error on disconnect with no data
        const data = e.data;
        if (data)
            h.onError?.(JSON.parse(data));
    });
    es.addEventListener("canceled", () => es.close());
    return () => es.close();
}
