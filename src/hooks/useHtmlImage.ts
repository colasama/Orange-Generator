import { useEffect, useState } from 'react';

const svgSourceCache = new Map<string, Promise<string>>();

function loadSvgSource(src: string) {
  const cached = svgSourceCache.get(src);
  if (cached) return cached;
  const request = fetch(src).then((response) => {
    if (!response.ok) throw new Error(`SVG load failed: ${response.status}`);
    return response.text();
  });
  svgSourceCache.set(src, request);
  void request.catch(() => svgSourceCache.delete(src));
  return request;
}

function replaceSvgFill(svg: string, fillColor: string) {
  return svg
    .replace(/fill\s*:\s*(?!none\b)[^;"']+/gi, `fill:${fillColor}`)
    .replace(/\bfill\s*=\s*["'](?!none\b)[^"']+["']/gi, `fill="${fillColor}"`);
}

export function useHtmlImage(src?: string, svgFillColor?: string): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!src) {
      setImage(null);
      return;
    }

    let cancelled = false;
    setImage(null);
    let objectUrl: string | null = null;

    const loadImage = async () => {
      const nextImage = new window.Image();
      nextImage.decoding = 'async';
      nextImage.onload = () => {
        if (!cancelled) setImage(nextImage);
      };
      nextImage.onerror = () => {
        if (!cancelled) setImage(null);
      };

      if (svgFillColor) {
        try {
          const svg = replaceSvgFill(await loadSvgSource(src), svgFillColor);
          objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
          nextImage.src = objectUrl;
          return;
        } catch {
          // Fall back to the original asset if recoloring cannot be prepared.
        }
      }

      nextImage.src = src;
    };

    void loadImage();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, svgFillColor]);

  return image;
}
