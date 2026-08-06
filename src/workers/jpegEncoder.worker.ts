type WorkerRequest =
  | { type: "init"; width: number; height: number; quality: number }
  | { type: "strip"; id: number; rgba: ArrayBuffer; y: number }
  | { type: "finish" };

type WorkerResponse =
  | { type: "ready" }
  | { type: "strip-done"; id: number }
  | { type: "finished"; bytes: ArrayBuffer }
  | { type: "error"; message: string };

// jpeg-js 的编码器在打包环境下会走 Buffer.from 分支，
// 这里在动态加载 jpeg-js 之前注入一个最小 Buffer shim。
if (!("Buffer" in globalThis)) {
  const bufferShim = {
    from(value: Uint8Array | ArrayBuffer | ArrayLike<number>): Uint8Array {
      if (value instanceof Uint8Array) {
        return value.slice(0);
      }
      if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
      }
      return Uint8Array.from(value as ArrayLike<number>);
    },
  };
  (globalThis as Record<string, unknown>).Buffer = bufferShim;
}

let width = 0;
let height = 0;
let quality = 90;
let rgba: Uint8ClampedArray | null = null;

function respond(message: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const message = event.data;
    if (message.type === "init") {
      width = message.width;
      height = message.height;
      quality = message.quality;
      rgba = new Uint8ClampedArray(width * height * 4);
      respond({ type: "ready" });
      return;
    }

    if (!rgba) throw new Error("JPEG encoder is not initialized");

    if (message.type === "strip") {
      const source = new Uint8ClampedArray(message.rgba);
      rgba.set(source, message.y * width * 4);
      respond({ type: "strip-done", id: message.id });
      return;
    }

    void (async () => {
      try {
        const { encode } = await import("jpeg-js");
        const encoded = encode({ data: rgba, width, height }, quality);
        const bytes = (encoded.data as Uint8Array).buffer as ArrayBuffer;
        rgba = null;
        respond({ type: "finished", bytes }, [bytes]);
      } catch (error) {
        respond({
          type: "error",
          message: error instanceof Error ? error.message : "JPEG encoding failed",
        });
      }
    })();
  } catch (error) {
    respond({
      type: "error",
      message: error instanceof Error ? error.message : "JPEG encoding failed",
    });
  }
};
