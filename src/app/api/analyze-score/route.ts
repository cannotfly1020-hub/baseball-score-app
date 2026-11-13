import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { NextResponse } from "next/server";
import {
  attachAnalyzeJobPromise,
  createAnalyzeJob,
  getAnalyzeJob,
  updateAnalyzeJob,
} from "@/lib/analyze-jobs";
import {
  ANALYZE_MAX_PAYLOAD_BYTES,
  BATTING_GROUP_SPLITS,
  emptyInnings,
  normalizeResult,
} from "@/lib/constants";
import {
  isModelUnavailableError,
  resolveGeminiModelCandidates,
} from "@/lib/gemini-models";
import { buildGroupDetailsPrompt, buildRosterPrompt } from "@/lib/prompts";
import { applyRosterMatching } from "@/lib/roster-match";
import {
  extractAiInningScores,
  extractPlayersFromAiPayload,
  finalizePlayersAfterAi,
  parseAiCellMeta,
  reconcileInningScores,
} from "@/lib/score-reconcile";
import { normalizePlayerRecord } from "@/lib/stats";
import type { PlayerAtBat, RosterPlayer } from "@/lib/types";

/** 長時間 Gemini 中継用。画像加工は一切せず Base64 化して転送するだけ。 */
export const maxDuration = 300;

/** Process-level safety: never let unhandled rejections silently kill the socket. */
declare global {
  // eslint-disable-next-line no-var
  var __analyzeScoreHandlersInstalled: boolean | undefined;
}
if (typeof globalThis !== "undefined" && !globalThis.__analyzeScoreHandlersInstalled) {
  globalThis.__analyzeScoreHandlersInstalled = true;
  process.on("uncaughtException", (err) => {
    console.error("[analyze-score] uncaughtException", err);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[analyze-score] unhandledRejection", reason);
  });
}

type ContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

/** 受信画像はすべて Base64 文字列のみ保持（巨大 Buffer 複製を避ける） */
type ParsedRequest = {
  colorB64: string;
  redB64: string;
  colorTopB64: string;
  colorBottomB64: string;
  redTopB64: string;
  redBottomB64: string;
  totalBytes: number;
  roster: RosterPlayer[];
  matchMeta: {
    match_date?: string;
    opponent?: string;
    pageHint?: "single" | "first_half" | "second_half";
  };
  apiKey: string;
  dryRun: boolean;
};

function summarizeError(err: unknown): { message: string; detail: string } {
  const message = err instanceof Error ? err.message : String(err);
  const stack =
    err instanceof Error
      ? (err.stack || "")
          .split("\n")
          .slice(0, 6)
          .map((l) => l.trim())
          .join(" | ")
      : "";
  return { message, detail: stack || message };
}

function jsonError(status: number, message: string, detail?: string) {
  return NextResponse.json(
    {
      error: message,
      detail: detail || undefined,
      ok: false,
    },
    { status },
  );
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

function parseJsonArray(text: string): unknown[] {
  const cleaned = stripCodeFence(text);
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as {
        players?: unknown[];
        player?: unknown;
        inning_scores?: unknown;
      };
      if (Array.isArray(obj.players) || obj.inning_scores) return [parsed];
      if (obj.player) return [obj.player];
      if ("batting_order" in (parsed as object) || "player_name" in (parsed as object)) {
        return [parsed];
      }
    }
  } catch {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    }
    const oStart = cleaned.indexOf("{");
    const oEnd = cleaned.lastIndexOf("}");
    if (oStart >= 0 && oEnd > oStart) {
      return [JSON.parse(cleaned.slice(oStart, oEnd + 1))];
    }
  }
  throw new Error("AI応答のJSON解析に失敗しました。もう一度お試しください。");
}

