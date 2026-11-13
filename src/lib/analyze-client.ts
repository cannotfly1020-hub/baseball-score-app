import {
  ANALYZE_MAX_PAYLOAD_BYTES,
  ANALYZE_TARGET_PAYLOAD_BYTES,
} from "@/lib/constants";
import {
  buildAnalyzeFormData,
  prepareAnalyzeImages,
  type AnalyzePageHint,
} from "@/lib/image-process";
import type { PageImageState } from "@/lib/page-image-state";
import type { PlayerAtBat, RosterPlayer } from "@/lib/types";

export type AnalyzeJson = {
  error?: string;
  detail?: string;
  players?: PlayerAtBat[];
  match_date?: string;
  opponent?: string;
  model?: string;
  inningScores?: number[];
  inningScoresMatched?: boolean;
};

/** 1ページ分を FormData で直列送信して解析結果を返す */
export async function analyzeScorePage(args: {
  page: PageImageState;
  pageHint: AnalyzePageHint;
  label: string;
  roster: RosterPlayer[];
  matchMeta: { match_date?: string; opponent?: string };
  apiKey?: string;
  onStatus?: (message: string) => void;
}): Promise<AnalyzeJson> {
  const { page, pageHint, label, roster, matchMeta, apiKey, onStatus } = args;
  if (!page.colorUrl || !page.redUrl) {
    throw new Error(`${label}の画像がありません`);
  }

  const prepared = await prepareAnalyzeImages(page.colorUrl, page.redUrl, {
    maxBytes: ANALYZE_TARGET_PAYLOAD_BYTES,
  });
  const approxMb = (prepared.approxBytes / (1024 * 1024)).toFixed(2);
  if (prepared.approxBytes > ANALYZE_MAX_PAYLOAD_BYTES) {
    throw new Error(
      `${label}の画像が大きすぎます（約 ${approxMb}MB / 上限1.5MB・目標1.2MB）。別の写真で撮り直してください。`,
    );
  }

  onStatus?.(`${label}を Gemini で解析中…（FormData 約 ${approxMb}MB・直列送信）`);

  const form = buildAnalyzeFormData({
    images: prepared,
    roster,
    matchMeta,
    apiKey,
    pageHint,
  });

  let res: Response;
  try {
    const controller = new AbortController();
    const timeoutMs = 280_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      res = await fetch("/api/analyze-score", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (fetchErr) {
    const detail =
      fetchErr instanceof Error
        ? `${fetchErr.name}: ${fetchErr.message}`
        : String(fetchErr);
    throw new Error(
      `${label}の通信エラー（${detail}）。サーバーが応答前に切断された可能性があります。画像を小さくして再試行してください。`,
    );
  }

  const rawText = await res.text();
  let json: AnalyzeJson;
  try {
    json = rawText ? (JSON.parse(rawText) as AnalyzeJson) : {};
  } catch {
    throw new Error(
      `${label}: サーバー応答の解析に失敗 (HTTP ${res.status}). ${rawText.slice(0, 200)}`,
    );
  }
  if (!res.ok) {
    const extra = json.detail ? ` / ${json.detail}` : "";
    throw new Error(
      (json.error || `${label}の解析に失敗 (HTTP ${res.status})`) + extra,
    );
  }
  return json;
}
