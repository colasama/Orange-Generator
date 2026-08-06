import { Deflate } from "pako";

type WorkerRequest =
  | { type: "init"; width: number; height: number }
  | {
      type: "strip";
      id: number;
      rgba: ArrayBuffer;
      stripWidth: number;
      stripHeight: number;
    }
  | { type: "finish" };

type WorkerResponse =
  | { type: "ready" }
  | { type: "strip-done"; id: number }
  | { type: "finished"; bytes: ArrayBuffer }
  | { type: "error"; message: string };

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IDAT_CHUNK_SIZE = 32 * 1024;

let width = 0;
let height = 0;
let deflate: Deflate | null = null;

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = crcTable[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUInt32BE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  writeUInt32BE(chunk, 0, data.length);
  for (let index = 0; index < 4; index += 1) {
    chunk[4 + index] = type.charCodeAt(index);
  }
  chunk.set(data, 8);
  const crcInput = chunk.subarray(4, 8 + data.length);
  writeUInt32BE(chunk, 8 + data.length, crc32(crcInput));
  return chunk;
}

function assemblePng(zlibStream: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [PNG_SIGNATURE];

  const header = new Uint8Array(13);
  writeUInt32BE(header, 0, width);
  writeUInt32BE(header, 4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // color type: RGBA
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace
  parts.push(makeChunk("IHDR", header));

  for (let offset = 0; offset < zlibStream.length; offset += IDAT_CHUNK_SIZE) {
    const end = Math.min(offset + IDAT_CHUNK_SIZE, zlibStream.length);
    parts.push(makeChunk("IDAT", zlibStream.subarray(offset, end)));
  }

  parts.push(makeChunk("IEND", new Uint8Array(0)));

  let totalLength = 0;
  for (const part of parts) totalLength += part.length;
  const output = new Uint8Array(totalLength);
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

function respond(message: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const message = event.data;
    if (message.type === "init") {
      width = message.width;
      height = message.height;
      deflate = new Deflate({ level: 6 });
      respond({ type: "ready" });
      return;
    }

    if (!deflate) throw new Error("PNG encoder is not initialized");

    if (message.type === "strip") {
      const rgba = new Uint8ClampedArray(message.rgba);
      const rowBytes = message.stripWidth * 4 + 1;
      const block = new Uint8Array(rowBytes * message.stripHeight);
      for (let row = 0; row < message.stripHeight; row += 1) {
        block[row * rowBytes] = 0; // filter: None
        block.set(
          rgba.subarray(row * message.stripWidth * 4, (row + 1) * message.stripWidth * 4),
          row * rowBytes + 1,
        );
      }
      deflate.push(block, false);
      respond({ type: "strip-done", id: message.id });
      return;
    }

    deflate.push(new Uint8Array(0), true);
    const pngBytes = assemblePng(deflate.result);
    const output = pngBytes.buffer as ArrayBuffer;
    deflate = null;
    respond({ type: "finished", bytes: output }, [output]);
  } catch (error) {
    respond({
      type: "error",
      message: error instanceof Error ? error.message : "PNG encoding failed",
    });
  }
};