function formatGeminiError(err: unknown, model?: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const modelHint = model ? `（モデル: ${model}）` : "";

  if (/API[_ ]?KEY|api key|PERMISSION_DENIED|UNAUTHENTICATED|401|403|invalid.*key/i.test(raw)) {
    return `APIキーが無効か権限がありません${modelHint}: ${raw}`;
  }
  if (isModelUnavailableError(err)) {
    return `モデルエラー: ${raw}${modelHint}`;
  }
  if (/RESOURCE_EXHAUSTED|429|quota|rate limit/i.test(raw)) {
    return `API利用上限に達しました。しばらく待ってから再試行してください${modelHint}`;
  }
  if (/payload|too large|Request Entity Too Large|413/i.test(raw)) {
    return `画像データが大きすぎます。別の写真で再試行してください${modelHint}`;
  }
  if (/timeout|DEADLINE|ETIMEDOUT/i.test(raw)) {
    return `AI解析がタイムアウトしました。通信環境を確認して再試行してください${modelHint}`;
  }
  return `Google AI エラー: ${raw}${modelHint}`;
}

function stripDataUrl(input?: string): string {
  return (input || "").replace(/^data:image\/\w+;base64,/, "");
}

function b64ByteLength(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}

/**
 * application/json のみ受付（FormData は Next.js 開発プロキシで切断されるため廃止）。
 * メモリ上で Base64 を保持するだけで、一時ファイルやディスク書き込みは行わない。
 */
async function parseIncomingRequest(request: Request): Promise<ParsedRequest> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    throw Object.assign(
      new Error(
        "multipart/form-data は非対応です。application/json（Base64）で送信してください。",
      ),
      { status: 415 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw Object.assign(
      new Error("JSON ボディの解析に失敗しました。Content-Type: application/json で再送してください。"),
      { status: 400 },
    );
  }

  const toB64 = (v: unknown) => {
    const s = stripDataUrl(typeof v === "string" ? v : "");
    return s || null;
  };
  const colorB64 = toB64(body.colorImageBase64);
  const redB64 = toB64(body.redImageBase64);
  const colorTopB64 = toB64(body.colorTopImageBase64) || colorB64;
  const colorBottomB64 = toB64(body.colorBottomImageBase64) || colorB64;
  const redTopB64 = toB64(body.redTopImageBase64) || redB64;
  const redBottomB64 = toB64(body.redBottomImageBase64) || redB64;
  if (!colorB64 || !redB64 || !colorTopB64 || !colorBottomB64 || !redTopB64 || !redBottomB64) {
    throw Object.assign(new Error("画像が不足しています。先にスコアブック写真を選択してください。"), {
      status: 400,
    });
  }
  const totalBytes =
    b64ByteLength(colorB64) +
    b64ByteLength(redB64) +
    b64ByteLength(colorTopB64) +
    b64ByteLength(colorBottomB64) +
    b64ByteLength(redTopB64) +
    b64ByteLength(redBottomB64);

  return {
    colorB64,
    redB64,
    colorTopB64,
    colorBottomB64,
    redTopB64,
    redBottomB64,
    totalBytes,
    roster: Array.isArray(body.roster) ? (body.roster as RosterPlayer[]) : [],
    matchMeta: (body.matchMeta as ParsedRequest["matchMeta"]) || {},
    apiKey: String(body.apiKey || process.env.GEMINI_API_KEY || "").trim(),
    dryRun: Boolean(body.dryRun),
  };
}

/**
 * GET /api/analyze-score — health
 * GET /api/analyze-score?jobId=… — poll async Gemini job
 */
export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (jobId) {
    const job = getAnalyzeJob(jobId);
    if (!job) {
      return jsonError(404, `job が見つかりません: ${jobId}`);
    }
    if (job.status === "done" && job.result) {
      return NextResponse.json({
        ...job.result,
        jobId: job.id,
        jobStatus: job.status,
      });
    }
    if (job.status === "error") {
      return NextResponse.json(
        {
          ok: false,
          jobId: job.id,
          jobStatus: job.status,
          error: job.error || "解析に失敗しました",
          detail: job.detail,
          stage: job.stage,
        },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      accepted: true,
      jobId: job.id,
      jobStatus: job.status,
      stage: job.stage || "running",
      elapsedMs: Date.now() - job.createdAt,
    });
  }

  return NextResponse.json({
    ok: true,
    service: "analyze-score",
    accepts: "application/json",
    mode: "async-job+poll",
    maxPayloadBytes: ANALYZE_MAX_PAYLOAD_BYTES,
  });
}

