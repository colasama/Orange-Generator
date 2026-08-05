import { useCallback, useEffect, useRef } from 'react';
import Konva from 'konva';
import { Circle, Group, Image as KonvaImage, Path, Transformer } from 'react-konva';
import type { PlacedSticker } from '../types';
import { useGifCanvas } from '../hooks/useGifCanvas';
import { useHtmlImage } from '../hooks/useHtmlImage';

interface StickerNodeProps {
  sticker: PlacedSticker;
  selected: boolean;
  displayScale: number;
  canvasWidth: number;
  canvasHeight: number;
  onSelect: () => void;
  onChange: (nextSticker: PlacedSticker) => void;
}

function whiteBalanceFilter(this: Konva.Node, imageData: ImageData): void {
  const warmth = Number(this.getAttr('warmth') ?? 0);
  if (Math.abs(warmth) < 0.001) return;

  const pixels = imageData.data;
  const shift = warmth * 38;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    pixels[index] = Math.max(0, Math.min(255, pixels[index] + shift));
    pixels[index + 1] = Math.max(0, Math.min(255, pixels[index + 1] + shift * 0.08));
    pixels[index + 2] = Math.max(0, Math.min(255, pixels[index + 2] - shift));
  }
}

const outlineDistanceBuffers = new WeakMap<Konva.Node, Float32Array>();

function outlineFilter(this: Konva.Node, imageData: ImageData): void {
  const radius = Math.max(1, Math.round(Number(this.getAttr('outlineRadius') ?? 1)));
  const red = Number(this.getAttr('outlineRed') ?? 255);
  const green = Number(this.getAttr('outlineGreen') ?? 255);
  const blue = Number(this.getAttr('outlineBlue') ?? 255);
  const { width, height, data } = imageData;
  const pixelCount = width * height;
  let distance = outlineDistanceBuffers.get(this);
  if (!distance || distance.length !== pixelCount) {
    distance = new Float32Array(pixelCount);
    outlineDistanceBuffers.set(this, distance);
  }

  const straightCost = 3;
  const diagonalCost = 4;
  const maximumDistance = radius * straightCost;
  const infinity = maximumDistance + diagonalCost + 1;

  for (let index = 0; index < pixelCount; index += 1) {
    const alpha = data[index * 4 + 3];
    distance[index] = alpha > 0
      ? ((255 - alpha) / 255) * straightCost
      : infinity;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      let value = distance[index];
      if (x > 0) value = Math.min(value, distance[index - 1] + straightCost);
      if (y > 0) {
        value = Math.min(value, distance[index - width] + straightCost);
        if (x > 0) value = Math.min(value, distance[index - width - 1] + diagonalCost);
        if (x + 1 < width) {
          value = Math.min(value, distance[index - width + 1] + diagonalCost);
        }
      }
      distance[index] = value;
    }
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      let value = distance[index];
      if (x + 1 < width) value = Math.min(value, distance[index + 1] + straightCost);
      if (y + 1 < height) {
        value = Math.min(value, distance[index + width] + straightCost);
        if (x + 1 < width) {
          value = Math.min(value, distance[index + width + 1] + diagonalCost);
        }
        if (x > 0) value = Math.min(value, distance[index + width - 1] + diagonalCost);
      }
      distance[index] = value;
    }
  }

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const coverage = Math.max(
      0,
      Math.min(1, (maximumDistance + straightCost - distance[index]) / straightCost),
    );
    data[offset] = red;
    data[offset + 1] = green;
    data[offset + 2] = blue;
    data[offset + 3] = Math.round(coverage * 255);
  }
}

