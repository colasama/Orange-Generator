import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { createPortal } from "react-dom";
import { Button, Card, Modal, Tooltip } from "animal-island-ui";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  BoundingBox,
  CheckCircle,
  Circle,
  Copy,
  DownloadSimple,
  FlipHorizontal,
  FlipVertical,
  ImageSquare,
  Info,
  Palette,
  PencilSimple,
  SlidersHorizontal,
  ShareNetwork,
  StackSimple,
  Trash,
  UploadSimple,
  WarningCircle,
  XCircle,
  X,
} from "@phosphor-icons/react";
import Konva from "konva";
import { Image as KonvaImage, Layer, Rect, Stage } from "react-konva";
import {
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  STICKER_ASSETS,
  type BackgroundImage,
  type PlacedSticker,
  type StickerAsset,
} from "../types";
import { useHtmlImage } from "../hooks/useHtmlImage";
import { waitForGifControllers } from "../hooks/useGifCanvas";
import { GifEncodingSession } from "../gifExport";
import { StickerNode } from "./StickerNode";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);
const ALLOWED_STICKER_TYPES = new Set([...ALLOWED_IMAGE_TYPES, "image/gif"]);
const GIF_EXPORT_FPS = 12;
const GIF_EXPORT_MAX_DURATION_MS = 6_000;
const GIF_EXPORT_MAX_PIXELS = 1_500_000;
const RECOLOR_HINT_SESSION_KEY = "orange-generator:recolor-hint-shown";
const FIRST_RECOLORABLE_STICKER_ID = STICKER_ASSETS.find(
  (asset) => asset.format === "SVG" && asset.defaultFillColor
)?.id;

type StickerUpdater = (stickers: PlacedSticker[]) => PlacedSticker[];
type ToastKind = "success" | "info" | "warning" | "error";
type MobileAdjustmentSection = "color" | "transform" | "outline" | "shadow";

interface ToastState {
  kind: ToastKind;
  message: string;
  description?: string;
}

interface ExportedImage {
  file: File;
  url: string;
}

type ExportState =
  | { status: "idle" }
  | { status: "generating" }
  | { status: "ready"; image: ExportedImage }
  | { status: "error"; message: string };

function CanvasButtonLabel({ text }: { text: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const button = canvas?.closest("button");
    if (!canvas || !button) return;

    const draw = () => {
      const styles = window.getComputedStyle(button);
      const fontSize = Number.parseFloat(styles.fontSize) || 24;
      const configuredStrokeWidth = Number.parseFloat(
        styles.getPropertyValue("--save-label-stroke-width")
      );
      const strokeWidth = Number.isFinite(configuredStrokeWidth)
        ? configuredStrokeWidth
        : Math.max(2, fontSize * 0.2);
      const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
      const context = canvas.getContext("2d");
      if (!context) return;

      const font = `${styles.fontStyle} ${styles.fontWeight} ${fontSize}px ${styles.fontFamily}`;
      context.font = font;
      const textWidth = context.measureText(text).width;
      const width = Math.ceil(textWidth + strokeWidth * 4);
      const height = Math.ceil(fontSize * 1.35 + strokeWidth * 2);

      canvas.width = Math.ceil(width * pixelRatio);
      canvas.height = Math.ceil(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      context.scale(pixelRatio, pixelRatio);
      context.font = font;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineJoin = "round";
      context.lineWidth = strokeWidth;
      context.strokeStyle =
        styles.getPropertyValue("--save-label-stroke").trim() || "#df8700";
      context.fillStyle = "#fff";
      context.strokeText(text, width / 2, height / 2);
      context.fillText(text, width / 2, height / 2);
    };

    let drawFrame = 0;
    const scheduleDraw = () => {
      window.cancelAnimationFrame(drawFrame);
      drawFrame = window.requestAnimationFrame(draw);
    };

    draw();
    const resizeObserver = new ResizeObserver(scheduleDraw);
    resizeObserver.observe(button);

    // Rsbuild's CSS HMR mutates or replaces nodes in <head>. Watching those
    // changes keeps canvas-only styles in sync without requiring a page reload.
    const styleObserver = new MutationObserver(scheduleDraw);
    styleObserver.observe(document.head, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });

    window.addEventListener("resize", scheduleDraw);
    document.fonts?.addEventListener("loadingdone", scheduleDraw);
    void document.fonts?.ready.then(scheduleDraw);

    return () => {
      window.cancelAnimationFrame(drawFrame);
      resizeObserver.disconnect();
      styleObserver.disconnect();
      window.removeEventListener("resize", scheduleDraw);
      document.fonts?.removeEventListener("loadingdone", scheduleDraw);
    };
  }, [text]);

  return (
    <canvas
      ref={canvasRef}
      className="canvas-button-label"
      aria-hidden="true"
    />
  );
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("浏览器无法生成 PNG 图片"));
    }, "image/png");
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("浏览器无法读取生成的图片"));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("浏览器无法读取生成的图片"));
    reader.readAsDataURL(blob);
  });
}

function shouldUseMobileSaveFlow() {
  return (
    window.matchMedia("(hover: none) and (pointer: coarse)").matches ||
    window.innerWidth <= 767
  );
}

function useMobileLayout() {
  const [isMobileLayout, setIsMobileLayout] = useState(
    () => window.matchMedia("(max-width: 767px)").matches
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const updateLayout = () => setIsMobileLayout(mediaQuery.matches);

    updateLayout();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateLayout);
      return () => mediaQuery.removeEventListener("change", updateLayout);
    }

    mediaQuery.addListener(updateLayout);
    return () => mediaQuery.removeListener(updateLayout);
  }, []);

  return isMobileLayout;
}

function canShareFile(file: File) {
  try {
    return (
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [file] })
    );
  } catch {
    return false;
  }
}

function useStickerHistory() {
  const [stickers, setStickers] = useState<PlacedSticker[]>([]);
  const pastRef = useRef<PlacedSticker[][]>([]);
  const futureRef = useRef<PlacedSticker[][]>([]);

  const commit = useCallback((updater: StickerUpdater) => {
    setStickers((current) => {
      const next = updater(current);
      if (next === current) return current;
      pastRef.current = [...pastRef.current.slice(-39), current];
      futureRef.current = [];
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setStickers((current) => {
      const previous = pastRef.current.at(-1);
      if (!previous) return current;
      pastRef.current = pastRef.current.slice(0, -1);
      futureRef.current = [current, ...futureRef.current.slice(0, 39)];
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    setStickers((current) => {
      const next = futureRef.current[0];
      if (!next) return current;
      futureRef.current = futureRef.current.slice(1);
      pastRef.current = [...pastRef.current.slice(-39), current];
      return next;
    });
  }, []);

  const reset = useCallback((next: PlacedSticker[] = []) => {
    pastRef.current = [];
    futureRef.current = [];
    setStickers(next);
  }, []);

  return {
    stickers,
    commit,
    undo,
    redo,
    reset,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
  };
}

function useCanvasScale(
  containerRef: React.RefObject<HTMLDivElement | null>,
  canvasWidth: number,
  canvasHeight: number
) {
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateScale = () => {
      const availableWidth = Math.max(280, container.clientWidth);
      const widthScale = availableWidth / canvasWidth;
      const isDesktop = window.innerWidth >= 768;
      const availableHeight = container.clientHeight;
      const heightScale =
        isDesktop && availableHeight > 0
          ? availableHeight / canvasHeight
          : Number.POSITIVE_INFINITY;
      setScale(Math.max(0.01, Math.min(8, widthScale, heightScale)));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(container);
    window.addEventListener("resize", updateScale);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [canvasHeight, canvasWidth, containerRef]);

  return scale;
}

async function loadBackgroundFile(file: File): Promise<BackgroundImage> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("仅支持 PNG、JPG、WebP 或 SVG 图片");
  }

  const src = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => {
      resolve({
        src,
        name: file.name,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error("图片读取失败，请换一张图片重试"));
    };
    image.src = src;
  });
}

function getStickerFormat(file: File): StickerAsset["format"] {
  if (file.type === "image/gif") return "GIF";
  if (file.type === "image/svg+xml") return "SVG";
  if (file.type === "image/jpeg") return "JPG";
  if (file.type === "image/webp") return "WebP";
  return "PNG";
}

async function loadCustomStickerFile(file: File): Promise<StickerAsset> {
  if (!ALLOWED_STICKER_TYPES.has(file.type)) {
    throw new Error("仅支持 PNG、JPG、WebP、SVG 或 GIF 图片");
  }

  const src = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        URL.revokeObjectURL(src);
        reject(new Error("无法读取贴纸尺寸，请换一张图片重试"));
        return;
      }

      const name = file.name.replace(/\.[^.]+$/, "").trim() || "自定义贴纸";
      resolve({
        id: `custom-${makeInstanceId()}`,
        name,
        src,
        format: getStickerFormat(file),
        aspectRatio: image.naturalWidth / image.naturalHeight,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error("贴纸图片读取失败，请换一张图片重试"));
    };
    image.src = src;
  });
}

