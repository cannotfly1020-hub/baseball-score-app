import {
  ANALYZE_MAX_PAYLOAD_BYTES,
  ANALYZE_TARGET_PAYLOAD_BYTES,
} from "@/lib/constants";
import {
  buildAnalyzeJsonBody,
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
  ok?: boolean;
};

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)}KB`;
}

/** 送信直前の軽量ヘルスチェック（サーバー生存確認） */
async function pingAnalyzeHealth(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch("/api/analyze-score", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`ヘルスチェック失敗 (HTTP ${res.status})`);
    }
    const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    if (!json?.ok) {
      throw new Error("ヘルスチェック応答が不正です");
    }
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    throw new Error(
      `解析サーバーに接続できません（${detail}）。開発サーバーが起動しているか確認してください。`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** 1ページ分を application/json（Base64）で直列送信して解析結果を返す */
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
  if (prepared.approxBytes > ANALYZE_MAX_PAYLOAD_BYTES) {
    throw new Error(
      `${label}の画像が大きすぎます（画像合計 ${formatKb(prepared.approxBytes)} / 上限 ${formatKb(ANALYZE_MAX_PAYLOAD_BYTES)}）。別の写真で撮り直してください。`,
    );
  }

  const body = buildAnalyzeJsonBody({
    images: prepared,
    roster,
    matchMeta,
    apiKey,
    pageHint,
  });
  const jsonBytes = new TextEncoder().encode(JSON.stringify(body)).length;
  body.imageMeta.jsonBytes = jsonBytes;

  onStatus?.(
    `${label}を Gemini で解析中…（JSON ${formatKb(jsonBytes)}・画像 ${formatKb(prepared.approxBytes)}・直列送信）`,
  );

  await pingAnalyzeHealth();

  let res: Response;
  try {
    const controller = new AbortController();
    const timeoutMs = 280_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      res = await fetch("/api/analyze-score", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
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
      `${label}の通信エラー（${detail}）。送信JSON ${formatKb(jsonBytes)}（画像 ${formatKb(prepared.approxBytes)}）。サーバーが応答前に切断された可能性があります。`,
    );
  }

  const rawText = await res.text();
  let json: AnalyzeJson;
  try {
    json = rawText ? (JSON.parse(rawText) as AnalyzeJson) : {};
  } catch {
    throw new Error(
      `${label}: サーバー応答の解析に失敗 (HTTP ${res.status}, 送信JSON ${formatKb(jsonBytes)}). ${rawText.slice(0, 200)}`,
    );
  }
  if (!res.ok) {
    const extra = json.detail ? ` / ${json.detail}` : "";
    throw new Error(
      (json.error || `${label}の解析に失敗 (HTTP ${res.status})`) +
        ` [送信JSON ${formatKb(jsonBytes)}]` +
        extra,
    );
  }
  return json;
}