/**
 * 高速 Flash を最優先。argon/carbon/pro 等の重いモデルはフォールバック専用。
 * （route 内でのみ並べ替え — UI/定数/プロンプトは変更しない）
 */
const FLASH_FIRST_ORDER = [
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
] as const;

function isFlashModel(id: string): boolean {
  return /flash/i.test(id);
}

function isHeavyProModel(id: string): boolean {
  // Pro 系および argon/carbon/hydrogen（実測で長考しがち）
  return /(?:^|[.-])(pro|argon|carbon|hydrogen)(?:$|[.-])/i.test(id) && !isFlashModel(id);
}

function preferFlashModels(candidates: string[], stickyPreferred?: string): string[] {
  const flash: string[] = [];
  const mid: string[] = [];
  const heavy: string[] = [];
  for (const id of candidates) {
    if (isFlashModel(id)) flash.push(id);
    else if (isHeavyProModel(id)) heavy.push(id);
    else mid.push(id);
  }
  flash.sort((a, b) => {
    const ia = FLASH_FIRST_ORDER.findIndex((p) => p === a);
    const ib = FLASH_FIRST_ORDER.findIndex((p) => p === b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  // 解決済み候補のみ並べ替え（存在しない ID の 404 往復をしない）
  const ordered = [...flash, ...mid, ...heavy];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const id of ordered) {
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(id);
  }
  if (stickyPreferred && isFlashModel(stickyPreferred)) {
    return [stickyPreferred, ...deduped.filter((m) => m !== stickyPreferred)];
  }
  return deduped;
}

function isThinkingConfigError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /thinking[_ ]?(budget|level|config)|invalid.*thinking|only set only one of thinking/i.test(
    msg,
  );
}

async function generateJsonFromParts(
  ai: GoogleGenAI,
  model: string,
  parts: ContentPart[],
): Promise<{ text: string; parsed: unknown[]; elapsedMs: number }> {
  const t0 = Date.now();
  /** budget と level の同時指定は API 400。budget:1024 で長考を制限。 */
  const run = async (thinkingConfig: {
    includeThoughts: false;
    thinkingBudget?: number;
    thinkingLevel?: ThinkingLevel;
  } | null) =>
    ai.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 8192,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    });

  let response;
  try {
    // budget と level は同時指定不可。1024 で長考をカット。
    response = await run({ includeThoughts: false, thinkingBudget: 1024 });
  } catch (err) {
    if (isThinkingConfigError(err)) {
      console.warn(
        `[analyze-score] thinkingBudget=1024 rejected on ${model}; retry thinkingLevel=LOW`,
        err instanceof Error ? err.message : err,
      );
      try {
        response = await run({
          includeThoughts: false,
          thinkingLevel: ThinkingLevel.LOW,
        });
      } catch (err2) {
        if (isThinkingConfigError(err2)) {
          console.warn(
            `[analyze-score] thinkingLevel rejected on ${model}; retry thinkingBudget=0 (off)`,
          );
          response = await run({ includeThoughts: false, thinkingBudget: 0 });
        } else {
          throw err2;
        }
      }
    } else {
      throw err;
    }
  }

  const elapsedMs = Date.now() - t0;
  const text = response.text ?? "";
  if (!text) throw new Error("AIから空の応答が返りました");
  console.info(
    `[analyze-score] generateContent model=${model} elapsedMs=${elapsedMs} chars=${text.length}`,
  );
  return { text, parsed: parseJsonArray(text), elapsedMs };
}