function makeInstanceId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `sticker-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface IconActionProps {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function IconAction({ label, disabled, onClick, children }: IconActionProps) {
  return (
    <Tooltip title={label} placement="bottom" variant="island">
      <Button
        className="icon-action"
        size="middle"
        disabled={disabled}
        onClick={onClick}
        aria-label={label}
        icon={children}
      />
    </Tooltip>
  );
}

interface AdjustmentSliderProps {
  label: string;
  value: number;
  leftHint?: string;
  rightHint?: string;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}

function AdjustmentSlider({
  label,
  value,
  leftHint,
  rightHint,
  min = -100,
  max = 100,
  step = 1,
  suffix,
  onChange,
}: AdjustmentSliderProps) {
  const valueText = suffix
    ? `${value}${suffix}`
    : value > 0
    ? `+${value}`
    : `${value}`;
  return (
    <label className="adjustment-control">
      <span className="adjustment-label">
        <span>{label}</span>
        <output>{valueText}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
      />
      {(leftHint || rightHint) && (
        <span className="adjustment-hints" aria-hidden="true">
          <span>{leftHint}</span>
          <span>{rightHint}</span>
        </span>
      )}
    </label>
  );
}

const EFFECT_SLIDER_THROTTLE_MS = 96;
const EFFECT_SLIDER_DEBOUNCE_MS = 180;
const MIN_GENERATING_DISPLAY_MS = 600;

function ThrottledAdjustmentSlider({
  value,
  onChange,
  ...props
}: AdjustmentSliderProps) {
  const [draftValue, setDraftValue] = useState(value);
  const onChangeRef = useRef(onChange);
  const pendingValueRef = useRef<number | null>(null);
  const lastAppliedValueRef = useRef(value);
  const lastAppliedAtRef = useRef(0);
  const throttleTimerRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const interactingRef = useRef(false);

  onChangeRef.current = onChange;

  const applyPendingValue = useCallback(() => {
    if (throttleTimerRef.current) {
      window.clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    const nextValue = pendingValueRef.current;
    pendingValueRef.current = null;
    if (nextValue === null || nextValue === lastAppliedValueRef.current) return;
    lastAppliedAtRef.current = performance.now();
    lastAppliedValueRef.current = nextValue;
    onChangeRef.current(nextValue);
  }, []);

  const finishChange = useCallback(() => {
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    applyPendingValue();
    interactingRef.current = false;
  }, [applyPendingValue]);

  const queueChange = useCallback(
    (nextValue: number) => {
      interactingRef.current = true;
      pendingValueRef.current = nextValue;
      setDraftValue(nextValue);

      const elapsed = performance.now() - lastAppliedAtRef.current;
      if (elapsed >= EFFECT_SLIDER_THROTTLE_MS) {
        applyPendingValue();
      } else if (!throttleTimerRef.current) {
        throttleTimerRef.current = window.setTimeout(
          applyPendingValue,
          EFFECT_SLIDER_THROTTLE_MS - elapsed
        );
      }

      if (debounceTimerRef.current)
        window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = window.setTimeout(
        finishChange,
        EFFECT_SLIDER_DEBOUNCE_MS
      );
    },
    [applyPendingValue, finishChange]
  );

  useEffect(() => {
    if (interactingRef.current) return;
    setDraftValue(value);
    lastAppliedValueRef.current = value;
  }, [value]);

  useEffect(
    () => () => {
      if (throttleTimerRef.current)
        window.clearTimeout(throttleTimerRef.current);
      if (debounceTimerRef.current)
        window.clearTimeout(debounceTimerRef.current);
    },
    []
  );

  return (
    <AdjustmentSlider {...props} value={draftValue} onChange={queueChange} />
  );
}

interface StickerInspectorProps {
  sticker: PlacedSticker;
  onUpdate: (patch: Partial<PlacedSticker>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const FILL_COLOR_PRESETS = [
  { kind: "solid", label: "蓝色", value: "#096BC1", swatch: "#096BC1" },
  { kind: "solid", label: "白色", value: "#FFFFFF", swatch: "#FFFFFF" },
  { kind: "solid", label: "橙色", value: "#FFA011", swatch: "#FFA011" },
  {
    kind: "variant",
    label: "彩色一",
    src: "/assets/stickers/orange-lettering-1.svg",
    swatch:
      "linear-gradient(135deg, #096BC1 0 50%, #FFC639 50% 75%, #4AB2F3 75%)",
  },
  {
    kind: "variant",
    label: "彩色二",
    src: "/assets/stickers/orange-lettering-2.svg",
    swatch:
      "conic-gradient(from 45deg, #FFA011 0 25%, #096BC1 25% 50%, #FFFFFF 50% 75%, #4AB2F3 75%)",
  },
] as const;
const COLOR_THROTTLE_MS = 120;
const COLOR_DEBOUNCE_MS = 240;

function FillColorControl({
  sticker,
  onChange,
}: {
  sticker: PlacedSticker;
  onChange: (patch: Pick<PlacedSticker, "fillColor" | "variantSrc">) => void;
}) {
  const initialColor =
    sticker.fillColor ?? sticker.defaultFillColor ?? "#096BC1";
  const [draftColor, setDraftColor] = useState(initialColor);
  const onChangeRef = useRef(onChange);
  const pendingColorRef = useRef<string | null>(null);
  const lastAppliedColorRef = useRef(initialColor);
  const lastAppliedAtRef = useRef(0);
  const throttleTimerRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const interactingRef = useRef(false);
  const activeVariantRef = useRef(sticker.variantSrc);

  onChangeRef.current = onChange;

  const applyPendingColor = useCallback(() => {
    if (throttleTimerRef.current) {
      window.clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    const nextColor = pendingColorRef.current;
    pendingColorRef.current = null;
    if (
      !nextColor ||
      (nextColor === lastAppliedColorRef.current && !activeVariantRef.current)
    ) {
      return;
    }
    lastAppliedAtRef.current = performance.now();
    lastAppliedColorRef.current = nextColor;
    activeVariantRef.current = undefined;
    onChangeRef.current({ fillColor: nextColor, variantSrc: undefined });
  }, []);

  const finishColorChange = useCallback(() => {
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    applyPendingColor();
    interactingRef.current = false;
  }, [applyPendingColor]);

  const queueColorChange = useCallback(
    (nextColor: string) => {
      interactingRef.current = true;
      pendingColorRef.current = nextColor;
      setDraftColor(nextColor);

      const elapsed = performance.now() - lastAppliedAtRef.current;
      if (elapsed >= COLOR_THROTTLE_MS) {
        applyPendingColor();
      } else if (!throttleTimerRef.current) {
        throttleTimerRef.current = window.setTimeout(
          applyPendingColor,
          COLOR_THROTTLE_MS - elapsed
        );
      }

      if (debounceTimerRef.current)
        window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = window.setTimeout(
        finishColorChange,
        COLOR_DEBOUNCE_MS
      );
    },
    [applyPendingColor, finishColorChange]
  );

  const applyPreset = (nextColor: string) => {
    if (throttleTimerRef.current) window.clearTimeout(throttleTimerRef.current);
    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    throttleTimerRef.current = null;
    debounceTimerRef.current = null;
    pendingColorRef.current = null;
    interactingRef.current = false;
    setDraftColor(nextColor);
    if (nextColor !== lastAppliedColorRef.current || activeVariantRef.current) {
      lastAppliedAtRef.current = performance.now();
      lastAppliedColorRef.current = nextColor;
      activeVariantRef.current = undefined;
      onChangeRef.current({ fillColor: nextColor, variantSrc: undefined });
    }
  };

  const applyVariant = (variantSrc: string) => {
    if (throttleTimerRef.current) window.clearTimeout(throttleTimerRef.current);
    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    throttleTimerRef.current = null;
    debounceTimerRef.current = null;
    pendingColorRef.current = null;
    interactingRef.current = false;
    if (variantSrc === activeVariantRef.current) return;
    activeVariantRef.current = variantSrc;
    onChangeRef.current({ fillColor: undefined, variantSrc });
  };

  useEffect(() => {
    if (interactingRef.current) return;
    const nextColor =
      sticker.fillColor ?? sticker.defaultFillColor ?? "#096BC1";
    setDraftColor(nextColor);
    lastAppliedColorRef.current = nextColor;
    activeVariantRef.current = sticker.variantSrc;
  }, [
    sticker.defaultFillColor,
    sticker.fillColor,
    sticker.instanceId,
    sticker.variantSrc,
  ]);

  useEffect(
    () => () => {
      if (throttleTimerRef.current)
        window.clearTimeout(throttleTimerRef.current);
      if (debounceTimerRef.current)
        window.clearTimeout(debounceTimerRef.current);
    },
    []
  );

  return (
    <div className="fill-color-control">
      <div className="fill-color-custom">
        <span className="adjustment-label">
          <span>填充颜色</span>
          <output>
            {sticker.variantSrc ? "彩色预设" : draftColor.toUpperCase()}
          </output>
        </span>
        <div
          className="fill-color-picker"
          style={{ "--fill-color": draftColor } as React.CSSProperties}
        >
          <span className="fill-color-picker-icon" aria-hidden="true">
            <PencilSimple size="1em" weight="bold" />
          </span>
          <input
            type="color"
            value={draftColor}
            onChange={(event) => queueColorChange(event.target.value)}
            onBlur={finishColorChange}
            aria-label={`${sticker.name}填充颜色`}
          />
        </div>
      </div>
      <div className="fill-color-preset-group">
        <span className="fill-color-preset-label">预设颜色</span>
        <div className="fill-color-presets" aria-label="预设颜色">
          {FILL_COLOR_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.kind === "solid" ? preset.value : preset.src}
              className={`${
                preset.kind === "variant" ? "is-variant" : "is-solid"
              }${
                preset.kind === "solid"
                  ? !sticker.variantSrc &&
                    draftColor.toUpperCase() === preset.value
                    ? " is-active"
                    : ""
                  : sticker.variantSrc === preset.src
                  ? " is-active"
                  : ""
              }`}
              style={{ "--preset-color": preset.swatch } as React.CSSProperties}
              onClick={() =>
                preset.kind === "solid"
                  ? applyPreset(preset.value)
                  : applyVariant(preset.src)
              }
              aria-label={`使用${preset.label}`}
              aria-pressed={
                preset.kind === "solid"
                  ? !sticker.variantSrc &&
                    draftColor.toUpperCase() === preset.value
                  : sticker.variantSrc === preset.src
              }
            >
              <span className="fill-color-preset-swatch" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function EffectToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="effect-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden="true" />
      <strong>{label}</strong>
    </label>
  );
}

function StickerInspector({
  sticker,
  onUpdate,
  onDuplicate,
  onDelete,
  onClose,
}: StickerInspectorProps) {
  const supportsVisualEffects = sticker.format !== "GIF";

  return (
    <Card className="inspector-panel" color="app-yellow">
      <div className="inspector-heading">
        <div>
          <span className="inspector-kicker">正在编辑</span>
          <strong>贴纸调整</strong>
        </div>
        <Button
          className="panel-close"
          type="text"
          size="small"
          icon={<X size="1em" weight="bold" />}
          aria-label="关闭调整面板"
          onClick={onClose}
        />
      </div>

      <div className="adjustment-stack">
        <div className="transform-control">
          <span className="adjustment-label">翻转</span>
          <div className="transform-actions" aria-label="贴纸翻转">
            <Button
              className={sticker.flipX ? "is-active" : undefined}
              size="small"
              icon={<FlipHorizontal size="1em" weight="bold" />}
              aria-pressed={sticker.flipX}
              onClick={() => onUpdate({ flipX: !sticker.flipX })}
            >
              水平翻转
            </Button>
            <Button
              className={sticker.flipY ? "is-active" : undefined}
              size="small"
              icon={<FlipVertical size="1em" weight="bold" />}
              aria-pressed={sticker.flipY}
              onClick={() => onUpdate({ flipY: !sticker.flipY })}
            >
              垂直翻转
            </Button>
          </div>
        </div>
        {supportsVisualEffects ? (
          <>
            {sticker.defaultFillColor && (
              <FillColorControl sticker={sticker} onChange={onUpdate} />
            )}
            <AdjustmentSlider
              label="色相"
              value={sticker.hue}
              min={-180}
              max={180}
              suffix="°"
              onChange={(hue) => onUpdate({ hue })}
            />
            <AdjustmentSlider
              label="饱和度"
              value={sticker.saturation}
              onChange={(saturation) => onUpdate({ saturation })}
            />
            <AdjustmentSlider
              label="明度"
              value={sticker.brightness}
              onChange={(brightness) => onUpdate({ brightness })}
            />
            <AdjustmentSlider
              label="对比度"
              value={sticker.contrast}
              onChange={(contrast) => onUpdate({ contrast })}
            />
            <AdjustmentSlider
              label="白平衡"
              value={sticker.warmth}
              onChange={(warmth) => onUpdate({ warmth })}
            />

            <div className="effect-panel">
              <EffectToggle
                label="白边"
                checked={sticker.outlineEnabled}
                onChange={(outlineEnabled) => onUpdate({ outlineEnabled })}
              />
              {sticker.outlineEnabled && (
                <div className="effect-controls">
                  <label className="effect-color-control">
                    <span>边缘颜色</span>
                    <input
                      type="color"
                      value={sticker.outlineColor}
                      onChange={(event) =>
                        onUpdate({ outlineColor: event.target.value })
                      }
                      aria-label="白边颜色"
                    />
                  </label>
                  <ThrottledAdjustmentSlider
                    label="白边宽度"
                    value={sticker.outlineWidth}
                    min={1}
                    max={40}
                    suffix="px"
                    leftHint="细"
                    rightHint="粗"
                    onChange={(outlineWidth) => onUpdate({ outlineWidth })}
                  />
                </div>
              )}
            </div>

            <div className="effect-panel">
              <EffectToggle
                label="阴影"
                checked={sticker.shadowEnabled}
                onChange={(shadowEnabled) => onUpdate({ shadowEnabled })}
              />
              {sticker.shadowEnabled && (
                <div className="effect-controls">
                  <label className="effect-color-control">
                    <span>阴影颜色</span>
                    <input
                      type="color"
                      value={sticker.shadowColor}
                      onChange={(event) =>
                        onUpdate({ shadowColor: event.target.value })
                      }
                      aria-label="阴影颜色"
                    />
                  </label>
                  <ThrottledAdjustmentSlider
                    label="阴影大小"
                    value={sticker.shadowSize}
                    min={50}
                    max={150}
                    suffix="%"
                    leftHint="小"
                    rightHint="大"
                    onChange={(shadowSize) => onUpdate({ shadowSize })}
                  />
                  <ThrottledAdjustmentSlider
                    label="模糊"
                    value={sticker.shadowBlur}
                    min={0}
                    max={100}
                    suffix="px"
                    leftHint="清晰"
                    rightHint="柔和"
                    onChange={(shadowBlur) => onUpdate({ shadowBlur })}
                  />
                  <ThrottledAdjustmentSlider
                    label="透明度"
                    value={sticker.shadowOpacity}
                    min={0}
                    max={100}
                    suffix="%"
                    leftHint="透明"
                    rightHint="实"
                    onChange={(shadowOpacity) => onUpdate({ shadowOpacity })}
                  />
                  <ThrottledAdjustmentSlider
                    label="水平偏移"
                    value={sticker.shadowOffsetX}
                    min={-40}
                    max={40}
                    suffix="px"
                    leftHint="左"
                    rightHint="右"
                    onChange={(shadowOffsetX) => onUpdate({ shadowOffsetX })}
                  />
                  <ThrottledAdjustmentSlider
                    label="垂直偏移"
                    value={sticker.shadowOffsetY}
                    min={-40}
                    max={40}
                    suffix="px"
                    leftHint="上"
                    rightHint="下"
                    onChange={(shadowOffsetY) => onUpdate({ shadowOffsetY })}
                  />
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="gif-effects-disabled-note">
            GIF 贴纸不支持颜色、白边和阴影调整。
          </p>
        )}
      </div>

      <div className="inspector-actions">
        {supportsVisualEffects && (
          <Button
            size="small"
            icon={<ArrowCounterClockwise size="1em" weight="bold" />}
            onClick={() =>
              onUpdate({
                hue: 0,
                saturation: 0,
                brightness: 0,
                contrast: 0,
                warmth: 0,
                fillColor: sticker.defaultFillColor,
                variantSrc: undefined,
              })
            }
          >
            重置调色
          </Button>
        )}
        <Button
          size="small"
          icon={<Copy size="1em" weight="bold" />}
          onClick={onDuplicate}
        >
          复制
        </Button>
        <Button
          className="delete-sticker-button"
          size="small"
          icon={<Trash size="1em" weight="bold" />}
          aria-label={`删除${sticker.name}`}
          onClick={onDelete}
        />
      </div>
    </Card>
  );
}

interface MobileStickerControlsProps {
  sticker: PlacedSticker;
  onUpdate: (patch: Partial<PlacedSticker>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const MOBILE_ADJUSTMENT_LABELS: Record<MobileAdjustmentSection, string> = {
  color: "颜色",
  transform: "变换",
  outline: "白边",
  shadow: "阴影",
};

function MobileStickerControls({
  sticker,
  onUpdate,
  onDuplicate,
  onDelete,
  onClose,
}: MobileStickerControlsProps) {
  const [activeSection, setActiveSection] =
    useState<MobileAdjustmentSection | null>(null);
  const closeSheetButtonRef = useRef<HTMLButtonElement>(null);
  const supportsVisualEffects = sticker.format !== "GIF";

  useEffect(() => {
    if (
      !supportsVisualEffects &&
      activeSection &&
      activeSection !== "transform"
    ) {
      setActiveSection(null);
    }
  }, [activeSection, supportsVisualEffects]);

  useEffect(() => {
    if (!activeSection) return;

    const handleSheetKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setActiveSection(null);
      }
    };

    document.addEventListener("keydown", handleSheetKeyDown, true);
    const focusFrame = window.requestAnimationFrame(() =>
      closeSheetButtonRef.current?.focus()
    );

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleSheetKeyDown, true);
    };
  }, [activeSection]);

  const resetColor = () =>
    onUpdate({
      hue: 0,
      saturation: 0,
      brightness: 0,
      contrast: 0,
      warmth: 0,
      fillColor: sticker.defaultFillColor,
      variantSrc: undefined,
    });

  const renderSheetControls = () => {
    if (!supportsVisualEffects && activeSection !== "transform") return null;

    switch (activeSection) {
      case "color":
        return (
          <div className="mobile-sheet-control-stack">
            {sticker.defaultFillColor && (
              <FillColorControl sticker={sticker} onChange={onUpdate} />
            )}
            <div className="mobile-color-sliders">
              <AdjustmentSlider
                label="色相"
                value={sticker.hue}
                min={-180}
                max={180}
                suffix="°"
                onChange={(hue) => onUpdate({ hue })}
              />
              <AdjustmentSlider
                label="饱和度"
                value={sticker.saturation}
                onChange={(saturation) => onUpdate({ saturation })}
              />
              <AdjustmentSlider
                label="明度"
                value={sticker.brightness}
                onChange={(brightness) => onUpdate({ brightness })}
              />
              <AdjustmentSlider
                label="对比度"
                value={sticker.contrast}
                onChange={(contrast) => onUpdate({ contrast })}
              />
              <AdjustmentSlider
                label="白平衡"
                value={sticker.warmth}
                onChange={(warmth) => onUpdate({ warmth })}
              />
              <Button
                className="mobile-sheet-reset"
                size="small"
                icon={<ArrowCounterClockwise size="1em" weight="bold" />}
                onClick={resetColor}
              >
                重置颜色
              </Button>
            </div>
          </div>
        );
      case "transform":
        return (
          <div className="mobile-sheet-control-stack">
            <div className="transform-control">
              <span className="adjustment-label">翻转方向</span>
              <div className="transform-actions" aria-label="贴纸翻转">
                <Button
                  className={sticker.flipX ? "is-active" : undefined}
                  size="small"
                  icon={<FlipHorizontal size="1em" weight="bold" />}
                  aria-pressed={sticker.flipX}
                  onClick={() => onUpdate({ flipX: !sticker.flipX })}
                >
                  水平翻转
                </Button>
                <Button
                  className={sticker.flipY ? "is-active" : undefined}
                  size="small"
                  icon={<FlipVertical size="1em" weight="bold" />}
                  aria-pressed={sticker.flipY}
                  onClick={() => onUpdate({ flipY: !sticker.flipY })}
                >
                  垂直翻转
                </Button>
              </div>
            </div>
            <p className="mobile-transform-tip">
              在画布中拖动可移动贴纸。使用右下角缩放，顶部控制点旋转。
            </p>
          </div>
        );
      case "outline":
        return (
          <div className="mobile-sheet-control-stack">
            <EffectToggle
              label="开启白边"
              checked={sticker.outlineEnabled}
              onChange={(outlineEnabled) => onUpdate({ outlineEnabled })}
            />
            {sticker.outlineEnabled ? (
              <div className="effect-controls">
                <label className="effect-color-control">
                  <span>边缘颜色</span>
                  <input
                    type="color"
                    value={sticker.outlineColor}
                    onChange={(event) =>
                      onUpdate({ outlineColor: event.target.value })
                    }
                    aria-label="白边颜色"
                  />
                </label>
                <ThrottledAdjustmentSlider
                  label="白边宽度"
                  value={sticker.outlineWidth}
                  min={1}
                  max={40}
                  suffix="px"
                  leftHint="细"
                  rightHint="粗"
                  onChange={(outlineWidth) => onUpdate({ outlineWidth })}
                />
              </div>
            ) : (
              <p className="mobile-effect-empty">
                开启后可以调整白边颜色和宽度。
              </p>
            )}
          </div>
        );
      case "shadow":
        return (
          <div className="mobile-sheet-control-stack">
            <EffectToggle
              label="开启阴影"
              checked={sticker.shadowEnabled}
              onChange={(shadowEnabled) => onUpdate({ shadowEnabled })}
            />
            {sticker.shadowEnabled ? (
              <div className="effect-controls mobile-shadow-controls">
                <label className="effect-color-control">
                  <span>阴影颜色</span>
                  <input
                    type="color"
                    value={sticker.shadowColor}
                    onChange={(event) =>
                      onUpdate({ shadowColor: event.target.value })
                    }
                    aria-label="阴影颜色"
                  />
                </label>
                <ThrottledAdjustmentSlider
                  label="阴影大小"
                  value={sticker.shadowSize}
                  min={50}
                  max={150}
                  suffix="%"
                  leftHint="小"
                  rightHint="大"
                  onChange={(shadowSize) => onUpdate({ shadowSize })}
                />
                <ThrottledAdjustmentSlider
                  label="模糊"
                  value={sticker.shadowBlur}
                  min={0}
                  max={100}
                  suffix="px"
                  leftHint="清晰"
                  rightHint="柔和"
                  onChange={(shadowBlur) => onUpdate({ shadowBlur })}
                />
                <ThrottledAdjustmentSlider
                  label="透明度"
                  value={sticker.shadowOpacity}
                  min={0}
                  max={100}
                  suffix="%"
                  leftHint="透明"
                  rightHint="实"
                  onChange={(shadowOpacity) => onUpdate({ shadowOpacity })}
                />
                <ThrottledAdjustmentSlider
                  label="水平偏移"
                  value={sticker.shadowOffsetX}
                  min={-40}
                  max={40}
                  suffix="px"
                  leftHint="左"
                  rightHint="右"
                  onChange={(shadowOffsetX) => onUpdate({ shadowOffsetX })}
                />
                <ThrottledAdjustmentSlider
                  label="垂直偏移"
                  value={sticker.shadowOffsetY}
                  min={-40}
                  max={40}
                  suffix="px"
                  leftHint="上"
                  rightHint="下"
                  onChange={(shadowOffsetY) => onUpdate({ shadowOffsetY })}
                />
              </div>
            ) : (
              <p className="mobile-effect-empty">
                开启后可以调整阴影颜色、大小和位置。
              </p>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return createPortal(
    <>
      <aside className="mobile-sticker-dock" aria-label={`调整${sticker.name}`}>
        <div className="mobile-sticker-dock-heading">
          <span>
            <strong>贴纸调整</strong>
          </span>
          <button type="button" onClick={onClose} aria-label="关闭贴纸调整">
            <X size="1em" weight="bold" />
          </button>
        </div>
        <div className="mobile-sticker-dock-actions">
          {supportsVisualEffects && (
            <button type="button" onClick={() => setActiveSection("color")}>
              <Palette size="1.35em" weight="duotone" aria-hidden="true" />
              <span>颜色</span>
            </button>
          )}
          <button type="button" onClick={() => setActiveSection("transform")}>
            <BoundingBox size="1.35em" weight="duotone" aria-hidden="true" />
            <span>变换</span>
          </button>
          {supportsVisualEffects && (
            <>
              <button
                type="button"
                className={sticker.outlineEnabled ? "is-enabled" : undefined}
                onClick={() => setActiveSection("outline")}
              >
                <Circle size="1.35em" weight="duotone" aria-hidden="true" />
                <span>白边</span>
              </button>
              <button
                type="button"
                className={sticker.shadowEnabled ? "is-enabled" : undefined}
                onClick={() => setActiveSection("shadow")}
              >
                <StackSimple size="1.35em" weight="duotone" aria-hidden="true" />
                <span>阴影</span>
              </button>
            </>
          )}
          <span className="mobile-dock-divider" aria-hidden="true" />
          <button type="button" onClick={onDuplicate}>
            <Copy size="1.35em" weight="duotone" aria-hidden="true" />
            <span>复制</span>
          </button>
          <button className="is-danger" type="button" onClick={onDelete}>
            <Trash size="1.35em" weight="duotone" aria-hidden="true" />
            <span>删除</span>
          </button>
        </div>
      </aside>

      {activeSection && (
        <div className="mobile-adjustment-mask">
          <section
            className="mobile-adjustment-sheet"
            role="dialog"
            aria-modal="false"
            aria-labelledby="mobile-adjustment-title"
          >
            <header className="mobile-adjustment-sheet-heading">
              <div>
                <span>贴纸调整</span>
                <strong id="mobile-adjustment-title">
                  {MOBILE_ADJUSTMENT_LABELS[activeSection]}
                </strong>
              </div>
              <button
                ref={closeSheetButtonRef}
                type="button"
                onClick={() => setActiveSection(null)}
                aria-label={`关闭${MOBILE_ADJUSTMENT_LABELS[activeSection]}调整`}
              >
                <X size="1em" weight="bold" />
              </button>
            </header>
            <div className="mobile-adjustment-sheet-body">
              {renderSheetControls()}
            </div>
          </section>
        </div>
      )}
    </>,
    document.body
  );
}

interface StickerLibraryProps {
  disabled: boolean;
  customStickers: StickerAsset[];
  onAddSticker: (asset: StickerAsset) => void;
  onUploadCustomSticker: (file: File) => void;
}

function StickerLibrary({
  disabled,
  customStickers,
  onAddSticker,
  onUploadCustomSticker,
}: StickerLibraryProps) {
  const customStickerInputRef = useRef<HTMLInputElement>(null);
  const [activeSource, setActiveSource] = useState<
    "official" | "fan" | "gif"
  >("official");
  const stickerAssets = STICKER_ASSETS.filter((asset) => {
    if (activeSource === "gif") return asset.format === "GIF";
    if (asset.format === "GIF") return false;
    return (
      asset.source === "both" || (asset.source ?? "fan") === activeSource
    );
  });
  const renderStickerOption = (asset: StickerAsset) => (
    <button
      className={`sticker-option${
        asset.id.startsWith("custom-") ? " custom-sticker-option" : ""
      }`}
      type="button"
      key={asset.id}
      disabled={disabled}
      onClick={() => onAddSticker(asset)}
      aria-label={`添加${asset.name}，${asset.format} 格式${
        asset.id === FIRST_RECOLORABLE_STICKER_ID ? "，支持换色" : ""
      }`}
    >
      {asset.id === FIRST_RECOLORABLE_STICKER_ID && (
        <span className="sticker-color-badge" aria-hidden="true">
          可换色
        </span>
      )}
      {asset.format === "GIF" && (
        <span className="sticker-gif-badge" aria-hidden="true">
          GIF
        </span>
      )}
      <span className="sticker-thumbnail">
        <img src={asset.src} alt="" draggable="false" />
      </span>
    </button>
  );

  return (
    <Card className="sticker-library" color="app-blue">
      <div className="library-heading">
        <strong className="library-title">贴纸</strong>
        <div
          className="sticker-source-tabs"
          role="tablist"
          aria-label="贴纸来源"
        >
          <button
            className={activeSource === "official" ? "is-active" : undefined}
            type="button"
            role="tab"
            aria-selected={activeSource === "official"}
            aria-controls="sticker-list"
            onClick={() => setActiveSource("official")}
          >
            官方
          </button>
          <button
            className={activeSource === "fan" ? "is-active" : undefined}
            type="button"
            role="tab"
            aria-selected={activeSource === "fan"}
            aria-controls="sticker-list"
            onClick={() => setActiveSource("fan")}
          >
            饭制
          </button>
          <button
            className={activeSource === "gif" ? "is-active" : undefined}
            type="button"
            role="tab"
            aria-selected={activeSource === "gif"}
            aria-controls="sticker-list"
            onClick={() => setActiveSource("gif")}
          >
            GIF
          </button>
        </div>
      </div>
      <input
        ref={customStickerInputRef}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onUploadCustomSticker(file);
        }}
        aria-label="选择自定义贴纸"
      />
      <div id="sticker-list" className="sticker-list" aria-label="贴纸列表">
        <button
          className="sticker-option custom-sticker-upload"
          type="button"
          onClick={() => customStickerInputRef.current?.click()}
          aria-label="上传自定义贴纸"
        >
          <UploadSimple size="1.65em" weight="duotone" aria-hidden="true" />
          <span>上传贴纸</span>
        </button>
        {customStickers
          .filter((asset) =>
            activeSource === "gif"
              ? asset.format === "GIF"
              : asset.format !== "GIF"
          )
          .map(renderStickerOption)}
        {stickerAssets.map(renderStickerOption)}
      </div>
      {disabled && <p className="library-hint">请先上传图片哦！</p>}
    </Card>
  );
}

function ToastNotice({
  toast,
  onClose,
}: {
  toast: ToastState;
  onClose: () => void;
}) {
  const icon = {
    success: <CheckCircle size="1em" weight="fill" />,
    info: <Info size="1em" weight="fill" />,
    warning: <WarningCircle size="1em" weight="fill" />,
    error: <XCircle size="1em" weight="fill" />,
  }[toast.kind];

  return (
    <div
      className={`toast-notice toast-${toast.kind}`}
      role={toast.kind === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <span className="toast-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="toast-copy">
        <strong>{toast.message}</strong>
        {toast.description && <small>{toast.description}</small>}
      </span>
      <button type="button" onClick={onClose} aria-label="关闭提示">
        <X size="1em" weight="bold" />
      </button>
    </div>
  );
}

export function StickerEditor() {
  const [background, setBackground] = useState<BackgroundImage | null>(null);
  const [customStickers, setCustomStickers] = useState<StickerAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [exportState, setExportState] = useState<ExportState>({
    status: "idle",
  });
  const [toast, setToast] = useState<ToastState | null>(null);
  const isMobileLayout = useMobileLayout();
  const history = useStickerHistory();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const stageContainerRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const customStickerUrlsRef = useRef(new Set<string>());
  const canvasWidth = background?.width ?? DEFAULT_CANVAS_WIDTH;
  const canvasHeight = background?.height ?? DEFAULT_CANVAS_HEIGHT;
  const displayScale = useCanvasScale(
    stageContainerRef,
    canvasWidth,
    canvasHeight
  );
  const backgroundImage = useHtmlImage(background?.src);

  const showToast = useCallback(
    (
      kind: ToastKind,
      message: string,
      description?: string,
      duration = 2600
    ) => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      setToast({ kind, message, description });
      toastTimerRef.current = window.setTimeout(() => setToast(null), duration);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      customStickerUrlsRef.current.forEach((src) => URL.revokeObjectURL(src));
      customStickerUrlsRef.current.clear();
    };
  }, []);

  const uploadCustomSticker = useCallback(
    async (file: File) => {
      try {
        const sticker = await loadCustomStickerFile(file);
        customStickerUrlsRef.current.add(sticker.src);
        setCustomStickers((current) => [sticker, ...current]);
        showToast(
          "success",
          "自定义贴纸已加入",
          `${sticker.name} 已放在贴纸栏最前面`,
          2800
        );
      } catch (error) {
        showToast(
          "error",
          "无法添加这张贴纸",
          error instanceof Error ? error.message : "请检查图片后重试",
          3800
        );
      }
    },
    [showToast]
  );

  const selectedSticker = useMemo(
    () =>
      history.stickers.find((sticker) => sticker.instanceId === selectedId) ??
      null,
    [history.stickers, selectedId]
  );

  useEffect(() => {
    return () => {
      if (background?.src.startsWith("blob:"))
        URL.revokeObjectURL(background.src);
    };
  }, [background]);

  useEffect(() => {
    if (exportState.status === "idle") return;
    const previousOverflow = document.body.style.overflow;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && exportState.status !== "generating") {
        setExportState({ status: "idle" });
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [exportState.status]);

  const handleFile = useCallback(
    async (file?: File) => {
      if (!file) return;
      try {
        const nextBackground = await loadBackgroundFile(file);
        history.reset();
        setBackground(nextBackground);
        setSelectedId(null);
        showToast(
          "success",
          "图片已放进画布",
          `${nextBackground.width} × ${nextBackground.height}px`,
          2400
        );
      } catch (error) {
        showToast(
          "error",
          "无法上传这张图片",
          error instanceof Error ? error.message : "请检查图片后重试",
          3800
        );
      }
    },
    [history, showToast]
  );

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    void handleFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingFile(false);
    void handleFile(event.dataTransfer.files?.[0]);
  };

  const addSticker = useCallback(
    (asset: StickerAsset) => {
      if (!background) {
        showToast("info", "先上传一张图片", "贴纸会添加到图片画布中央", 2400);
        return;
      }

      const offsetIndex = history.stickers.length % 5;
      const shortSide = Math.min(canvasWidth, canvasHeight);
      const baseSize = Math.max(8, shortSide * 0.26);
      const size = asset.id === "rocket" ? baseSize * 1.1 : baseSize;
      const width = asset.id.endsWith("lettering")
        ? Math.min(canvasWidth * 0.72, baseSize * 2)
        : size;
      const height = width / (asset.aspectRatio ?? 1);
      const offsetX = shortSide * 0.028;
      const offsetY = shortSide * 0.021;
      const nextSticker: PlacedSticker = {
        ...asset,
        instanceId: makeInstanceId(),
        x: canvasWidth / 2 + offsetIndex * offsetX,
        y: canvasHeight / 2 + offsetIndex * offsetY,
        width,
        height,
        rotation: (offsetIndex - 2) * 3,
        flipX: false,
        flipY: false,
        hue: 0,
        saturation: 0,
        brightness: 0,
        contrast: 0,
        warmth: 0,
        fillColor: asset.defaultFillColor,
        outlineEnabled: false,
        outlineColor: "#FFFFFF",
        outlineWidth: 10,
        shadowEnabled: false,
        shadowColor: "#17365D",
        shadowSize: 100,
        shadowBlur: 12,
        shadowOpacity: 32,
        shadowOffsetX: 8,
        shadowOffsetY: 10,
      };
      history.commit((current) => [...current, nextSticker]);
      setSelectedId(nextSticker.instanceId);

      if (
        asset.id === FIRST_RECOLORABLE_STICKER_ID &&
        !window.sessionStorage.getItem(RECOLOR_HINT_SESSION_KEY)
      ) {
        window.sessionStorage.setItem(RECOLOR_HINT_SESSION_KEY, "1");
        showToast(
          "info",
          window.matchMedia("(max-width: 767px)").matches
            ? "点一下底部的「颜色」就能修改配色哦！"
            : "可以在调整面板中修改配色哦！",
          undefined,
          3200
        );
      }
    },
    [background, canvasHeight, canvasWidth, history, showToast]
  );

  const updateSticker = useCallback(
    (instanceId: string, patch: Partial<PlacedSticker>) => {
      history.commit((current) =>
        current.map((sticker) =>
          sticker.instanceId === instanceId ? { ...sticker, ...patch } : sticker
        )
      );
    },
    [history]
  );

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    history.commit((current) =>
      current.filter((sticker) => sticker.instanceId !== selectedId)
    );
    setSelectedId(null);
  }, [history, selectedId]);

  const duplicateSelected = useCallback(() => {
    if (!selectedSticker) return;
    const offset = Math.max(4, Math.min(canvasWidth, canvasHeight) * 0.035);
    const duplicate: PlacedSticker = {
      ...selectedSticker,
      instanceId: makeInstanceId(),
      x: selectedSticker.x + offset,
      y: selectedSticker.y + offset,
      rotation: selectedSticker.rotation + 4,
    };
    history.commit((current) => [...current, duplicate]);
    setSelectedId(duplicate.instanceId);
  }, [canvasHeight, canvasWidth, history, selectedSticker]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (exportState.status !== "idle") return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]'))
        return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        deleteSelected();
      }
      if (event.key === "Escape") setSelectedId(null);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [deleteSelected, exportState.status, history, selectedId]);

  const clearEverything = () => {
    history.reset();
    setBackground(null);
    setSelectedId(null);
    setIsClearModalOpen(false);
    showToast("success", "画布已清空", undefined, 2000);
  };

  const saveImage = async () => {
    if (exportState.status === "generating") return;
    if (!background || !stageRef.current) {
      showToast("warning", "请先上传图片再保存", undefined, 2400);
      return;
    }

    const generationStartedAt = performance.now();
    const animatedStickerIds = history.stickers
      .filter((sticker) => sticker.format === "GIF")
      .map((sticker) => sticker.instanceId);
    const isGifExport = animatedStickerIds.length > 0;
    setExportState({ status: "generating" });
    const previousSelection = selectedId;
    setSelectedId(null);

    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      const stage = stageRef.current;
      const previousStage = {
        width: stage.width(),
        height: stage.height(),
        scaleX: stage.scaleX(),
        scaleY: stage.scaleY(),
      };
      const gifControllers = isGifExport
        ? await waitForGifControllers(animatedStickerIds)
        : [];
      let encodingSession: GifEncodingSession | null = null;
      let blob: Blob;
      try {
        gifControllers.forEach((controller) => controller.pause());
        stage.size({ width: background.width, height: background.height });
        stage.scale({ x: 1, y: 1 });

        if (isGifExport) {
          const pixelRatio = Math.min(
            1,
            Math.sqrt(
              GIF_EXPORT_MAX_PIXELS / Math.max(1, background.width * background.height)
            )
          );
          const exportWidth = Math.max(1, Math.round(background.width * pixelRatio));
          const exportHeight = Math.max(1, Math.round(background.height * pixelRatio));
          const frameDelay = Math.round(1000 / GIF_EXPORT_FPS);
          const duration = Math.min(
            GIF_EXPORT_MAX_DURATION_MS,
            Math.max(...gifControllers.map((controller) => controller.duration))
          );
          const frameCount = Math.max(1, Math.ceil(duration / frameDelay));
          encodingSession = await GifEncodingSession.create(exportWidth, exportHeight);

          for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
            const timeMs = frameIndex * frameDelay;
            gifControllers.forEach((controller) => controller.renderAt(timeMs));
            stage.batchDraw();
            const frameCanvas = stage.toCanvas({ pixelRatio });
            const context = frameCanvas.getContext("2d", { willReadFrequently: true });
            if (!context) throw new Error("浏览器无法读取 GIF 合成画布");
            await encodingSession.addFrame(
              context.getImageData(0, 0, exportWidth, exportHeight),
              frameDelay
            );
          }

          blob = await encodingSession.finish();
        } else {
          stage.batchDraw();
          const exportCanvas = stage.toCanvas({ pixelRatio: 1 });
          blob = await canvasToPngBlob(exportCanvas);
        }
      } finally {
        encodingSession?.terminate();
        stage.size({
          width: previousStage.width,
          height: previousStage.height,
        });
        stage.scale({ x: previousStage.scaleX, y: previousStage.scaleY });
        stage.batchDraw();
        gifControllers.forEach((controller) => controller.play());
      }
      const fileBase = background.name
        .replace(/\.[^.]+$/, "")
        .replace(/[^\w\u4e00-\u9fa5-]+/g, "-");
      const fileExtension = isGifExport ? "gif" : "png";
      const mimeType = isGifExport ? "image/gif" : "image/png";
      const fileName = `${
        fileBase || "安心院小姐的酸橙味照片"
      }-贴纸版.${fileExtension}`;
      const file = new File([blob], fileName, { type: mimeType });
      const previewUrl = await blobToDataUrl(blob);
      const remainingDisplayTime =
        MIN_GENERATING_DISPLAY_MS - (performance.now() - generationStartedAt);
      if (remainingDisplayTime > 0) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, remainingDisplayTime);
        });
      }

      if (shouldUseMobileSaveFlow()) {
        // Mobile Safari and some in-app browsers can display a blob URL but
        // save an empty/gray image from the long-press menu. A self-contained
        // A data URL keeps the actual bytes available to that save flow.
        setExportState({ status: "ready", image: { file, url: previewUrl } });
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = fileName;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportState({ status: "ready", image: { file, url: previewUrl } });
      showToast(
        "success",
        "已开始下载",
        isGifExport ? "动态贴纸已合成为循环 GIF" : "正在导出原图尺寸的 PNG",
        2500
      );
    } catch (error) {
      setExportState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "请稍后重试，或换一张尺寸更小的图片",
      });
    } finally {
      setSelectedId(previousSelection);
    }
  };

  const exportFormatLabel = history.stickers.some(
    (sticker) => sticker.format === "GIF"
  )
    ? "GIF"
    : "PNG";

  const exportedImage =
    exportState.status === "ready" ? exportState.image : null;
  const isSaving = exportState.status === "generating";
  const canShareExportedImage = Boolean(
    exportedImage && canShareFile(exportedImage.file)
  );

  const shareExportedImage = async () => {
    if (!exportedImage || !canShareExportedImage) return;
    setIsSharing(true);
    try {
      await navigator.share({
        files: [exportedImage.file],
        title: "保存图片",
      });
      setExportState({ status: "idle" });
      showToast(
        "success",
        "图片已交给系统处理",
        "可在分享面板中保存到相册或文件",
        2800
      );
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        showToast("warning", "系统分享没有打开", "请长按图片保存", 3800);
      }
    } finally {
      setIsSharing(false);
    }
  };

  const downloadExportedImage = () => {
    if (!exportedImage) return;
    const url = URL.createObjectURL(exportedImage.file);
    const link = document.createElement("a");
    link.download = exportedImage.file.name;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const hasContent = Boolean(background || history.stickers.length);

  return (
    <section className="studio-shell" aria-label="图片贴纸编辑器">
      {toast && <ToastNotice toast={toast} onClose={() => setToast(null)} />}
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        onChange={handleFileInput}
        aria-label="选择要编辑的图片"
      />

      <div className="top-toolbar">
        <div className="upload-group">
          <Button
            className="upload-button"
            type="primary"
            size="large"
            icon={<UploadSimple size="1em" weight="bold" />}
            onClick={() => fileInputRef.current?.click()}
            aria-label={background ? "换张图片" : "上传图片"}
          >
            <CanvasButtonLabel text={background ? "换张图片" : "上传图片"} />
          </Button>
          {background && (
            <span className="editing-hint">
              <SlidersHorizontal
                size="1em"
                weight="duotone"
                aria-hidden="true"
              />
              <span>选中贴纸后就可以拖动、旋转甚至调色啦！</span>
            </span>
          )}
        </div>

        <div className="history-actions" aria-label="历史操作">
          <IconAction
            label="撤销 Ctrl+Z"
            disabled={!history.canUndo}
            onClick={history.undo}
          >
            <ArrowCounterClockwise size="1em" weight="bold" />
          </IconAction>
          <IconAction
            label="重做 Ctrl+Shift+Z"
            disabled={!history.canRedo}
            onClick={history.redo}
          >
            <ArrowClockwise size="1em" weight="bold" />
          </IconAction>
        </div>
      </div>

      <div className="workspace-body">
        <StickerLibrary
          disabled={!background}
          customStickers={customStickers}
          onAddSticker={addSticker}
          onUploadCustomSticker={(file) => void uploadCustomSticker(file)}
        />

        <div className="canvas-column">
          <div
            className={`canvas-frame${
              isDraggingFile ? " is-dragging-file" : ""
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDraggingFile(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null
                )
              ) {
                setIsDraggingFile(false);
              }
            }}
            onDrop={handleDrop}
          >
            <div className="stage-container" ref={stageContainerRef}>
              <div
                className="stage-size"
                style={{
                  width: canvasWidth * displayScale,
                  height: canvasHeight * displayScale,
                }}
              >
                <Stage
                  ref={stageRef}
                  width={canvasWidth * displayScale}
                  height={canvasHeight * displayScale}
                  scaleX={displayScale}
                  scaleY={displayScale}
                  onMouseDown={(event) => {
                    if (event.target === event.target.getStage())
                      setSelectedId(null);
                  }}
                  onTouchStart={(event) => {
                    if (event.target === event.target.getStage())
                      setSelectedId(null);
                  }}
                >
                  <Layer>
                    <Rect
                      x={0}
                      y={0}
                      width={canvasWidth}
                      height={canvasHeight}
                      fill="#fffdf8"
                      listening={false}
                    />
                    {backgroundImage && background && (
                      <KonvaImage
                        image={backgroundImage}
                        x={0}
                        y={0}
                        width={background.width}
                        height={background.height}
                        listening={false}
                      />
                    )}
                  </Layer>
                  <Layer>
                    {history.stickers.map((sticker) => (
                      <StickerNode
                        key={sticker.instanceId}
                        sticker={sticker}
                        selected={sticker.instanceId === selectedId}
                        displayScale={displayScale}
                        canvasWidth={canvasWidth}
                        canvasHeight={canvasHeight}
                        onSelect={() => setSelectedId(sticker.instanceId)}
                        onChange={(nextSticker) =>
                          updateSticker(sticker.instanceId, nextSticker)
                        }
                      />
                    ))}
                  </Layer>
                </Stage>

                {!background && (
                  <div className="empty-canvas" aria-live="polite">
                    <span className="empty-canvas-icon" aria-hidden="true">
                      <ImageSquare size={50} weight="duotone" />
                    </span>
                    <p>首先把图片拖到这里，或者选择一张~</p>
                    <Button
                      className="upload-button"
                      type="primary"
                      icon={<UploadSimple size="1em" weight="bold" />}
                      aria-label="选择图片"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <CanvasButtonLabel text="选择图片" />
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {isDraggingFile && (
              <div className="drop-feedback" aria-hidden="true">
                <UploadSimple size={42} weight="bold" />
                <strong>松手就放进画布</strong>
              </div>
            )}
          </div>

          {selectedSticker && !isMobileLayout && (
            <StickerInspector
              sticker={selectedSticker}
              onUpdate={(patch) =>
                updateSticker(selectedSticker.instanceId, patch)
              }
              onDuplicate={duplicateSelected}
              onDelete={deleteSelected}
              onClose={() => setSelectedId(null)}
            />
          )}

          {selectedSticker &&
            isMobileLayout &&
            !isClearModalOpen &&
            exportState.status === "idle" && (
              <MobileStickerControls
                key={selectedSticker.instanceId}
                sticker={selectedSticker}
                onUpdate={(patch) =>
                  updateSticker(selectedSticker.instanceId, patch)
                }
                onDuplicate={duplicateSelected}
                onDelete={deleteSelected}
                onClose={() => setSelectedId(null)}
              />
            )}
        </div>
      </div>

      <div className="bottom-toolbar">
        <div className="bottom-copy"></div>
        <div className="bottom-actions">
          <Button
            className="clear-button"
            size="large"
            disabled={!hasContent}
            icon={<Trash size="1em" weight="bold" />}
            onClick={() => setIsClearModalOpen(true)}
          >
            清空
          </Button>
          <Button
            className="save-button"
            type="primary"
            size="large"
            disabled={!background || isSaving}
            aria-busy={isSaving}
            aria-label="保存图片"
            icon={<DownloadSimple size="1em" weight="bold" />}
            onClick={() => void saveImage()}
          >
            <CanvasButtonLabel text="保存图片" />
          </Button>
        </div>
      </div>

      <Modal
        open={isClearModalOpen}
        title="要清空整个画布吗？"
        typewriter={false}
        onClose={() => setIsClearModalOpen(false)}
        footer={
          <>
            <Button onClick={() => setIsClearModalOpen(false)}>继续编辑</Button>
            <Button
              className="confirm-clear-button"
              danger
              icon={<Trash size="1em" weight="bold" />}
              onClick={clearEverything}
            >
              确认清空
            </Button>
          </>
        }
      >
        上传的图片和所有贴纸都会从当前画布移除。已下载的图片不会受到影响。
      </Modal>

      {exportState.status !== "idle" &&
        createPortal(
          <div
            className="save-preview-mask"
            onClick={(event) => {
              if (
                exportState.status !== "generating" &&
                event.target === event.currentTarget
              ) {
                setExportState({ status: "idle" });
              }
            }}
          >
            <div
              className={`save-preview-dialog is-export-${exportState.status}`}
              role="dialog"
              aria-modal="true"
              aria-label={
                exportState.status === "generating"
                  ? `正在生成 ${exportFormatLabel} 图片`
                  : `保存 ${exportFormatLabel} 图片`
              }
              aria-busy={exportState.status === "generating"}
            >
              {exportState.status === "generating" && (
                <div
                  className="export-generating"
                  role="status"
                  aria-live="polite"
                >
                  <img
                    className="export-generating-mascot"
                    src="/orange-angelina.svg"
                    alt=""
                  />
                  <div className="export-generating-copy">
                    <strong>正在生成 {exportFormatLabel}…</strong>
                    <span>
                      {exportFormatLabel === "GIF"
                        ? "正在逐帧合成动态贴纸，可能需要几秒"
                        : "图片尺寸较大时可能需要几秒"}
                    </span>
                  </div>
                </div>
              )}

              {exportState.status === "ready" && (
                <>
                  <div className="save-preview-image-wrap">
                    <img
                      className="save-preview-image"
                      src={exportState.image.url}
                      alt="已生成的成品图片，可长按保存"
                    />
                  </div>
                  <p className="save-preview-instructions">
                    图片已经生成
                    <br />
                    可以长按图片保存，或使用下面的按钮
                  </p>
                  <div className="save-preview-actions">
                    {canShareExportedImage && (
                      <Button
                        className="share-save-button"
                        type="primary"
                        loading={isSharing}
                        icon={<ShareNetwork size="1em" weight="bold" />}
                        onClick={() => void shareExportedImage()}
                        aria-label="保存到手机或分享"
                      >
                        <CanvasButtonLabel text="保存到手机 / 分享" />
                      </Button>
                    )}
                    <Button
                      icon={<DownloadSimple size="1em" weight="bold" />}
                      onClick={downloadExportedImage}
                    >
                      下载图片
                    </Button>
                    <Button onClick={() => setExportState({ status: "idle" })}>
                      完成
                    </Button>
                  </div>
                </>
              )}

              {exportState.status === "error" && (
                <div className="export-error" role="alert">
                  <WarningCircle
                    size="2.6em"
                    weight="fill"
                    aria-hidden="true"
                  />
                  <strong>图片生成失败</strong>
                  <p>{exportState.message}</p>
                  <div className="save-preview-actions">
                    <Button
                      className="share-save-button"
                      type="primary"
                      icon={<ArrowClockwise size="1em" weight="bold" />}
                      onClick={() => void saveImage()}
                    >
                      重新生成
                    </Button>
                    <Button onClick={() => setExportState({ status: "idle" })}>
                      返回编辑
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </section>
  );
}
