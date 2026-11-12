/**
 * Browser Canvas によるスコアブック画像前処理。
 * 1) 鮮鋭化・コントラスト補正したカラー原本
 * 2) 枠線・黒文字を残しつつ、赤ペン（明るい赤＋黒線上の暗い赤茶色）を
 *    クリムゾンレッド (#DC2626) にブーストした解析用画像
 */

import { IMAGE_JPEG_QUALITY, IMAGE_MAX_SIDE } from "./constants";

export interface ProcessedImages {
  colorDataUrl: string;
  redDataUrl: string;
  width: number;
  height: number;
}

/** 感度 0（弱）〜 100（強）。標準は 50 */
export type RedSensitivity = number;

export const DEFAULT_RED_SENSITIVITY = 50;

/** 強調先のクリムゾンレッド */
export const CRIMSON_R = 0xdc;
export const CRIMSON_G = 0x26;
export const CRIMSON_B = 0x26;

export interface ProcessOptions {
  maxSide?: number;
  rotationDeg?: number;
  jpegQuality?: number;
  /** 赤ブーストの感度 0–100 */
  redSensitivity?: RedSensitivity;
}

interface Hsv {
  h: number; // 0–360
  s: number; // 0–1
  v: number; // 0–1
}

function loadImage(file: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
    if (typeof file === "string") {
      img.src = file;
    } else {
      img.src = URL.createObjectURL(file);
    }
  });
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas が利用できません");
  return { canvas, ctx };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** RGB → HSV */
export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max <= 1e-6 ? 0 : d / max;
  return { h, s, v: max };
}

/** 色相が赤〜オレンジ／マゼンタ寄りか */
function inRedHueRange(h: number): boolean {
  return h <= 45 || h >= 300;
}

/**
 * 感度に応じた「R が G/B よりどれだけ上回れば赤とみなすか」の下限。
 * 強: 3 / 標準: 6 / 弱: 12
 */
function minRedDominance(sensitivity: RedSensitivity): number {
  const s = Math.max(0, Math.min(100, sensitivity));
  return 12 - (s / 100) * 9;
}

/**
 * 赤ペン判定（明るい赤 + 黒菱形上の暗い赤茶色まで）。
 * - 黒ボールペン／印刷のニュートラルな黒・グレーは除外
 * - R が G/B よりわずかでも上回る暗い赤茶色、または赤〜オレンジ〜マゼンタ色相を拾う
 */
export function isRedPenPixel(
  r: number,
  g: number,
  b: number,
  sensitivity: RedSensitivity = DEFAULT_RED_SENSITIVITY,
): boolean {
  const { h, s, v } = rgbToHsv(r, g, b);
  const dom = r - Math.max(g, b);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const minDom = minRedDominance(sensitivity);

  // ほぼ無彩色の黒・グレー（枠線・選手名・鉛筆）は赤ではない
  if (chroma < 5 && dom < minDom) return false;
  if (Math.abs(r - g) <= 4 && Math.abs(r - b) <= 4 && Math.abs(g - b) <= 4 && dom < minDom) {
    return false;
  }

  // A) 明確な赤優勢（明るい赤・朱色・ピンク）
  if (dom >= minDom && r >= g && r >= b) {
    if (inRedHueRange(h) || s >= 0.08 || v >= 0.35) return true;
  }

  // B) 黒線上の暗い赤茶色（あずき色）:
  //    明度・彩度が低くても、R がわずかに勝ち、色相が赤系なら赤ペン
  if (v < 0.62 && r >= g && r >= b) {
    const darkDomNeed = Math.max(3, minDom - 3);
    if (dom >= darkDomNeed && chroma >= 4) return true;
    if (inRedHueRange(h) && dom >= Math.max(2, darkDomNeed - 1) && chroma >= 3) return true;
    // 黒のエッジに滲んだ赤: かなり暗いが R だけ少し高い
    if (v < 0.35 && dom >= Math.max(2, darkDomNeed - 2) && r > g && r > b) return true;
  }

  // C) 色相ベース（照明で彩度が落ちた赤〜マゼンタ）
  if (inRedHueRange(h) && s >= 0.06 && dom >= Math.max(2, minDom - 4) && r >= Math.min(g, b)) {
    return true;
  }

  return false;
}

/**
 * 赤みブーストフィルター:
 * - 赤ペン（明るい赤＋暗い赤茶色）→ #DC2626 に置換
 * - 黒枠・黒文字・選手名はそのまま残す
 * - 紙の薄い影だけを白寄りに整える（真っ白塗りつぶしはしない）
 */
export function extractRed(
  imageData: ImageData,
  sensitivity: RedSensitivity = DEFAULT_RED_SENSITIVITY,
): ImageData {
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    if (isRedPenPixel(r, g, b, sensitivity)) {
      data[i] = CRIMSON_R;
      data[i + 1] = CRIMSON_G;
      data[i + 2] = CRIMSON_B;
      data[i + 3] = 255;
      continue;
    }

    // 非赤: 構造を残す。紙の影だけ穏やかにリフト
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luma >= 155) {
      // 明るい紙面・薄い影 → 白寄りに整える（枠線は消さない）
      const shadowDepth = clamp01((220 - luma) / 65); // 暗い紙ほど強くリフト
      const lift = 0.22 + 0.28 * shadowDepth;
      data[i] = clamp(r + (255 - r) * lift);
      data[i + 1] = clamp(g + (255 - g) * lift);
      data[i + 2] = clamp(b + (255 - b) * lift);
    } else if (luma >= 110) {
      // 中間トーン: ごく弱くリフトのみ
      const lift = 0.08;
      data[i] = clamp(r + (255 - r) * lift);
      data[i + 1] = clamp(g + (255 - g) * lift);
      data[i + 2] = clamp(b + (255 - b) * lift);
    }
    // luma < 110: 黒枠・黒文字・濃い印刷はそのまま
  }
  return imageData;
}