async function generateWithFallback(
  ai: GoogleGenAI,
  parts: ContentPart[],
  options?: {
    preferredModel?: string;
    candidateCache?: { list?: string[] };
  },
): Promise<{ text: string; parsed: unknown[]; model: string }> {
  const preferredModel = options?.preferredModel;
  const cache = options?.candidateCache;
  let candidates = cache?.list;
  if (!candidates || candidates.length === 0) {
    const resolved = await resolveGeminiModelCandidates(ai, preferredModel);
    candidates = preferFlashModels(resolved, preferredModel);
    if (cache) cache.list = candidates;
    console.info(
      "[analyze-score] model candidates (flash-first):",
      candidates.slice(0, 10).join(" → "),
    );
  } else if (preferredModel) {
    // 前ステップ成功モデルが Flash なら sticky、Pro/argon なら Flash 優先を維持
    candidates = preferFlashModels(
      [preferredModel, ...candidates.filter((m) => m !== preferredModel)],
      isFlashModel(preferredModel) ? preferredModel : undefined,
    );
  }

  let lastError: unknown;
  for (const model of candidates) {
    try {
      const result = await generateJsonFromParts(ai, model, parts);
      return { ...result, model };
    } catch (err) {
      lastError = err;
      console.warn(`[analyze-score] model failed: ${model}`, err);
      if (isModelUnavailableError(err)) continue;
      if (/空の応答/i.test(err instanceof Error ? err.message : String(err))) continue;
      throw new Error(formatGeminiError(err, model));
    }
  }
  throw new Error(formatGeminiError(lastError, candidates.join(" → ")));
}

function mapToPlayerAtBat(row: Record<string, unknown>): PlayerAtBat {
  const inningsRaw = (row.innings || {}) as Record<string, unknown>;
  const cellMeta = parseAiCellMeta(row);
  const mapped = normalizePlayerRecord({
    batting_order: Number(row.batting_order) || 0,
    uniform_number: String(row.uniform_number ?? ""),
    player_name: String(row.player_name ?? ""),
    is_substitute: Boolean(row.is_substitute),
    position: String(row.position ?? "").trim() || undefined,
    rbi: Number(row.rbi) || 0,
    stolen_bases: Number(row.stolen_bases) || 0,
    innings: {
      ...emptyInnings(),
      "1": normalizeResult(inningsRaw["1"]),
      "2": normalizeResult(inningsRaw["2"]),
      "3": normalizeResult(inningsRaw["3"]),
      "4": normalizeResult(inningsRaw["4"]),
      "5": normalizeResult(inningsRaw["5"]),
      "6": normalizeResult(inningsRaw["6"]),
      "7": normalizeResult(inningsRaw["7"]),
    },
    cellMeta,
    highlight: String(row.highlight ?? ""),
  });
  return finalizePlayersAfterAi([mapped])[0];
}

