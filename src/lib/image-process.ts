/**
 * Browser Canvas によるスコアブック画像前処理。
 * 1) 高コントラスト原本（黒文字・枠線を鮮明化、長辺 ≤1600px）
 * 2) 赤強調画像（線の細さを保ったまま赤ペン彩度を上げる）
 * 解析送信は FormData バイナリで合計 ≤1.2MB 目標（絶対上限 1.5MB）。
 * サーバ側は画像加工せず Base64 中継のみ。
 */

import {
  ANALYZE_MAX_PAYLOAD_BYTES,
  ANALYZE_TARGET_PAYLOAD_BYTES,
  IMAGE_JPEG_QUALITY,
  IMAGE_MAX_SIDE,
} from "./constants";

export interface ProcessedImages {
  colorDataUrl: string;
  redDataUrl: string;
  width: number;
  height: number;
}

/** AI解析APIへ送る最適化済み画像セット（合計 ≤ 1.2MB 目標） */
export interface AnalyzeImagePayload {
  colorDataUrl: string;
  redDataUrl: string;
  colorTopDataUrl: string;
  colorBottomDataUrl: string;
  redTopDataUrl: string;
  redBottomDataUrl: string;
  approxBytes: number;
  maxSide: number;
  jpegQuality: number;
  splitHalves: true;
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
/**
 * 黒ボールペン・枠線を鮮明にする高コントラスト処理。
 * 赤みのある画素は触らず、暗いインクを引き締め紙面を明るくする。
 */
export function enhanceBlackContrast(imageData: ImageData): ImageData {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // 赤ペン候補はスキップ（赤強調側で扱う）
    if (r > g + 10 && r > b + 10) continue;

    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    let target = lum;
    if (lum < 150) target = Math.max(0, lum * 0.78);
    else if (lum > 205) target = Math.min(255, 255 - (255 - lum) * 0.55);
    if (lum < 1) continue;
    const scale = target / lum;
    data[i] = clamp(r * scale);
    data[i + 1] = clamp(g * scale);
    data[i + 2] = clamp(b * scale);
  }
  return imageData;
}

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

  // 1枚目: 高コントラスト原本（黒文字鮮明化）
  const colorPixels = ctx.getImageData(0, 0, width, height);
  enhanceBlackContrast(colorPixels);
  ctx.putImageData(colorPixels, 0, 0);
  const colorDataUrl = canvas.toDataURL("image/jpeg", jpegQuality);

  // 2枚目: 同一解像度から赤強調のみ適用（コントラスト前のコピーを使う）
  const redSource = await drawSourceToCanvas(source, options);
  const redData = redSource.ctx.getImageData(0, 0, redSource.width, redSource.height);
  extractRed(redData, redSensitivity);
  const { canvas: redCanvas, ctx: redCtx } = createCanvas(redSource.width, redSource.height);
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

