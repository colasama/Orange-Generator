export interface ImageDimensions {
  width: number;
  height: number;
}

function readUInt16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function bytesEqual(bytes: Uint8Array, offset: number, pattern: number[]): boolean {
  for (let index = 0; index < pattern.length; index += 1) {
    if (bytes[offset + index] !== pattern[index]) return false;
  }
  return true;
}

/**
 * 从图片文件头解析像素尺寸，避免为了取尺寸而完整解码大图。
 * 支持 PNG / GIF / WebP / JPEG；无法解析时返回 null（由调用方回退到完整解码）。
 */
export function parseImageDimensions(
  bytes: Uint8Array,
): ImageDimensions | null {
  // PNG
  if (
    bytes.length >= 24 &&
    bytesEqual(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return {
      width: readUInt32BE(bytes, 16),
      height: readUInt32BE(bytes, 20),
    };
  }

  // GIF
  if (bytes.length >= 10 && bytesEqual(bytes, 0, [0x47, 0x49, 0x46])) {
    return {
      width: readUInt16LE(bytes, 6),
      height: readUInt16LE(bytes, 8),
    };
  }

  // WebP
  if (
    bytes.length >= 30 &&
    bytesEqual(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
    bytesEqual(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunkType === "VP8X" && bytes.length >= 30) {
      return {
        width: readUInt24LE(bytes, 24) + 1,
        height: readUInt24LE(bytes, 27) + 1,
      };
    }
    if (chunkType === "VP8 " && bytes.length >= 30) {
      return {
        width: readUInt16LE(bytes, 26) & 0x3fff,
        height: readUInt16LE(bytes, 28) & 0x3fff,
      };
    }
    if (chunkType === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      return {
        width: 1 + ((bytes[21] | (bytes[22] << 8)) & 0x3fff),
        height:
          1 +
          ((((bytes[22] >> 6) | (bytes[23] << 2) | (bytes[24] << 10)) & 0x3fff) >>> 0),
      };
    }
  }

  // JPEG
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      let marker = bytes[offset + 1];
      while (marker === 0xff && offset + 2 < bytes.length) {
        offset += 1;
        marker = bytes[offset + 1];
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        offset += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) break;
      const segmentLength = readUInt16BE(bytes, offset + 2);
      if (segmentLength < 2) break;
      const isStartOfFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isStartOfFrame && offset + 9 < bytes.length) {
        return {
          height: readUInt16BE(bytes, offset + 5),
          width: readUInt16BE(bytes, offset + 7),
        };
      }
      offset += 2 + segmentLength;
    }
  }

  return null;
}

export async function readImageDimensions(file: File): Promise<ImageDimensions | null> {
  try {
    const buffer = await file.arrayBuffer();
    return parseImageDimensions(new Uint8Array(buffer));
  } catch {
    return null;
  }
}
