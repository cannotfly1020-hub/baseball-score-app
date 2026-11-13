/**
 * Browser Canvas によるスコアブック画像前処理。
 * 1) 加工なしカラー原本（長辺 ≤1800px・リサイズのみ）
 * 2) 線の細さ・筆圧の濃淡を保ったまま、赤みのある画素の G/B だけを
 *    引き下げて彩度を自然に上げた解析用画像（単色ベタ塗り・膨張なし）
 * 解析送信時は prepareAnalyzeImages で合計 ≤3MB に圧縮する。
 */

import {
  ANALYZE_MAX_PAYLOAD_BYTES,
  IMAGE_JPEG_QUALITY,
  IMAGE_MAX_SIDE,
} from "./constants";

export interface ProcessedImages {
  colorDataUrl: string;
  redDataUrl: string;
  width: number;
  height: number;
}

/** AI解析APIへ送る最適化済み画像セット（合計 ≤ 3MB） */
export interface AnalyzeImagePayload {
  colorDataUrl: string;
  redDataUrl: string;
  /** 必要時のみ: 上下2分割（原本） */
  colorTopDataUrl?: string;
  colorBottomDataUrl?: string;
  /** 必要時のみ: 上下2分割（赤強調） */
  redTopDataUrl?: string;
  redBottomDataUrl?: string;
  approxBytes: number;
  maxSide: number;
  jpegQuality: number;
  splitHalves: boolean;
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

/** base64（data URL可）から概算バイト数 */
export function approxDecodedBytes(...parts: string[]): number {
  let chars = 0;
  for (const p of parts) {
    if (!p) continue;
    chars += dataUrlToBase64(p).length;
  }
  return Math.round(chars * 0.75);
}

async function reencodeDataUrl(
  dataUrl: string,
  maxSide: number,
  jpegQuality: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const { canvas, width, height } = await drawSourceToCanvas(dataUrl, { maxSide });
  return {
    dataUrl: canvas.toDataURL("image/jpeg", jpegQuality),
    width,
    height,
  };
}

async function splitVerticalHalves(
  dataUrl: string,
  jpegQuality: number,
): Promise<{ top: string; bottom: string }> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const mid = Math.floor(h / 2);
  const overlap = Math.round(h * 0.04); // 境界の打順行が切れないよう少し重ねる

  const topH = Math.min(h, mid + overlap);
  const bottomTop = Math.max(0, mid - overlap);
  const bottomH = h - bottomTop;

  const topCanvas = createCanvas(w, topH);
  topCanvas.ctx.drawImage(img, 0, 0, w, topH, 0, 0, w, topH);

  const bottomCanvas = createCanvas(w, bottomH);
  bottomCanvas.ctx.drawImage(img, 0, bottomTop, w, bottomH, 0, 0, w, bottomH);

  return {
    top: topCanvas.canvas.toDataURL("image/jpeg", jpegQuality),
    bottom: bottomCanvas.canvas.toDataURL("image/jpeg", jpegQuality),
  };
}

/**
 * AI解析用に原本＋赤強調を長辺1800 / JPEG0.85へ整え、
 * 合計サイズが 3MB を超える場合は品質・解像度を下げ、
 * なお大きい場合のみ上下2分割を付与する（それ以上は分割しない）。
 */
export async function prepareAnalyzeImages(
  colorDataUrl: string,
  redDataUrl: string,
  options?: { maxBytes?: number },
): Promise<AnalyzeImagePayload> {
  const maxBytes = options?.maxBytes ?? ANALYZE_MAX_PAYLOAD_BYTES;
  const qualitySteps = [IMAGE_JPEG_QUALITY, 0.75, 0.65, 0.55];
  const sideSteps = [IMAGE_MAX_SIDE, 1600, 1400, 1200];

  let best: AnalyzeImagePayload | null = null;

  for (const maxSide of sideSteps) {
    for (const jpegQuality of qualitySteps) {
      const color = await reencodeDataUrl(colorDataUrl, maxSide, jpegQuality);
      const red = await reencodeDataUrl(redDataUrl, maxSide, jpegQuality);
      const approxBytes = approxDecodedBytes(color.dataUrl, red.dataUrl);
      best = {
        colorDataUrl: color.dataUrl,
        redDataUrl: red.dataUrl,
        approxBytes,
        maxSide,
        jpegQuality,
        splitHalves: false,
      };
      if (approxBytes <= maxBytes) {
        return best;
      }
    }
  }

  // それでも超える場合: 上下2分割を付与しつつ本体はさらに圧縮した2枚を送る
  const fallbackQuality = 0.55;
  const fallbackSide = 1200;
  const color = await reencodeDataUrl(colorDataUrl, fallbackSide, fallbackQuality);
  const red = await reencodeDataUrl(redDataUrl, fallbackSide, fallbackQuality);
  const colorHalves = await splitVerticalHalves(color.dataUrl, fallbackQuality);
  const redHalves = await splitVerticalHalves(red.dataUrl, fallbackQuality);

  let payload: AnalyzeImagePayload = {
    colorDataUrl: color.dataUrl,
    redDataUrl: red.dataUrl,
    colorTopDataUrl: colorHalves.top,
    colorBottomDataUrl: colorHalves.bottom,
    redTopDataUrl: redHalves.top,
    redBottomDataUrl: redHalves.bottom,
    approxBytes: 0,
    maxSide: fallbackSide,
    jpegQuality: fallbackQuality,
    splitHalves: true,
  };

  payload.approxBytes = approxDecodedBytes(
    payload.colorDataUrl,
    payload.redDataUrl,
    payload.colorTopDataUrl || "",
    payload.colorBottomDataUrl || "",
    payload.redTopDataUrl || "",
    payload.redBottomDataUrl || "",
  );

  // 分割込みでも超える場合は分割を捨てて2枚のみさらに圧縮
  if (payload.approxBytes > maxBytes) {
    const tinyColor = await reencodeDataUrl(colorDataUrl, 1000, 0.5);
    const tinyRed = await reencodeDataUrl(redDataUrl, 1000, 0.5);
    payload = {
      colorDataUrl: tinyColor.dataUrl,
      redDataUrl: tinyRed.dataUrl,
      approxBytes: approxDecodedBytes(tinyColor.dataUrl, tinyRed.dataUrl),
      maxSide: 1000,
      jpegQuality: 0.5,
      splitHalves: false,
    };
  }

  return payload;
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
