import { GIFEncoder, applyPalette, quantize, type GifEncoder } from 'gifenc';

type WorkerRequest =
  | { type: 'init'; width: number; height: number }
  | { type: 'frame'; id: number; rgba: ArrayBuffer; delay: number }
  | { type: 'finish' };

type WorkerResponse =
  | { type: 'ready' }
  | { type: 'frame-done'; id: number }
  | { type: 'finished'; bytes: ArrayBuffer }
  | { type: 'error'; message: string };

let encoder: GifEncoder | null = null;
let width = 0;
let height = 0;

function respond(message: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const message = event.data;
    if (message.type === 'init') {
      width = message.width;
      height = message.height;
      encoder = GIFEncoder();
      respond({ type: 'ready' });
      return;
    }

    if (!encoder) throw new Error('GIF encoder is not initialized');

    if (message.type === 'frame') {
      const rgba = new Uint8ClampedArray(message.rgba);
      const palette = quantize(rgba, 256, { format: 'rgb444' });
      const indexed = applyPalette(rgba, palette, 'rgb444');
      encoder.writeFrame(indexed, width, height, {
        palette,
        delay: message.delay,
        repeat: 0,
      });
      respond({ type: 'frame-done', id: message.id });
      return;
    }

    encoder.finish();
    const bytes = encoder.bytes();
    const output = new Uint8Array(bytes).buffer;
    respond({ type: 'finished', bytes: output }, [output]);
    encoder = null;
  } catch (error) {
    respond({
      type: 'error',
      message: error instanceof Error ? error.message : 'GIF encoding failed',
    });
  }
};
