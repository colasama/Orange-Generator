import type { ParsedFrame } from 'gifuct-js';
import { useEffect, useRef, useState } from 'react';

interface DecodedGif {
  width: number;
  height: number;
  frames: ParsedFrame[];
  frameStarts: number[];
  duration: number;
}

export interface GifAnimationController {
  canvas: HTMLCanvasElement;
  duration: number;
  renderAt(timeMs: number): void;
  play(): void;
  pause(): void;
}

const decodedGifCache = new Map<string, Promise<DecodedGif>>();
const gifControllers = new Map<string, GifAnimationController>();

function loadDecodedGif(src: string): Promise<DecodedGif> {
  const cached = decodedGifCache.get(src);
  if (cached) return cached;

  const request = Promise.all([
    fetch(src).then((response) => {
      if (!response.ok) throw new Error(`GIF load failed: ${response.status}`);
      return response.arrayBuffer();
    }),
    import('gifuct-js'),
  ]).then(([buffer, { decompressFrames, parseGIF }]) => {
      const gif = parseGIF(buffer);
      const frames = decompressFrames(gif, true);
      if (!frames.length) throw new Error('GIF has no frames');

      let duration = 0;
      const frameStarts = frames.map((frame) => {
        const start = duration;
        duration += Math.max(20, frame.delay || 100);
        return start;
      });

      return {
        width: gif.lsd.width,
        height: gif.lsd.height,
        frames,
        frameStarts,
        duration,
      };
    });

  decodedGifCache.set(src, request);
  void request.catch(() => decodedGifCache.delete(src));
  return request;
}

function createController(
  gif: DecodedGif,
  onFrame: () => void,
): GifAnimationController {
  const canvas = document.createElement('canvas');
  canvas.width = gif.width;
  canvas.height = gif.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D is unavailable');

  const patchCanvas = document.createElement('canvas');
  const patchContext = patchCanvas.getContext('2d');
  if (!patchContext) throw new Error('Canvas 2D is unavailable');

  let currentFrameIndex = -1;
  let restoreImage: ImageData | null = null;
  let animationFrame = 0;
  let playbackStartedAt = 0;

  const reset = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    currentFrameIndex = -1;
    restoreImage = null;
  };

  const disposeCurrentFrame = () => {
    if (currentFrameIndex < 0) return;
    const frame = gif.frames[currentFrameIndex];
    if (frame.disposalType === 2) {
      context.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
    } else if (frame.disposalType === 3 && restoreImage) {
      context.putImageData(restoreImage, 0, 0);
    }
    restoreImage = null;
  };

  const drawFrame = (frameIndex: number) => {
    const frame = gif.frames[frameIndex];
    if (frame.disposalType === 3) {
      restoreImage = context.getImageData(0, 0, canvas.width, canvas.height);
    }

    patchCanvas.width = frame.dims.width;
    patchCanvas.height = frame.dims.height;
    const patch = new Uint8ClampedArray(frame.patch.length);
    patch.set(frame.patch);
    patchContext.putImageData(
      new ImageData(patch, frame.dims.width, frame.dims.height),
      0,
      0,
    );
    context.drawImage(patchCanvas, frame.dims.left, frame.dims.top);
    currentFrameIndex = frameIndex;
  };

  const frameIndexAt = (timeMs: number) => {
    const normalized = ((timeMs % gif.duration) + gif.duration) % gif.duration;
    for (let index = gif.frameStarts.length - 1; index >= 0; index -= 1) {
      if (normalized >= gif.frameStarts[index]) return index;
    }
    return 0;
  };

  const renderAt = (timeMs: number) => {
    const targetFrame = frameIndexAt(timeMs);
    if (targetFrame < currentFrameIndex) reset();
    while (currentFrameIndex < targetFrame) {
      disposeCurrentFrame();
      drawFrame(currentFrameIndex + 1);
    }
    if (currentFrameIndex < 0) drawFrame(0);
    onFrame();
  };

  const tick = (timestamp: number) => {
    renderAt(timestamp - playbackStartedAt);
    animationFrame = requestAnimationFrame(tick);
  };

  return {
    canvas,
    duration: gif.duration,
    renderAt,
    play() {
      cancelAnimationFrame(animationFrame);
      playbackStartedAt = performance.now();
      animationFrame = requestAnimationFrame(tick);
    },
    pause() {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    },
  };
}

export function useGifCanvas(
  src: string | undefined,
  instanceId: string,
  onFrame: () => void,
) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    if (!src) {
      setCanvas(null);
      return;
    }

    let cancelled = false;
    let controller: GifAnimationController | null = null;

    void loadDecodedGif(src)
      .then((gif) => {
        if (cancelled) return;
        controller = createController(gif, () => onFrameRef.current());
        gifControllers.set(instanceId, controller);
        controller.renderAt(0);
        controller.play();
        setCanvas(controller.canvas);
      })
      .catch(() => {
        if (!cancelled) setCanvas(null);
      });

    return () => {
      cancelled = true;
      controller?.pause();
      if (gifControllers.get(instanceId) === controller) gifControllers.delete(instanceId);
    };
  }, [instanceId, src]);

  return canvas;
}

export async function waitForGifControllers(
  instanceIds: string[],
  timeoutMs = 12_000,
): Promise<GifAnimationController[]> {
  const uniqueIds = [...new Set(instanceIds)];
  const startedAt = performance.now();

  while (performance.now() - startedAt < timeoutMs) {
    const controllers = uniqueIds.map((id) => gifControllers.get(id));
    if (controllers.every(Boolean)) return controllers as GifAnimationController[];
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  }

  throw new Error('GIF 贴纸仍在加载，请稍后再试');
}