const ADJUSTMENT_FILTERS = [
  Konva.Filters.HSL,
  Konva.Filters.Brighten,
  Konva.Filters.Contrast,
  whiteBalanceFilter,
];
const COLOR_FILTERS = [Konva.Filters.RGBA, ...ADJUSTMENT_FILTERS];
const OUTLINE_FILTERS = [outlineFilter];
const SHADOW_FILTERS = [Konva.Filters.RGBA, Konva.Filters.Blur];
const MAX_OUTLINE_CACHE_PIXELS = 1_500_000;
const ROTATE_ICON_PATH =
  'M244,56v48a12,12,0,0,1-12,12H184a12,12,0,1,1,0-24H201.1l-19-17.38c-.13-.12-.26-.24-.38-.37A76,76,0,1,0,127,204h1a75.53,75.53,0,0,0,52.15-20.72,12,12,0,0,1,16.49,17.45A99.45,99.45,0,0,1,128,228h-1.37A100,100,0,1,1,198.51,57.06L220,76.72V56a12,12,0,0,1,24,0Z';
const RESIZE_ICON_PATH = 'M64,64 192,192M64,112V64h48M144,192h48V144';
const ROTATE_ICON_BOUNDS = { centerX: 136.02, centerY: 128.01, size: 215.97 };
const RESIZE_ICON_BOUNDS = { centerX: 128, centerY: 128, size: 128 };

function hexToRgb(color?: string) {
  const match = color?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return null;
  return {
    red: Number.parseInt(match[1], 16),
    green: Number.parseInt(match[2], 16),
    blue: Number.parseInt(match[3], 16),
  };
}

