// Page-side handle on the attack worker. Cancelling terminates the worker
// (the attack loop never yields, so a message could not interrupt it) and
// the next request transparently starts a new worker and reloads the model.

export function createWorkerClient() {
  let worker = null;
  let modelBytes = null;
  let modelLoaded = false;
  let nextId = 1;
  const pending = new Map();

  function spawn() {
    worker = new Worker(new URL("../worker/attack-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const { id, type } = event.data;
      const req = pending.get(id);
      if (!req) return;
      if (type === "progress") {
        req.onProgress?.(event.data.progress);
        return;
      }
      pending.delete(id);
      if (type === "done") req.resolve(event.data.result);
      else req.reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      const err = new Error(event.message || "The worker failed to start (are you offline?).");
      pending.forEach((req) => req.reject(err));
      pending.clear();
    };
  }

  function request(body, onProgress) {
    if (!worker) spawn();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      // Copy the model bytes: transferring would detach the page's copy.
      worker.postMessage({ id, ...body });
    });
  }

  return {
    async loadModel(bytes) {
      modelBytes = bytes;
      modelLoaded = false;
      const summary = await request({ type: "load-model", bytes });
      modelLoaded = true;
      return summary;
    },
    async run(type, payload, onProgress) {
      if (!modelLoaded) {
        if (!modelBytes) throw new Error("Load a model first.");
        await request({ type: "load-model", bytes: modelBytes });
        modelLoaded = true;
      }
      return request({ type, ...payload }, onProgress);
    },
    cancel() {
      if (!worker) return;
      worker.terminate();
      worker = null;
      modelLoaded = false;
      const err = new Error("Cancelled.");
      err.cancelled = true;
      pending.forEach((req) => req.reject(err));
      pending.clear();
    },
  };
}
