import {
  ANALYZE_MAX_PAYLOAD_BYTES,
  ANALYZE_TARGET_PAYLOAD_BYTES,
} from "@/lib/constants";
import type { AnalyzeUsageMeta } from "@/lib/analyze-meta";
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
  accepted?: boolean;
  jobId?: string;
  jobStatus?: string;
  stage?: string;
  elapsedMs?: number;
  meta?: AnalyzeUsageMeta;
};

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)}KB`;
}

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

async function pollAnalyzeJob(
  jobId: string,
  args: {
    label: string;
    jsonBytes: number;
    onStatus?: (message: string) => void;
    timeoutMs: number;
  },
): Promise<AnalyzeJson> {
  const { label, jsonBytes, onStatus, timeoutMs } = args;
  const started = Date.now();
  let delay = 800;

  while (Date.now() - started < timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(`/api/analyze-score?jobId=${encodeURIComponent(jobId)}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (fetchErr) {
      const detail =
        fetchErr instanceof Error
          ? `${fetchErr.name}: ${fetchErr.message}`
          : String(fetchErr);
      throw new Error(
        `${label}のジョブポーリング通信エラー（${detail}）。jobId=${jobId} 送信JSON ${formatKb(jsonBytes)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const rawText = await res.text();
    let json: AnalyzeJson;
    try {
      json = rawText ? (JSON.parse(rawText) as AnalyzeJson) : {};
    } catch {
      throw new Error(
        `${label}: ジョブ応答の解析に失敗 (HTTP ${res.status}, jobId=${jobId}). ${rawText.slice(0, 200)}`,
      );
    }

    if (json.jobStatus === "done" || (res.ok && Array.isArray(json.players))) {
      return json;
    }
    if (json.jobStatus === "error" || (!res.ok && json.error)) {
      const extra = json.detail ? ` / ${json.detail}` : "";
      throw new Error(
        (json.error || `${label}の解析に失敗`) +
          ` [jobId=${jobId} 送信JSON ${formatKb(jsonBytes)}]` +
          extra,
      );
    }

    const elapsed = Date.now() - started;
    onStatus?.(
      `${label} Gemini 解析中…（${json.stage || json.jobStatus || "running"}・${Math.round(elapsed / 1000)}s・JSON ${formatKb(jsonBytes)}）`,
    );
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay + 200, 2000);
  }

  throw new Error(
    `${label}の解析がタイムアウトしました（jobId=${jobId}・${Math.round(timeoutMs / 1000)}s・送信JSON ${formatKb(jsonBytes)}）`,
  );
}

/** 1ページ分を application/json（Base64）で受理→ジョブポーリングして解析結果を返す */
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
    `${label}を送信中…（JSON ${formatKb(jsonBytes)}・画像 ${formatKb(prepared.approxBytes)}）`,
  );

  await pingAnalyzeHealth();

  let res: Response;
  try {
    const controller = new AbortController();
    const timeoutMs = 60_000; // accept only — Gemini runs in background job
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

  // Legacy sync 200 with players (should not happen for non-dryRun anymore)
  if (res.ok && Array.isArray(json.players) && !json.accepted) {
    return json;
  }

  if ((res.status === 202 || res.ok) && json.jobId) {
    onStatus?.(`${label}を Gemini で解析中…（job ${json.jobId}）`);
    return pollAnalyzeJob(json.jobId, {
      label,
      jsonBytes,
      onStatus,
      timeoutMs: 280_000,
    });
  }

  if (!res.ok) {
    const extra = json.detail ? ` / ${json.detail}` : "";
    throw new Error(
      (json.error || `${label}の解析に失敗 (HTTP ${res.status})`) +
        ` [送信JSON ${formatKb(jsonBytes)}]` +
        extra,
    );
  }

  throw new Error(
    `${label}: 予期しない応答 (HTTP ${res.status}, 送信JSON ${formatKb(jsonBytes)})`,
  );
}
