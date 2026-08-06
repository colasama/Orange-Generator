type WorkerResponse =
  | { type: "ready" }
  | { type: "strip-done"; id: number }
  | { type: "finished"; bytes: ArrayBuffer }
  | { type: "error"; message: string };

interface PendingRequest {
  resolve: (value?: ArrayBuffer) => void;
  reject: (reason: Error) => void;
}

export class JpegEncodingSession {
  private readonly worker: Worker;
  private readonly pending = new Map<string | number, PendingRequest>();
  private nextStripId = 0;

  private constructor(worker: Worker) {
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === "error") {
        const error = new Error(message.message);
        this.pending.forEach(({ reject }) => reject(error));
        this.pending.clear();
        return;
      }

      const key =
        message.type === "strip-done"
          ? message.id
          : message.type === "finished"
            ? "finish"
            : "ready";
      const request = this.pending.get(key);
      if (!request) return;
      this.pending.delete(key);
      request.resolve(message.type === "finished" ? message.bytes : undefined);
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || "JPG 编码线程启动失败");
      this.pending.forEach(({ reject }) => reject(error));
      this.pending.clear();
    };
  }

  static async create(width: number, height: number, quality: number) {
    const session = new JpegEncodingSession(
      new Worker(new URL("./workers/jpegEncoder.worker.ts", import.meta.url), {
        type: "module",
      }),
    );
    const ready = session.waitFor("ready");
    session.worker.postMessage({ type: "init", width, height, quality });
    await ready;
    return session;
  }

  private waitFor(key: string | number) {
    return new Promise<ArrayBuffer | undefined>((resolve, reject) => {
      this.pending.set(key, { resolve, reject });
    });
  }

  async addStrip(imageData: ImageData, y: number) {
    const id = this.nextStripId;
    this.nextStripId += 1;
    const done = this.waitFor(id);
    const rgba = imageData.data.buffer.slice(
      imageData.data.byteOffset,
      imageData.data.byteOffset + imageData.data.byteLength,
    );
    this.worker.postMessage({ type: "strip", id, rgba, y }, [rgba]);
    await done;
  }

  async finish() {
    const finished = this.waitFor("finish");
    this.worker.postMessage({ type: "finish" });
    const bytes = await finished;
    if (!bytes) throw new Error("JPG 编码结果为空");
    return new Blob([bytes], { type: "image/jpeg" });
  }

  terminate() {
    this.worker.terminate();
  }
}
