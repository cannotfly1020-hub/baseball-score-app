/**
 * Browser Canvas によるスコアブック画像前処理。
 * 1) 鮮鋭化・コントラスト補正したカラー原本
 * 2) 赤色抽出フィルター画像
 */

export interface ProcessedImages {
  colorDataUrl: string;
  redDataUrl: string;
  width: number;
  height: number;
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

/** コントラスト・シャープネス強調 */
function enhanceColor(imageData: ImageData): ImageData {
  const data = imageData.data;
  const contrast = 1.4;
  const factor = ((259 * (contrast * 128 + 255)) / 255) * (259 - contrast * 128);
  // first pass: contrast
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

/**
 * 赤色抽出フィルター:
 * 赤成分を強調し、黒枠線・背景を白〜薄グレーへ飛ばす
 */
function extractRed(imageData: ImageData): ImageData {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // 赤優勢度（赤ペン判定）
    const redDominance = r - Math.max(g, b);
    const redRatio = r / (g + b + 1);
    const isRedInk =
      r > 90 &&
      redDominance > 18 &&
      redRatio > 1.15 &&
      !(r < 60 && g < 60 && b < 60);

    if (isRedInk) {
      // 真っ赤に浮かび上がらせる
      const intensity = clamp(120 + redDominance * 2.2);
      data[i] = 220 + Math.min(35, intensity / 8);
      data[i + 1] = clamp(40 - redDominance * 0.2);
      data[i + 2] = clamp(40 - redDominance * 0.2);
    } else {
      // 黒〜グレー枠線と背景を白〜薄グレーへ
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const lifted = clamp(210 + luma * 0.18);
      data[i] = lifted;
      data[i + 1] = lifted;
      data[i + 2] = lifted;
    }
  }
  return imageData;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** 長辺を maxSide にリサイズ（API送信サイズ抑制） */
function fitSize(w: number, h: number, maxSide = 2048) {
  const side = Math.max(w, h);
  if (side <= maxSide) return { width: w, height: h };
  const scale = maxSide / side;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export async function processScorebookImage(
  source: File | Blob | string,
  options?: { maxSide?: number; rotationDeg?: number },
): Promise<ProcessedImages> {
  const img = await loadImage(source);
  const rotation = ((options?.rotationDeg ?? 0) % 360 + 360) % 360;
  const swapped = rotation === 90 || rotation === 270;
  const naturalW = swapped ? img.naturalHeight : img.naturalWidth;
  const naturalH = swapped ? img.naturalWidth : img.naturalHeight;
  const { width, height } = fitSize(naturalW, naturalH, options?.maxSide ?? 2048);

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

  if (typeof source !== "string" && source instanceof Blob) {
    // revoke if object URL was used — loadImage already consumed it; OK to leave GC
  }

  const base = ctx.getImageData(0, 0, width, height);

  const colorData = new ImageData(new Uint8ClampedArray(base.data), width, height);
  enhanceColor(colorData);
  const { canvas: colorCanvas, ctx: colorCtx } = createCanvas(width, height);
  colorCtx.putImageData(colorData, 0, 0);

  const redData = new ImageData(new Uint8ClampedArray(base.data), width, height);
  extractRed(redData);
  const { canvas: redCanvas, ctx: redCtx } = createCanvas(width, height);
  redCtx.putImageData(redData, 0, 0);

  return {
    colorDataUrl: colorCanvas.toDataURL("image/jpeg", 0.92),
    redDataUrl: redCanvas.toDataURL("image/jpeg", 0.92),
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
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => reject(new Error("回転に失敗しました"));
    img.src = dataUrl;
  });
}
