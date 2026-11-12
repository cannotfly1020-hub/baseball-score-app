/**
 * Browser Canvas によるスコアブック画像前処理。
 * 1) 鮮鋭化・コントラスト補正したカラー原本
 * 2) HSV + 彩度ベースの赤色抽出フィルター画像
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

export interface ProcessOptions {
  maxSide?: number;
  rotationDeg?: number;
  jpegQuality?: number;
  /** 赤抽出の感度 0–100 */
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

/**
 * 色相が赤〜オレンジ寄り / マゼンタ寄りかどうかを 0–1 で返す。
 * スマホ撮影で朱色・ピンク・茶赤に寄っても拾えるよう広めに取る。
 */
function redHueAffinity(h: number): number {
  // 赤〜オレンジ: 0–45°
  if (h <= 45) return clamp01(1 - (h / 45) * 0.35);
  // マゼンタ寄り: 315–360°
  if (h >= 315) return clamp01(1 - ((360 - h) / 45) * 0.4);
  // やや外側のピンク〜赤紫: 300–315
  if (h >= 300) return clamp01(((h - 300) / 15) * 0.55);
  return 0;
}

/**
 * 赤みスコア（0–1）:
 * HSV の色相・彩度 + RGB の赤優勢を組み合わせ、
 * 照明で朱色/ピンク/茶っぽく写った赤ボールペンも拾う。
 */
export function computeRednessScore(r: number, g: number, b: number): number {
  const { h, s, v } = rgbToHsv(r, g, b);
  const hueAff = redHueAffinity(h);
  if (hueAff <= 0) return 0;

  // 低彩度（グレー・黒ボールペン・鉛筆・影）は落とす
  if (s < 0.12) return 0;
  // 極端に暗い画素は黒枠線扱い
  if (v < 0.12) return 0;
  // 極端に明るい低彩度は紙背景
  if (v > 0.92 && s < 0.18) return 0;

  const satTerm = clamp01((s - 0.12) / 0.55);
  const valTerm = clamp01(1 - Math.abs(v - 0.55) / 0.55); // 中〜やや明るい赤インクを優遇
  const rgbDom = clamp01((r - Math.max(g, b)) / 70);
  const rgbRatio = clamp01((r / (g + b + 1) - 0.95) / 0.8);

  // 茶っぽい赤（オレンジ寄り＋中彩度）も少し加点
  const warmBoost = h > 15 && h < 40 && s > 0.25 && r > g ? 0.12 : 0;

  const score =
    hueAff * 0.42 +
    satTerm * 0.28 +
    rgbDom * 0.16 +
    rgbRatio * 0.1 +
    valTerm * 0.04 +
    warmBoost;

  return clamp01(score);
}

/** 感度 0–100 → しきい値（高い感度 = 低いしきい値 = より多く赤と判定） */
function thresholdForSensitivity(sensitivity: RedSensitivity): number {
  const s = Math.max(0, Math.min(100, sensitivity));
  // 弱: 0.58 / 標準: 0.38 / 強: 0.22
  return 0.58 - (s / 100) * 0.36;
}

/**
 * 赤色抽出フィルター:
 * 赤みスコアで赤ペンを濃い赤に強調し、それ以外は完全白 (#FFFFFF) へ飛ばす。
 */
export function extractRed(
  imageData: ImageData,
  sensitivity: RedSensitivity = DEFAULT_RED_SENSITIVITY,
): ImageData {
  const data = imageData.data;
  const threshold = thresholdForSensitivity(sensitivity);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const score = computeRednessScore(r, g, b);

    if (score >= threshold) {
      // 高コントラストの濃い赤で浮かび上がらせる（弱い赤は少し淡く）
      const strength = clamp01((score - threshold) / Math.max(0.05, 1 - threshold));
      data[i] = 200 + Math.round(55 * strength); // 200–255
      data[i + 1] = Math.round(18 * (1 - strength));
      data[i + 2] = Math.round(18 * (1 - strength));
      data[i + 3] = 255;
    } else {
      // 黒ボールペン枠線・紙背景・影を真っ白へ
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
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
 * 既存の前処理済みカラー原本ではなく、元写真から赤抽出だけ感度を変えて再生成する。
 * （カラー原本は維持したい場合は color 側を呼び出し元で保持）
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