export function dataUrlToBlob(dataUrl: string, mime = "image/jpeg"): Blob {
  const b64 = dataUrlToBase64(dataUrl);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * 全体俯瞰＋上下2分割（打順1–5 / 6–9）を用意し、合計 ≤1.2MB（目標）に収める。
 * 長辺最大 1600px・JPEG 品質は 0.82 から段階的に下げる。
 */
export async function prepareAnalyzeImages(
  colorDataUrl: string,
  redDataUrl: string,
  options?: { maxBytes?: number },
): Promise<AnalyzeImagePayload> {
  const maxBytes = options?.maxBytes ?? ANALYZE_TARGET_PAYLOAD_BYTES;
  const hardMax = ANALYZE_MAX_PAYLOAD_BYTES;
  // 品質は標準 0.82 から。サイズが厳しければ下げる。
  const qualitySteps = [IMAGE_JPEG_QUALITY, 0.75, 0.68, 0.6, 0.52, 0.45];
  const overviewSides = [1100, 1000, 900, 800, 700];
  const halfSides = [IMAGE_MAX_SIDE, 1400, 1200, 1000, 900, 800];

  let lastPayload: AnalyzeImagePayload | null = null;

  for (let i = 0; i < halfSides.length; i++) {
    const halfSide = halfSides[i];
    const overviewSide = overviewSides[Math.min(i, overviewSides.length - 1)];
    for (const jpegQuality of qualitySteps) {
      const color = await reencodeDataUrl(colorDataUrl, overviewSide, jpegQuality);
      const red = await reencodeDataUrl(redDataUrl, overviewSide, jpegQuality);
      const colorHi = await reencodeDataUrl(colorDataUrl, halfSide, jpegQuality);
      const redHi = await reencodeDataUrl(redDataUrl, halfSide, jpegQuality);
      const colorHalves = await splitVerticalHalves(colorHi.dataUrl, jpegQuality);
      const redHalves = await splitVerticalHalves(redHi.dataUrl, jpegQuality);

      const payload: AnalyzeImagePayload = {
        colorDataUrl: color.dataUrl,
        redDataUrl: red.dataUrl,
        colorTopDataUrl: colorHalves.top,
        colorBottomDataUrl: colorHalves.bottom,
        redTopDataUrl: redHalves.top,
        redBottomDataUrl: redHalves.bottom,
        approxBytes: 0,
        maxSide: halfSide,
        jpegQuality,
        splitHalves: true,
      };
      payload.approxBytes = approxDecodedBytes(
        payload.colorDataUrl,
        payload.redDataUrl,
        payload.colorTopDataUrl,
        payload.colorBottomDataUrl,
        payload.redTopDataUrl,
        payload.redBottomDataUrl,
      );
      lastPayload = payload;
      if (payload.approxBytes <= maxBytes) return payload;
    }
  }

  // 最終フォールバック
  const color = await reencodeDataUrl(colorDataUrl, 700, 0.4);
  const red = await reencodeDataUrl(redDataUrl, 700, 0.4);
  const colorHalves = await splitVerticalHalves(color.dataUrl, 0.4);
  const redHalves = await splitVerticalHalves(red.dataUrl, 0.4);
  const payload: AnalyzeImagePayload = {
    colorDataUrl: color.dataUrl,
    redDataUrl: red.dataUrl,
    colorTopDataUrl: colorHalves.top,
    colorBottomDataUrl: colorHalves.bottom,
    redTopDataUrl: redHalves.top,
    redBottomDataUrl: redHalves.bottom,
    approxBytes: 0,
    maxSide: 700,
    jpegQuality: 0.4,
    splitHalves: true,
  };
  payload.approxBytes = approxDecodedBytes(
    payload.colorDataUrl,
    payload.redDataUrl,
    payload.colorTopDataUrl,
    payload.colorBottomDataUrl,
    payload.redTopDataUrl,
    payload.redBottomDataUrl,
  );
  if (payload.approxBytes > hardMax && lastPayload && lastPayload.approxBytes <= hardMax) {
    return lastPayload;
  }
  return payload;
}

export type AnalyzePageHint = "single" | "first_half" | "second_half";

/** 解析 API 用 FormData（巨大 JSON+Base64 を使わない） */
export function buildAnalyzeFormData(args: {
  images: AnalyzeImagePayload;
  roster: unknown;
  matchMeta: { match_date?: string; opponent?: string };
  apiKey?: string;
  /** 見開き2枚のうちどのページか（プロンプト誘導用） */
  pageHint?: AnalyzePageHint;
}): FormData {
  const fd = new FormData();
  fd.append("color", dataUrlToBlob(args.images.colorDataUrl), "color.jpg");
  fd.append("red", dataUrlToBlob(args.images.redDataUrl), "red.jpg");
  fd.append("colorTop", dataUrlToBlob(args.images.colorTopDataUrl), "color-top.jpg");
  fd.append("colorBottom", dataUrlToBlob(args.images.colorBottomDataUrl), "color-bottom.jpg");
  fd.append("redTop", dataUrlToBlob(args.images.redTopDataUrl), "red-top.jpg");
  fd.append("redBottom", dataUrlToBlob(args.images.redBottomDataUrl), "red-bottom.jpg");
  fd.append("roster", JSON.stringify(args.roster ?? []));
  fd.append(
    "matchMeta",
    JSON.stringify({
      ...(args.matchMeta ?? {}),
      pageHint: args.pageHint || "single",
    }),
  );
  if (args.apiKey) fd.append("apiKey", args.apiKey);
  fd.append(
    "imageMeta",
    JSON.stringify({
      maxSide: args.images.maxSide,
      jpegQuality: args.images.jpegQuality,
      approxBytes: args.images.approxBytes,
      pageHint: args.pageHint || "single",
    }),
  );
  return fd;
}

/** 自己テスト用: dryRun フラグ付き FormData */
export function appendDryRunFlag(form: FormData): FormData {
  form.append("dryRun", "1");
  return form;
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
  if (value <= 60) return "標準";
  if (value < 85) return "強";
  return "最大";
}