/** コントラスト・シャープネス強調 */
function enhanceColor(imageData: ImageData): ImageData {
  const data = imageData.data;
  const contrast = 1.4;
  const factor = ((259 * (contrast * 128 + 255)) / 255) * (259 - contrast * 128);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp(factor * (data[i] - 128) + 128);
    data[i + 1] = clamp(factor * (data[i + 1] - 128) + 128);
    data[i + 2] = clamp(factor * (data[i + 2] - 128) + 128);
  }
  return sharpen(imageData, 0.55);
}

/** 簡易シャープネス（アンシャープマスク風） */
function sharpen(imageData: ImageData, amount: number): ImageData {
  const { width, height, data } = imageData;
  const copy = new Uint8ClampedArray(data);
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let ki = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4 + c;
            sum += copy[idx] * kernel[ki++];
          }
        }
        const idx = (y * width + x) * 4 + c;
        data[idx] = clamp(copy[idx] * (1 - amount) + sum * amount);
      }
    }
  }
  return imageData;
}

/** 長辺を maxSide にリサイズ（API送信サイズ抑制） */
function fitSize(w: number, h: number, maxSide = IMAGE_MAX_SIDE) {
  const side = Math.max(w, h);
  if (side <= maxSide) return { width: w, height: h };
  const scale = maxSide / side;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

async function drawSourceToCanvas(
  source: File | Blob | string,
  options?: { maxSide?: number; rotationDeg?: number },
): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; width: number; height: number }> {
  const img = await loadImage(source);
  const rotation = ((options?.rotationDeg ?? 0) % 360 + 360) % 360;
  const swapped = rotation === 90 || rotation === 270;
  const naturalW = swapped ? img.naturalHeight : img.naturalWidth;
  const naturalH = swapped ? img.naturalWidth : img.naturalHeight;
  const { width, height } = fitSize(naturalW, naturalH, options?.maxSide ?? IMAGE_MAX_SIDE);

  const { canvas, ctx } = createCanvas(width, height);
  ctx.save();
  if (rotation === 90) {
    ctx.translate(width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, 0, 0, height, width);
  } else if (rotation === 180) {
    ctx.translate(width, height);
    ctx.rotate(Math.PI);
    ctx.drawImage(img, 0, 0, width, height);
  } else if (rotation === 270) {
    ctx.translate(0, height);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(img, 0, 0, height, width);
  } else {
    ctx.drawImage(img, 0, 0, width, height);
  }
  ctx.restore();
  return { canvas, ctx, width, height };
}

export async function processScorebookImage(
  source: File | Blob | string,
  options?: ProcessOptions,
): Promise<ProcessedImages> {
  const jpegQuality = options?.jpegQuality ?? IMAGE_JPEG_QUALITY;
  const redSensitivity = options?.redSensitivity ?? DEFAULT_RED_SENSITIVITY;
  const { ctx, width, height } = await drawSourceToCanvas(source, options);

  const base = ctx.getImageData(0, 0, width, height);

  const colorData = new ImageData(new Uint8ClampedArray(base.data), width, height);
  enhanceColor(colorData);
  const { canvas: colorCanvas, ctx: colorCtx } = createCanvas(width, height);
  colorCtx.putImageData(colorData, 0, 0);

  const redData = new ImageData(new Uint8ClampedArray(base.data), width, height);
  extractRed(redData, redSensitivity);
  const { canvas: redCanvas, ctx: redCtx } = createCanvas(width, height);
  redCtx.putImageData(redData, 0, 0);

  return {
    colorDataUrl: colorCanvas.toDataURL("image/jpeg", jpegQuality),
    redDataUrl: redCanvas.toDataURL("image/jpeg", jpegQuality),
    width,
    height,
  };
}

/**
 * 元写真から赤ブーストだけ感度を変えて再生成する。
 */
export async function reprocessRedOnly(
  source: File | Blob | string,
  redSensitivity: RedSensitivity,
  options?: Omit<ProcessOptions, "redSensitivity">,
): Promise<{ redDataUrl: string; width: number; height: number }> {
  const jpegQuality = options?.jpegQuality ?? IMAGE_JPEG_QUALITY;
  const { ctx, width, height } = await drawSourceToCanvas(source, options);
  const base = ctx.getImageData(0, 0, width, height);
  extractRed(base, redSensitivity);
  const { canvas: redCanvas, ctx: redCtx } = createCanvas(width, height);
  redCtx.putImageData(base, 0, 0);
  return {
    redDataUrl: redCanvas.toDataURL("image/jpeg", jpegQuality),
    width,
    height,
  };
}

export function dataUrlToBase64(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

export function rotateDataUrl(dataUrl: string, degrees: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const rad = ((degrees % 360) * Math.PI) / 180;
      const swap = degrees % 180 !== 0;
      const w = swap ? img.naturalHeight : img.naturalWidth;
      const h = swap ? img.naturalWidth : img.naturalHeight;
      const { canvas, ctx } = createCanvas(w, h);
      ctx.translate(w / 2, h / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      resolve(canvas.toDataURL("image/jpeg", IMAGE_JPEG_QUALITY));
    };
    img.onerror = () => reject(new Error("回転に失敗しました"));
    img.src = dataUrl;
  });
}

export function sensitivityLabel(value: RedSensitivity): string {
  if (value <= 33) return "弱";
  if (value <= 66) return "標準";
  return "強";
}