async function runAnalyzePipeline(
  parsed: ParsedRequest,
  onStage?: (stage: string) => void,
): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const mimeType = "image/jpeg";
  const ai = new GoogleGenAI({ apiKey: parsed.apiKey });
  const candidateCache: { list?: string[] } = {};

  onStage?.("roster");
  console.info(
    `[analyze-score] pipeline start bytes=${parsed.totalBytes} t=0ms`,
  );

  const step1 = await generateWithFallback(
    ai,
    [
      { text: buildRosterPrompt(parsed.roster) },
      { text: "【全体・高コントラスト原本】左端の打順・背番号・選手名の抽出用。" },
      { inlineData: { mimeType, data: parsed.colorB64 } },
      { text: "【全体・赤強調】位置合わせ参考。名簿は原本優先。" },
      { inlineData: { mimeType, data: parsed.redB64 } },
    ],
    { candidateCache },
  );
  console.info(`[analyze-score] step1 done model=${step1.model} t=${Date.now() - t0}ms`);

  const rosterExtracted = applyRosterMatching(
    step1.parsed.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        batting_order: Number(r.batting_order) || 0,
        uniform_number: String(r.uniform_number ?? ""),
        player_name: String(r.player_name ?? ""),
        is_substitute: Boolean(r.is_substitute),
      };
    }),
    parsed.roster,
  );

  // 上下グループはサーバー内で並列（HTTP ソケットはジョブ受理後に解放済み）
  onStage?.("upper+lower");
  const groupResults = await Promise.all(
    BATTING_GROUP_SPLITS.map(async (group) => {
      const colorHalf = group.id === "upper" ? parsed.colorTopB64 : parsed.colorBottomB64;
      const redHalf = group.id === "upper" ? parsed.redTopB64 : parsed.redBottomB64;
      const prompt = buildGroupDetailsPrompt({
        fromOrder: group.from,
        toOrder: group.to,
        roster: parsed.roster,
        rosterHints: rosterExtracted,
        pageHint: parsed.matchMeta.pageHint || "single",
      });

      const result = await generateWithFallback(
        ai,
        [
          { text: prompt },
          {
            text: `【${group.label}・高コントラスト原本】黒文字（1-3,5-3,4F,K,B,WP,E 等）と左端選手名を精密に読むこと。`,
          },
          { inlineData: { mimeType, data: colorHalf } },
          {
            text: `【${group.label}・赤強調】菱形上の赤ペン安打線・得点●・進塁を精密に読むこと。`,
          },
          { inlineData: { mimeType, data: redHalf } },
        ],
        { preferredModel: step1.model, candidateCache },
      );
      console.info(
        `[analyze-score] group ${group.id} done model=${result.model} t=${Date.now() - t0}ms`,
      );

      const playerRows = extractPlayersFromAiPayload(result.parsed);
      const players = applyRosterMatching(
        playerRows
          .map((row) => mapToPlayerAtBat(row as Record<string, unknown>))
          .filter((p) => p.batting_order >= group.from && p.batting_order <= group.to),
        parsed.roster,
      );
      return {
        group: group.id,
        players,
        raw: result.parsed,
        model: result.model,
        aiInningScores: extractAiInningScores(result.parsed),
      };
    }),
  );

  onStage?.("finalize");
  let match_date = parsed.matchMeta.match_date || "";
  let opponent = parsed.matchMeta.opponent || "";
  let players: PlayerAtBat[] = [];
  const aiScoreParts: number[][] = [];

  for (const g of groupResults) {
    for (const p of g.players) players.push(p);
    if (g.aiInningScores) aiScoreParts.push(g.aiInningScores);
    for (const raw of g.raw) {
      const r = raw as Record<string, unknown>;
      if (!match_date && r.match_date && String(r.match_date) !== "-") {
        match_date = String(r.match_date);
      }
      if (!opponent && r.opponent && String(r.opponent) !== "-") {
        opponent = String(r.opponent);
      }
    }
  }

  if (players.length === 0 && rosterExtracted.length > 0) {
    for (const r of rosterExtracted) {
      players.push(
        normalizePlayerRecord({
          ...r,
          rbi: 0,
          stolen_bases: 0,
          innings: emptyInnings(),
          highlight: "",
        }),
      );
    }
  }

  players = finalizePlayersAfterAi(players);
  players.sort((a, b) => {
    if (a.batting_order !== b.batting_order) return a.batting_order - b.batting_order;
    return Number(a.is_substitute) - Number(b.is_substitute);
  });

  const mergedAiScores =
    aiScoreParts.length > 0
      ? [0, 1, 2, 3, 4, 5, 6].map((i) =>
          Math.max(...aiScoreParts.map((part) => part[i] || 0), 0),
        )
      : null;
  const reconciled = reconcileInningScores(players, mergedAiScores);

  console.info(
    `[analyze-score] pipeline done players=${players.length} t=${Date.now() - t0}ms`,
  );

  return {
    ok: true,
    players,
    match_date,
    opponent,
    model: groupResults[0]?.model || step1.model,
    pipeline: "async-job+flash-first+parallel-groups",
    bytesReceived: parsed.totalBytes,
    elapsedMs: Date.now() - t0,
    inningScores: reconciled.ourInnings,
    inningScoresMatched: reconciled.matched,
    aiInningScores: reconciled.aiInningScores,
    raw: {
      step1: step1.parsed,
      groups: groupResults.map((g) => ({ group: g.group, raw: g.raw })),
    },
  };
}

