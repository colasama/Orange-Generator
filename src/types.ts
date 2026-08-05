export type StickerFormat = 'PNG' | 'JPG' | 'WebP' | 'SVG' | 'GIF';

export interface StickerAsset {
  id: string;
  name: string;
  src: string;
  format: StickerFormat;
  source?: 'official' | 'fan' | 'both';
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
  flipX: boolean;
  flipY: boolean;
  hue: number;
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

type RasterStickerDefinition = readonly [
  id: string,
  name: string,
  src: string,
  aspectRatio: number,
];

const createRasterSticker = (
  format: Extract<StickerFormat, 'PNG' | 'GIF'>,
  [id, name, src, aspectRatio]: RasterStickerDefinition,
): StickerAsset => ({ id, name, src, format, source: 'official', aspectRatio });

const ANGELINA_PNG_STICKERS: RasterStickerDefinition[] = [
  ['angelina-sitting', '安心院·坐坐', '/assets/stickers/angelina-sitting.png', 1],
  ['angelina-photo', '安心院·拍照', '/assets/stickers/angelina-photo.png', 1],
  ['angelina-adventure', '安心院·探险', '/assets/stickers/angelina-adventure.png', 1],
  ['angelina-seaside', '安心院·海边', '/assets/stickers/angelina-seaside.png', 1],
  ['angelina-diving', '安心院·潜水', '/assets/stickers/angelina-diving.png', 1],
  ['angelina-reading', '安心院·看书', '/assets/stickers/angelina-reading.png', 1],
  ['angelina-paper-plane', '安心院·纸飞机', '/assets/stickers/angelina-paper-plane.png', 1],
  ['angelina-shopping', '安心院·购物', '/assets/stickers/angelina-shopping.png', 1],
  ['angelina-delivery', '安心院·送货', '/assets/stickers/angelina-delivery.png', 1],
  ['angelina-cycling', '安心院·骑行', '/assets/stickers/angelina-cycling.png', 1],
  ['angelina-ui-01', '安心院 UI 01', '/assets/stickers/angelina-ui-01.png', 521 / 416],
  ['angelina-ui-02', '安心院 UI 02', '/assets/stickers/angelina-ui-02.png', 135 / 411],
  ['angelina-ui-03', '安心院 UI 03', '/assets/stickers/angelina-ui-03.png', 71 / 70],
  ['angelina-ui-04', '安心院 UI 04', '/assets/stickers/angelina-ui-04.png', 77 / 61],
  ['angelina-ui-05', '安心院 UI 05', '/assets/stickers/angelina-ui-05.png', 67 / 70],
  ['angelina-ui-06', '安心院 UI 06', '/assets/stickers/angelina-ui-06.png', 84 / 64],
  ['angelina-ui-07', '安心院 UI 07', '/assets/stickers/angelina-ui-07.png', 78 / 76],
  ['angelina-ui-08', '安心院 UI 08', '/assets/stickers/angelina-ui-08.png', 139 / 126],
  ['angelina-ui-09', '安心院 UI 09', '/assets/stickers/angelina-ui-09.png', 804 / 421],
  ['angelina-ui-09-alt', '安心院 UI 09 备选', '/assets/stickers/angelina-ui-09-alt.png', 804 / 421],
  ['angelina-ui-10', '安心院 UI 10', '/assets/stickers/angelina-ui-10.png', 479 / 150],
  ['angelina-ui-11', '安心院 UI 11', '/assets/stickers/angelina-ui-11.png', 479 / 150],
  ['angelina-ui-12', '安心院 UI 12', '/assets/stickers/angelina-ui-12.png', 214 / 212],
  ['angelina-ui-13', '安心院 UI 13', '/assets/stickers/angelina-ui-13.png', 214 / 212],
  ['angelina-ui-14', '安心院 UI 14', '/assets/stickers/angelina-ui-14.png', 248 / 60],
  ['angelina-ui-15', '安心院 UI 15', '/assets/stickers/angelina-ui-15.png', 629 / 116],
  ['angelina-ui-16', '安心院 UI 16', '/assets/stickers/angelina-ui-16.png', 223 / 145],
  ['angelina-ui-17', '安心院 UI 17', '/assets/stickers/angelina-ui-17.png', 270 / 136],
  ['angelina-ui-18', '安心院 UI 18', '/assets/stickers/angelina-ui-18.png', 199 / 138],
  ['angelina-ui-19', '安心院 UI 19', '/assets/stickers/angelina-ui-19.png', 249 / 57],
  ['angelina-ui-20', '安心院 UI 20', '/assets/stickers/angelina-ui-20.png', 257 / 97],
  ['angelina-ui-21', '安心院 UI 21', '/assets/stickers/angelina-ui-21.png', 231 / 54],
  ['angelina-ui-22', '安心院 UI 22', '/assets/stickers/angelina-ui-22.png', 508 / 395],
  ['angelina-ui-23', '安心院 UI 23', '/assets/stickers/angelina-ui-23.png', 132 / 153],
  ['angelina-ui-24', '安心院 UI 24', '/assets/stickers/angelina-ui-24.png', 83 / 84],
  ['angelina-ui-25', '安心院 UI 25', '/assets/stickers/angelina-ui-25.png', 48 / 49],
  ['angelina-ui-26', '安心院 UI 26', '/assets/stickers/angelina-ui-26.png', 49 / 47],
  ['angelina-ui-27', '安心院 UI 27', '/assets/stickers/angelina-ui-27.png', 168 / 159],
];

const ANGELINA_GIF_STICKERS: RasterStickerDefinition[] = [
  ['angelina-sitting-gif', '安心院·坐坐（动态）', '/assets/stickers/angelina-sitting.gif', 1],
  ['angelina-photo-gif', '安心院·拍照（动态）', '/assets/stickers/angelina-photo.gif', 1],
  ['angelina-adventure-gif', '安心院·探险（动态）', '/assets/stickers/angelina-adventure.gif', 1],
  ['angelina-seaside-gif', '安心院·海边（动态）', '/assets/stickers/angelina-seaside.gif', 1],
  ['angelina-diving-gif', '安心院·潜水（动态）', '/assets/stickers/angelina-diving.gif', 1],
  ['angelina-reading-gif', '安心院·看书（动态）', '/assets/stickers/angelina-reading.gif', 1],
  ['angelina-paper-plane-gif', '安心院·纸飞机（动态）', '/assets/stickers/angelina-paper-plane.gif', 1],
  ['angelina-shopping-gif', '安心院·购物（动态）', '/assets/stickers/angelina-shopping.gif', 1],
  ['angelina-delivery-gif', '安心院·送货（动态）', '/assets/stickers/angelina-delivery.gif', 1],
  ['angelina-cycling-gif', '安心院·骑行（动态）', '/assets/stickers/angelina-cycling.gif', 1],
];

export const STICKER_ASSETS: StickerAsset[] = [
  {
    id: 'orange-lettering',
    name: '酸橙宣言',
    src: '/assets/stickers/orange-lettering.svg',
    format: 'SVG',
    source: 'both',
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
  {
    id: 'anlan-1',
    name: '安澜 1',
    src: '/assets/stickers/anlan-1.png',
    format: 'PNG',
    source: 'fan',
    aspectRatio: 289 / 374,
  },
  {
    id: 'anlan-2',
    name: '安澜 2',
    src: '/assets/stickers/anlan-2.png',
    format: 'PNG',
    source: 'fan',
    aspectRatio: 248 / 349,
  },
  {
    id: 'anlan-3',
    name: '安澜 3',
    src: '/assets/stickers/anlan-3.png',
    format: 'PNG',
    source: 'fan',
    aspectRatio: 283 / 419,
  },
  {
    id: 'anlan-4',
    name: '安澜 4',
    src: '/assets/stickers/anlan-4.png',
    format: 'PNG',
    source: 'fan',
    aspectRatio: 285 / 389,
  },
  {
    id: 'anlan-5',
    name: '安澜 5',
    src: '/assets/stickers/anlan-5.png',
    format: 'PNG',
    source: 'fan',
    aspectRatio: 895 / 282,
  },
  {
    id: 'anlan-6',
    name: '安澜 6',
    src: '/assets/stickers/anlan-6.png',
    format: 'PNG',
    source: 'fan',
    aspectRatio: 850 / 280,
  },
  ...ANGELINA_PNG_STICKERS.map((definition) => createRasterSticker('PNG', definition)),
  ...ANGELINA_GIF_STICKERS.map((definition) => createRasterSticker('GIF', definition)),
];
