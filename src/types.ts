export type StickerFormat = 'PNG' | 'SVG';

export interface StickerAsset {
  id: string;
  name: string;
  src: string;
  format: StickerFormat;
  aspectRatio?: number;
  defaultFillColor?: string;
}

export interface PlacedSticker extends StickerAsset {
  instanceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  saturation: number;
  brightness: number;
  contrast: number;
  warmth: number;
  fillColor?: string;
  variantSrc?: string;
  outlineEnabled: boolean;
  outlineColor: string;
  outlineWidth: number;
  shadowEnabled: boolean;
  shadowColor: string;
  shadowSize: number;
  shadowBlur: number;
  shadowOpacity: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

export interface BackgroundImage {
  src: string;
  name: string;
  width: number;
  height: number;
}

export const DEFAULT_CANVAS_WIDTH = 1200;
export const DEFAULT_CANVAS_HEIGHT = 840;

export const STICKER_ASSETS: StickerAsset[] = [
  {
    id: 'orange-lettering',
    name: '酸橙宣言',
    src: '/assets/stickers/orange-lettering.svg',
    format: 'SVG',
    aspectRatio: 1734 / 848,
    defaultFillColor: '#096BC1',
  },
  {
    id: 'orange-1',
    name: '元气橘子 1',
    src: '/assets/stickers/orange-1.png',
    format: 'PNG',
    aspectRatio: 461 / 318,
  },
  {
    id: 'orange-2',
    name: '元气橘子 2',
    src: '/assets/stickers/orange-2.png',
    format: 'PNG',
    aspectRatio: 1093 / 880,
  },
  {
    id: 'orange-3',
    name: '元气橘子 3',
    src: '/assets/stickers/orange-3.png',
    format: 'PNG',
    aspectRatio: 529 / 477,
  },
  {
    id: 'orange-4',
    name: '元气橘子 4',
    src: '/assets/stickers/orange-4.png',
    format: 'PNG',
    aspectRatio: 559 / 542,
  },
  {
    id: 'orange-5',
    name: '元气橘子 5',
    src: '/assets/stickers/orange-5.png',
    format: 'PNG',
    aspectRatio: 1169 / 686,
  },
  {
    id: 'orange-6',
    name: '元气橘子 6',
    src: '/assets/stickers/orange-6.png',
    format: 'PNG',
    aspectRatio: 1120 / 916,
  },
  {
    id: 'orange-7',
    name: '元气橘子 7',
    src: '/assets/stickers/orange-7.png',
    format: 'PNG',
    aspectRatio: 713 / 983,
  },
  {
    id: 'orange-8',
    name: '元气橘子 8',
    src: '/assets/stickers/orange-8.png',
    format: 'PNG',
    aspectRatio: 635 / 540,
  },
  {
    id: 'orange-9',
    name: '元气橘子 9',
    src: '/assets/stickers/orange-9.png',
    format: 'PNG',
    aspectRatio: 669 / 434,
  },
  {
    id: 'orange-10',
    name: '元气橘子 10',
    src: '/assets/stickers/orange-10.png',
    format: 'PNG',
    aspectRatio: 443 / 385,
  },
  {
    id: 'orange-11',
    name: '元气橘子 11',
    src: '/assets/stickers/orange-11.png',
    format: 'PNG',
    aspectRatio: 366 / 420,
  },
  {
    id: 'orange-12',
    name: '元气橘子 12',
    src: '/assets/stickers/orange-12.png',
    format: 'PNG',
    aspectRatio: 365 / 409,
  },
  {
    id: 'orange-13',
    name: '元气橘子 13',
    src: '/assets/stickers/orange-13.png',
    format: 'PNG',
    aspectRatio: 594 / 388,
  },
  {
    id: 'orange-14',
    name: '元气橘子 14',
    src: '/assets/stickers/orange-14.png',
    format: 'PNG',
    aspectRatio: 603 / 389,
  },
];