export function StickerNode({
  sticker,
  selected,
  displayScale,
  canvasWidth,
  canvasHeight,
  onSelect,
  onChange,
}: StickerNodeProps) {
  const imageRef = useRef<Konva.Image>(null);
  const transformNodeRef = useRef<Konva.Group>(null);
  const shadowRef = useRef<Konva.Image>(null);
  const outlineRef = useRef<Konva.Image>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const rotateBadgeRef = useRef<Konva.Group>(null);
  const resizeBadgeRef = useRef<Konva.Group>(null);
  const redrawGifFrame = useCallback(() => {
    imageRef.current?.getLayer()?.batchDraw();
  }, []);
  const usesVectorFill = sticker.format === 'SVG' && !sticker.variantSrc;
  const htmlImage = useHtmlImage(
    sticker.format === 'GIF' ? undefined : (sticker.variantSrc ?? sticker.src),
    usesVectorFill ? sticker.fillColor : undefined,
  );
  const gifCanvas = useGifCanvas(
    sticker.format === 'GIF' ? sticker.src : undefined,
    sticker.instanceId,
    redrawGifFrame,
  );
  const image = gifCanvas ?? htmlImage;
  const fillRgb = usesVectorFill ? null : hexToRgb(sticker.fillColor);
  const outlineRgb = hexToRgb(sticker.outlineColor) ?? { red: 255, green: 255, blue: 255 };
  const shadowScale = Math.max(0.5, Math.min(1.5, (sticker.shadowSize ?? 100) / 100));
  const hasActiveFilters =
    Boolean(fillRgb) ||
    sticker.hue !== 0 ||
    sticker.saturation !== 0 ||
    sticker.brightness !== 0 ||
    sticker.contrast !== 0 ||
    sticker.warmth !== 0;
  const compactControls = displayScale * Math.min(canvasWidth, canvasHeight) < 420;
  // Konva.Transformer ignores its parent's scale, so its sizes are already in
  // screen pixels. The custom badges are regular canvas nodes and need the
  // inverse conversion to render at those same pixel sizes.
  const controlRadiusPx = compactControls ? 7 : 11;
  const controlStrokeWidthPx = compactControls ? 1.5 : 2;
  const rotateControlOffsetPx = compactControls ? 22 : 38;
  const controlRadius = controlRadiusPx / displayScale;
  const controlStrokeWidth = controlStrokeWidthPx / displayScale;
  const rotateControlOffset = rotateControlOffsetPx / displayScale;
  const rotateIconScale = (controlRadius * 1.3) / ROTATE_ICON_BOUNDS.size;
  const resizeIconScale = (controlRadius * 1.1) / RESIZE_ICON_BOUNDS.size;

  const syncControlBadges = () => {
    const node = transformNodeRef.current;
    if (!node) return;
    const visualScaleX = Math.abs(node.scaleX()) * (sticker.flipX ? -1 : 1);
    const visualScaleY = Math.abs(node.scaleY()) * (sticker.flipY ? -1 : 1);

    const outlineNode = outlineRef.current;
    if (outlineNode) {
      outlineNode.position(node.position());
      outlineNode.rotation(node.rotation());
      outlineNode.scale({ x: visualScaleX, y: visualScaleY });
    }

    const shadowNode = shadowRef.current;
    if (shadowNode) {
      shadowNode.position({
        x: node.x() + sticker.shadowOffsetX,
        y: node.y() + sticker.shadowOffsetY,
      });
      shadowNode.rotation(node.rotation());
      shadowNode.scale({ x: visualScaleX, y: visualScaleY });
    }

    const radians = (node.rotation() * Math.PI) / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const positionAt = (localX: number, localY: number) => {
      const scaledX = localX * node.scaleX();
      const scaledY = localY * node.scaleY();
      return {
        x: node.x() + scaledX * cosine - scaledY * sine,
        y: node.y() + scaledX * sine + scaledY * cosine,
      };
    };

    const scaleY = Math.max(0.0001, Math.abs(node.scaleY()));
    rotateBadgeRef.current?.position(
      positionAt(0, -node.height() / 2 - rotateControlOffset / scaleY),
    );
    resizeBadgeRef.current?.position(positionAt(node.width() / 2, node.height() / 2));
    node.getLayer()?.batchDraw();
  };

  useEffect(() => {
    if (!selected || !transformNodeRef.current || !transformerRef.current) return;
    transformerRef.current.nodes([transformNodeRef.current]);
    transformerRef.current.getLayer()?.batchDraw();
    syncControlBadges();
  }, [
    selected,
    image,
    sticker.x,
    sticker.y,
    sticker.width,
    sticker.height,
    sticker.rotation,
    sticker.flipX,
    sticker.flipY,
    displayScale,
  ]);

  useEffect(() => {
    const node = imageRef.current;
    if (!node || !image) return;
    node.setAttr('warmth', sticker.warmth / 100);
    node.clearCache();
    if (hasActiveFilters) {
      const devicePixelRatio = window.devicePixelRatio || 1;
      const cachePixelRatio = Math.min(4, Math.max(1, displayScale * devicePixelRatio));
      node.cache({ pixelRatio: cachePixelRatio });
    }
    node.getLayer()?.batchDraw();
  }, [
    displayScale,
    hasActiveFilters,
    image,
    sticker.brightness,
    sticker.contrast,
    sticker.fillColor,
    sticker.height,
    sticker.hue,
    sticker.saturation,
    sticker.warmth,
    sticker.width,
  ]);

  useEffect(() => {
    const node = shadowRef.current;
    if (!node || !image) return;
    node.clearCache();
    if (sticker.shadowEnabled) {
      const shadowWidth = sticker.width * shadowScale;
      const shadowHeight = sticker.height * shadowScale;
      const padding = Math.ceil(sticker.shadowBlur * 2) + 2;
      const cacheWidth = shadowWidth + padding * 2;
      const cacheHeight = shadowHeight + padding * 2;
      const cachePixelRatio = Math.min(
        1,
        Math.sqrt(MAX_OUTLINE_CACHE_PIXELS / Math.max(1, cacheWidth * cacheHeight)),
      );
      const shadowRgb = hexToRgb(sticker.shadowColor) ?? { red: 23, green: 54, blue: 93 };
      node.setAttr('red', shadowRgb.red);
      node.setAttr('green', shadowRgb.green);
      node.setAttr('blue', shadowRgb.blue);
      node.setAttr('alpha', 1);
      node.setAttr('blurRadius', sticker.shadowBlur * cachePixelRatio);
      node.cache({
        x: -padding,
        y: -padding,
        width: cacheWidth,
        height: cacheHeight,
        pixelRatio: cachePixelRatio,
      });
    }
    node.getLayer()?.batchDraw();
  }, [
    image,
    sticker.height,
    sticker.shadowBlur,
    sticker.shadowColor,
    sticker.shadowEnabled,
    sticker.shadowSize,
    sticker.width,
    shadowScale,
  ]);

  useEffect(() => {
    const node = outlineRef.current;
    if (!node || !image) return;
    node.clearCache();
    if (sticker.outlineEnabled) {
      const padding = Math.ceil(sticker.outlineWidth) + 2;
      const cacheWidth = sticker.width + padding * 2;
      const cacheHeight = sticker.height + padding * 2;
      const cachePixelRatio = Math.min(
        1,
        Math.sqrt(MAX_OUTLINE_CACHE_PIXELS / Math.max(1, cacheWidth * cacheHeight)),
      );
      node.setAttr(
        'outlineRadius',
        Math.max(1, Math.ceil(sticker.outlineWidth * cachePixelRatio)),
      );
      node.setAttr('outlineRed', outlineRgb.red);
      node.setAttr('outlineGreen', outlineRgb.green);
      node.setAttr('outlineBlue', outlineRgb.blue);
      node.cache({
        x: -padding,
        y: -padding,
        width: cacheWidth,
        height: cacheHeight,
        pixelRatio: cachePixelRatio,
      });
    }
    node.getLayer()?.batchDraw();
  }, [
    image,
    outlineRgb.blue,
    outlineRgb.green,
    outlineRgb.red,
    sticker.height,
    sticker.outlineColor,
    sticker.outlineEnabled,
    sticker.outlineWidth,
    sticker.width,
  ]);

  if (!image) return null;

  const minimumLogicalSize = Math.max(4, Math.min(canvasWidth, canvasHeight) * 0.025);
  // Transformer bound boxes use absolute, display-scaled coordinates.
  const minimumDisplaySize = minimumLogicalSize * displayScale;

  return (
    <>
      {sticker.shadowEnabled && (
        <KonvaImage
          ref={shadowRef}
          image={image}
          x={sticker.x + sticker.shadowOffsetX}
          y={sticker.y + sticker.shadowOffsetY}
          width={sticker.width * shadowScale}
          height={sticker.height * shadowScale}
          offsetX={(sticker.width * shadowScale) / 2}
          offsetY={(sticker.height * shadowScale) / 2}
          rotation={sticker.rotation}
          scaleX={sticker.flipX ? -1 : 1}
          scaleY={sticker.flipY ? -1 : 1}
          filters={SHADOW_FILTERS}
          opacity={sticker.shadowOpacity / 100}
          listening={false}
        />
      )}
      {sticker.outlineEnabled && (
        <KonvaImage
          ref={outlineRef}
          image={image}
          x={sticker.x}
          y={sticker.y}
          width={sticker.width}
          height={sticker.height}
          offsetX={sticker.width / 2}
          offsetY={sticker.height / 2}
          rotation={sticker.rotation}
          scaleX={sticker.flipX ? -1 : 1}
          scaleY={sticker.flipY ? -1 : 1}
          filters={OUTLINE_FILTERS}
          listening={false}
        />
      )}
      <Group
        ref={transformNodeRef}
        x={sticker.x}
        y={sticker.y}
        width={sticker.width}
        height={sticker.height}
        rotation={sticker.rotation}
        draggable
        dragDistance={compactControls ? 8 : undefined}
        preventDefault={false}
        dragBoundFunc={(position) => {
          // Konva provides and expects absolute (display-scaled) coordinates
          // here, while sticker dimensions and canvas bounds use the original
          // image coordinate system. Clamp in that logical coordinate system,
          // then convert the result back so the node's local x/y stay suitable
          // for full-resolution export.
          const logicalX = position.x / displayScale;
          const logicalY = position.y / displayScale;
          const boundedX = Math.max(
            -sticker.width * 0.2,
            Math.min(canvasWidth + sticker.width * 0.2, logicalX),
          );
          const boundedY = Math.max(
            -sticker.height * 0.2,
            Math.min(canvasHeight + sticker.height * 0.2, logicalY),
          );

          return {
            x: boundedX * displayScale,
            y: boundedY * displayScale,
          };
        }}
        onClick={onSelect}
        onTap={onSelect}
        onDragStart={onSelect}
        onDragMove={syncControlBadges}
        onDragEnd={() => {
          const node = transformNodeRef.current;
          if (!node) return;
          onChange({
            ...sticker,
            x: node.x(),
            y: node.y(),
          });
        }}
        onTransformEnd={() => {
          const node = transformNodeRef.current;
          if (!node) return;
          const scaleX = Math.abs(node.scaleX());
          const scaleY = Math.abs(node.scaleY());
          const uniformScale = (scaleX + scaleY) / 2;
          const minimumScale = minimumLogicalSize / Math.min(node.width(), node.height());
          const nextScale = Math.max(uniformScale, minimumScale);
          node.scale({ x: 1, y: 1 });

          onChange({
            ...sticker,
            x: node.x(),
            y: node.y(),
            width: node.width() * nextScale,
            height: node.height() * nextScale,
            rotation: node.rotation(),
          });
        }}
        onTransform={syncControlBadges}
      >
        <KonvaImage
          ref={imageRef}
          image={image}
          width={sticker.width}
          height={sticker.height}
          offsetX={sticker.width / 2}
          offsetY={sticker.height / 2}
          scaleX={sticker.flipX ? -1 : 1}
          scaleY={sticker.flipY ? -1 : 1}
          hue={(sticker.hue + 360) % 360}
          saturation={sticker.saturation / 100}
          brightness={sticker.brightness / 100}
          contrast={sticker.contrast}
          red={fillRgb?.red}
          green={fillRgb?.green}
          blue={fillRgb?.blue}
          alpha={fillRgb ? 1 : undefined}
          filters={hasActiveFilters ? (fillRgb ? COLOR_FILTERS : ADJUSTMENT_FILTERS) : undefined}
        />
      </Group>
      {selected && (
        <Transformer
          ref={transformerRef}
          flipEnabled={false}
          keepRatio
          shiftBehavior="none"
          centeredScaling
          enabledAnchors={
            compactControls
              ? ['bottom-right']
              : ['top-left', 'top-right', 'bottom-left', 'bottom-right']
          }
          rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
          rotationSnapTolerance={6}
          borderStroke="#2ebdf8"
          borderStrokeWidth={compactControls ? 2.5 : 2}
          borderDash={compactControls ? [7, 5] : [9, 6]}
          anchorFill="#fffdf8"
          anchorStroke="#178ec4"
          anchorStrokeWidth={controlStrokeWidthPx}
          anchorSize={controlRadiusPx * 2}
          anchorCornerRadius={99}
          rotateAnchorOffset={rotateControlOffsetPx}
          boundBoxFunc={(oldBox, nextBox) => {
            if (
              Math.abs(nextBox.width) < minimumDisplaySize ||
              Math.abs(nextBox.height) < minimumDisplaySize
            ) {
              return oldBox;
            }
            return nextBox;
          }}
        />
      )}
      {selected && (
        <>
          <Group ref={rotateBadgeRef} listening={false}>
            <Circle
              radius={controlRadius}
              fill="#fffdf8"
              stroke="#178ec4"
              strokeWidth={controlStrokeWidth}
            />
            <Path
              data={ROTATE_ICON_PATH}
              fill="#178ec4"
              stroke="#178ec4"
              strokeWidth={8}
              lineJoin="round"
              offsetX={ROTATE_ICON_BOUNDS.centerX}
              offsetY={ROTATE_ICON_BOUNDS.centerY}
              scaleX={rotateIconScale}
              scaleY={rotateIconScale}
              listening={false}
            />
          </Group>
          <Group ref={resizeBadgeRef} listening={false}>
            <Circle
              radius={controlRadius}
              fill="#fffdf8"
              stroke="#178ec4"
              strokeWidth={controlStrokeWidth}
            />
            <Path
              data={RESIZE_ICON_PATH}
              stroke="#178ec4"
              strokeWidth={22}
              lineCap="round"
              lineJoin="round"
              offsetX={RESIZE_ICON_BOUNDS.centerX}
              offsetY={RESIZE_ICON_BOUNDS.centerY}
              scaleX={resizeIconScale}
              scaleY={resizeIconScale}
              listening={false}
            />
          </Group>
        </>
      )}
    </>
  );
}
