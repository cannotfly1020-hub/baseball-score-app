import sharp from "sharp";

export interface RowSlice {
  battingOrder: number;
  base64: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
}

export interface SliceOptions {
  /** 打順行数（通常9） */
  rowCount?: number;
  /** 行高さに対する上下オーバーラップ比率 */
  overlapRatio?: number;
  /** ヘッダー（イニング数字など）除外比率 */
  headerRatio?: number;
  /** フッター（合計行など）除外比率 */
  footerRatio?: number;
  /** 切り出し後の拡大倍率 */
  scale?: number;
  jpegQuality?: number;
}

function decodeBase64(input: string): Buffer {
  const cleaned = input.replace(/^data:image\/\w+;base64,/, "");
  return Buffer.from(cleaned, "base64");
}

/**
 * スコアブック画像を打順ごとの横帯に分割し、オーバーラップ付きで拡大する。
 * 早稲田式の典型レイアウト（上部イニング見出し → 1〜9番の行 → 下部集計）を仮定。
 */
export async function sliceBattingRows(
  imageBase64: string,
  options?: SliceOptions,
): Promise<RowSlice[]> {
  const rowCount = options?.rowCount ?? 9;
  const overlapRatio = options?.overlapRatio ?? 0.22;
  const headerRatio = options?.headerRatio ?? 0.09;
  const footerRatio = options?.footerRatio ?? 0.07;
  const scale = options?.scale ?? 2.2;
  const jpegQuality = options?.jpegQuality ?? 90;

  const input = decodeBase64(imageBase64);
  const meta = await sharp(input).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 32 || height < 32) {
    throw new Error("画像サイズが不正です（行スライス不可）");
  }

  const contentTop = Math.round(height * headerRatio);
  const contentBottom = Math.round(height * (1 - footerRatio));
  const contentH = Math.max(1, contentBottom - contentTop);
  const rowH = contentH / rowCount;
  const overlap = rowH * overlapRatio;

  const slices: RowSlice[] = [];
  for (let i = 0; i < rowCount; i++) {
    const rawTop = contentTop + i * rowH - overlap;
    const rawBottom = contentTop + (i + 1) * rowH + overlap;
    const top = Math.max(0, Math.floor(rawTop));
    const bottom = Math.min(height, Math.ceil(rawBottom));
    const sliceH = Math.max(1, bottom - top);
    const outW = Math.round(width * scale);
    const outH = Math.round(sliceH * scale);

    const buf = await sharp(input)
      .extract({ left: 0, top, width, height: sliceH })
      .resize(outW, outH, { kernel: sharp.kernel.lanczos3 })
      .jpeg({ quality: jpegQuality, mozjpeg: true })
      .toBuffer();

    slices.push({
      battingOrder: i + 1,
      base64: buf.toString("base64"),
      mimeType: "image/jpeg",
      width: outW,
      height: outH,
    });
  }
  return slices;
}

/** 俯瞰用に長辺を抑えた参照サムネイルを作る */
export async function makeOverviewThumb(
  imageBase64: string,
  maxSide = 1400,
  jpegQuality = 85,
): Promise<{ base64: string; mimeType: "image/jpeg" }> {
  const input = decodeBase64(imageBase64);
  const buf = await sharp(input)
    .resize({
      width: maxSide,
      height: maxSide,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: jpegQuality, mozjpeg: true })
    .toBuffer();
  return { base64: buf.toString("base64"), mimeType: "image/jpeg" };
}