export async function POST(request: Request) {
  const reqStarted = Date.now();
  try {
    let parsed: ParsedRequest;
    try {
      parsed = await parseIncomingRequest(request);
    } catch (err) {
      const { message, detail } = summarizeError(err);
      const status =
        typeof (err as { status?: number })?.status === "number"
          ? (err as { status: number }).status
          : 400;
      return jsonError(status, message, detail);
    }

    console.info(
      `[analyze-score] POST parsed bytes=${parsed.totalBytes} dryRun=${parsed.dryRun} parseMs=${Date.now() - reqStarted}`,
    );

    if (parsed.totalBytes > ANALYZE_MAX_PAYLOAD_BYTES) {
      return jsonError(
        413,
        `画像データが大きすぎます（合計 ${(parsed.totalBytes / 1024).toFixed(1)}KB）。上限 ${(ANALYZE_MAX_PAYLOAD_BYTES / 1024).toFixed(0)}KB 以内に圧縮して再送してください。`,
      );
    }

    if (parsed.dryRun) {
      console.info(
        `[analyze-score] dryRun ok bytes=${parsed.totalBytes} roster=${parsed.roster.length}`,
      );
      return NextResponse.json({
        ok: true,
        dryRun: true,
        players: [],
        match_date: parsed.matchMeta.match_date || "",
        opponent: parsed.matchMeta.opponent || "",
        model: "dry-run",
        pipeline: "relay-base64-only",
        bytesReceived: parsed.totalBytes,
        inningScores: [0, 0, 0, 0, 0, 0, 0],
        inningScoresMatched: true,
      });
    }

    if (!parsed.apiKey) {
      return jsonError(
        400,
        "APIキーが設定されていません。画面右上の設定アイコンから Gemini API キーを入力するか、.env.local に GEMINI_API_KEY を設定してください。",
      );
    }

    /**
     * Async accept: return jobId in milliseconds so the HTTP socket is not held
     * open for the full Gemini duration (~60s+), which caused TypeError: Failed
     * to fetch on port-forward / idle proxies while PID stayed alive.
     */
    const job = createAnalyzeJob();
    updateAnalyzeJob(job.id, { status: "running", stage: "starting" });

    const promise = (async () => {
      try {
        const result = await runAnalyzePipeline(parsed, (stage) => {
          updateAnalyzeJob(job.id, { status: "running", stage });
        });
        updateAnalyzeJob(job.id, { status: "done", stage: "done", result });
      } catch (err) {
        const { message, detail } = summarizeError(err);
        console.error(`[analyze-score] job ${job.id} failed`, err);
        updateAnalyzeJob(job.id, {
          status: "error",
          stage: "error",
          error: message,
          detail,
        });
      }
    })();
    attachAnalyzeJobPromise(job.id, promise);

    console.info(
      `[analyze-score] job accepted id=${job.id} bytes=${parsed.totalBytes} acceptMs=${Date.now() - reqStarted}`,
    );

    return NextResponse.json(
      {
        ok: true,
        accepted: true,
        jobId: job.id,
        jobStatus: "running",
        bytesReceived: parsed.totalBytes,
        acceptMs: Date.now() - reqStarted,
        pollUrl: `/api/analyze-score?jobId=${encodeURIComponent(job.id)}`,
      },
      { status: 202 },
    );
  } catch (err) {
    const { message, detail } = summarizeError(err);
    console.error("[analyze-score]", err);
    return jsonError(500, message, detail);
  }
}
