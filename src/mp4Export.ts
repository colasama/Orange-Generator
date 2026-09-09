import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeVideo,
} from "mediabunny";

const MP4_MAX_PIXELS = 3840 * 2160;
const MP4_MAX_SIDE = 4096;
const MP4_SCALE_FALLBACKS = [1, 0.8, 2 / 3, 0.5, 1 / 3] as const;

interface ExportSize {
  width: number;
  height: number;
}

function evenDimension(value: number) {
  return Math.max(2, Math.round(value / 2) * 2);
}

function getLargestExportSize(sourceWidth: number, sourceHeight: number): ExportSize {
  const pixelScale = Math.sqrt(
    MP4_MAX_PIXELS / Math.max(1, sourceWidth * sourceHeight),
  );
  const sideScale = MP4_MAX_SIDE / Math.max(1, sourceWidth, sourceHeight);
  const scale = Math.min(1, pixelScale, sideScale);

  return {
    width: evenDimension(sourceWidth * scale),
    height: evenDimension(sourceHeight * scale),
  };
}

async function findSupportedExportSize(
  sourceWidth: number,
  sourceHeight: number,
  quality: Quality,
): Promise<ExportSize | null> {
  const largest = getLargestExportSize(sourceWidth, sourceHeight);
  const checked = new Set<string>();

  for (const fallbackScale of MP4_SCALE_FALLBACKS) {
    const candidate = {
      width: evenDimension(largest.width * fallbackScale),
      height: evenDimension(largest.height * fallbackScale),
    };
    const key = `${candidate.width}x${candidate.height}`;
    if (checked.has(key)) continue;
    checked.add(key);

    if (
      await canEncodeVideo("avc", {
        ...candidate,
        quality,
        latencyMode: "quality",
        hardwareAcceleration: "no-preference",
        contentHint: "detail",
      })
    ) {
      return candidate;
    }
  }

  return null;
}

export class Mp4EncodingSession {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;

  private readonly target: BufferTarget;
  private readonly output: Output<Mp4OutputFormat, BufferTarget>;
  private readonly videoSource: CanvasSource;
  private finalized = false;

  private constructor(
    canvas: HTMLCanvasElement,
    target: BufferTarget,
    output: Output<Mp4OutputFormat, BufferTarget>,
    videoSource: CanvasSource,
  ) {
    this.canvas = canvas;
    this.width = canvas.width;
    this.height = canvas.height;
    this.target = target;
    this.output = output;
    this.videoSource = videoSource;
  }

  static async create(sourceWidth: number, sourceHeight: number, frameRate: number) {
    const quality = new Quality("very-high");
    const exportSize = await findSupportedExportSize(
      sourceWidth,
      sourceHeight,
      quality,
    );
    if (!exportSize) {
      throw new Error(
        "当前浏览器不支持 H.264 MP4 编码，请改用 GIF，或使用最新版 Chrome / Safari。",
      );
    }

    const canvas = document.createElement("canvas");
    canvas.width = exportSize.width;
    canvas.height = exportSize.height;

    const target = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat(),
      target,
    });
    const videoSource = new CanvasSource(canvas, {
      codec: "avc",
      quality,
      latencyMode: "quality",
      hardwareAcceleration: "no-preference",
      contentHint: "detail",
      keyFrameInterval: 2,
    });

    output.addVideoTrack(videoSource, { frameRate });
    await output.start();

    return new Mp4EncodingSession(canvas, target, output, videoSource);
  }

  async addFrame(
    frameCanvas: HTMLCanvasElement,
    timestampMs: number,
    durationMs: number,
    keyFrame = false,
  ) {
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建 MP4 合成画布");

    context.clearRect(0, 0, this.width, this.height);
    context.drawImage(frameCanvas, 0, 0, this.width, this.height);
    await this.videoSource.add(timestampMs / 1000, durationMs / 1000, {
      keyFrame,
    });
  }

  async finish() {
    this.videoSource.close();
    await this.output.finalize();
    this.finalized = true;

    if (!this.target.buffer) throw new Error("MP4 编码结果为空");
    return new Blob([this.target.buffer], { type: "video/mp4" });
  }

  async cancel() {
    if (
      this.finalized ||
      this.output.state === "finalized" ||
      this.output.state === "canceled"
    ) {
      return;
    }
    await this.output.cancel();
  }
}
