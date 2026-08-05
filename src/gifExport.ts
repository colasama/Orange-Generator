type WorkerResponse =
  | { type: 'ready' }
  | { type: 'frame-done'; id: number }
  | { type: 'finished'; bytes: ArrayBuffer }
  | { type: 'error'; message: string };

interface PendingRequest {
  resolve: (value?: ArrayBuffer) => void;
  reject: (reason: Error) => void;
}

export class GifEncodingSession {
  private readonly worker: Worker;
  private readonly pending = new Map<string | number, PendingRequest>();
  private nextFrameId = 0;

  private constructor(worker: Worker) {
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'error') {
        const error = new Error(message.message);
        this.pending.forEach(({ reject }) => reject(error));
        this.pending.clear();
        return;
      }

      const key =
        message.type === 'frame-done'
          ? message.id
          : message.type === 'finished'
            ? 'finish'
            : 'ready';
      const request = this.pending.get(key);
      if (!request) return;
      this.pending.delete(key);
      request.resolve(message.type === 'finished' ? message.bytes : undefined);
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'GIF 编码线程启动失败');
      this.pending.forEach(({ reject }) => reject(error));
      this.pending.clear();
    };
  }

  static async create(width: number, height: number) {
    const session = new GifEncodingSession(
      new Worker(new URL('./workers/gifEncoder.worker.ts', import.meta.url), {
        type: 'module',
      }),
    );
    const ready = session.waitFor('ready');
    session.worker.postMessage({ type: 'init', width, height });
    await ready;
    return session;
  }

  private waitFor(key: string | number) {
    return new Promise<ArrayBuffer | undefined>((resolve, reject) => {
      this.pending.set(key, { resolve, reject });
    });
  }

  async addFrame(imageData: ImageData, delay: number) {
    const id = this.nextFrameId;
    this.nextFrameId += 1;
    const done = this.waitFor(id);
    const rgba = imageData.data.buffer.slice(
      imageData.data.byteOffset,
      imageData.data.byteOffset + imageData.data.byteLength,
    );
    this.worker.postMessage({ type: 'frame', id, rgba, delay }, [rgba]);
    await done;
  }

  async finish() {
    const finished = this.waitFor('finish');
    this.worker.postMessage({ type: 'finish' });
    const bytes = await finished;
    if (!bytes) throw new Error('GIF 编码结果为空');
    return new Blob([bytes], { type: 'image/gif' });
  }

  terminate() {
    this.worker.terminate();
  }
}
