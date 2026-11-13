/**
 * Browser Canvas によるスコアブック画像前処理。
 * 1) 加工なし高解像度カラー原本（リサイズのみ・黒文字判読用）
 * 2) 線の細さ・筆圧の濃淡を保ったまま、赤みのある画素の G/B だけを
 *    引き下げて彩度を自然に上げた解析用画像（単色ベタ塗り・膨張なし）
 */

import { IMAGE_JPEG_QUALITY, IMAGE_MAX_SIDE } from "./constants";

export interface ProcessedImages {
  colorDataUrl: string;
  redDataUrl: string;
  width: number;
  height: number;
}

/** 感度 0（加工なし）〜 100（最大強調）。赤が浮かび黒文字も潰れない初期値 */
export type RedSensitivity = number;

export const DEFAULT_RED_SENSITIVITY = 45;

export interface ProcessOptions {
  maxSide?: number;
  rotationDeg?: number;
  jpegQuality?: number;
  /** 赤強調の強度 0–100（0=原本） */
  redSensitivity?: RedSensitivity;
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

/**
 * 感度 0–100 → G/B の残存率（1=変更なし、小さいほど赤く見える）。
 * 0 → 1.00（原本） / 50 → 約 0.54 / 100 → 約 0.08
 */
function gbKeepFactor(sensitivity: RedSensitivity): number {
  const t = Math.max(0, Math.min(100, sensitivity)) / 100;
  return 1 - t * 0.92;
}

/**
 * 赤み強調フィルター（ベタ塗り・膨張なし）:
 * - sensitivity=0: 完全に加工なし（原本）
 * - R > G かつ R > B の画素だけ、元の R と濃淡を保ったまま G/B を強度に応じて減算
 * - 線の細さ・筆圧の濃淡はピクセル構造ごと維持される
 */
export function extractRed(
  imageData: ImageData,
  sensitivity: RedSensitivity = DEFAULT_RED_SENSITIVITY,
): ImageData {
  const amount = Math.max(0, Math.min(100, sensitivity));
  if (amount <= 0) {
    // スライダー左端: 加工なし
    return imageData;
  }

  const data = imageData.data;
  const gbKeep = gbKeepFactor(amount);
  // ごく弱いコントラスト: R はそのまま、減った G/B 側だけ効かせる
  // （画素の置き換えや近傍への塗り広げは行わない）

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    if (r > g && r > b) {
      data[i] = r;
      data[i + 1] = clamp(g * gbKeep);
      data[i + 2] = clamp(b * gbKeep);
    }
    // それ以外（黒枠・黒文字・紙）は一切変更しない
  }
  return imageData;
}

/** 長辺を maxSide にリサイズ（小さな黒文字判読と API 送信のバランス） */
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
  const { canvas, ctx, width, height } = await drawSourceToCanvas(source, options);

  // 1枚目: 色加工なしの高解像度カラー原本（リサイズ＋JPEGのみ）
  const colorDataUrl = canvas.toDataURL("image/jpeg", jpegQuality);

  // 2枚目: 同一解像度から赤強調のみ適用
  const base = ctx.getImageData(0, 0, width, height);
  const redData = new ImageData(new Uint8ClampedArray(base.data), width, height);
  extractRed(redData, redSensitivity);
  const { canvas: redCanvas, ctx: redCtx } = createCanvas(width, height);
  redCtx.putImageData(redData, 0, 0);

  return {
    colorDataUrl,
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
  if (value <= 0) return "原本";
  if (value < 40) return "弱";
  if (value <= 60) return "自然";
  if (value < 85) return "強";
  return "最大";
}
