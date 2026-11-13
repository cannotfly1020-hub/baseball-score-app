import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import {
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

/** 長時間の多段 Gemini 呼び出し用（ローカル/ホスティング） */
export const maxDuration = 300;

type ContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

type ParsedRequest = {
  color: Buffer;
  red: Buffer;
  colorTop: Buffer;
  colorBottom: Buffer;
  redTop: Buffer;
  redBottom: Buffer;
  roster: RosterPlayer[];
  matchMeta: {
    match_date?: string;
    opponent?: string;
    pageHint?: "single" | "first_half" | "second_half";
  };
  apiKey: string;
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
      // グループ応答は { players, inning_scores } — オブジェクトごと返し後段で分解
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

async function fileToBuffer(file: File | null): Promise<Buffer | null> {
  if (!file) return null;
  const ab = await file.arrayBuffer();
  return Buffer.from(ab);
}

function stripDataUrl(input?: string): string {
  return (input || "").replace(/^data:image\/\w+;base64,/, "");
}

async function parseIncomingRequest(request: Request): Promise<ParsedRequest> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const color = await fileToBuffer(form.get("color") as File | null);
    const red = await fileToBuffer(form.get("red") as File | null);
    const colorTop = await fileToBuffer(form.get("colorTop") as File | null);
    const colorBottom = await fileToBuffer(form.get("colorBottom") as File | null);
    const redTop = await fileToBuffer(form.get("redTop") as File | null);
    const redBottom = await fileToBuffer(form.get("redBottom") as File | null);

    if (!color || !red || !colorTop || !colorBottom || !redTop || !redBottom) {
      throw Object.assign(new Error("FormData に必要な画像（color/red/上下分割）が不足しています。"), {
        status: 400,
      });
    }

    let roster: RosterPlayer[] = [];
    try {
      roster = JSON.parse(String(form.get("roster") || "[]"));
    } catch {
      roster = [];
    }
    let matchMeta: ParsedRequest["matchMeta"] = {};
    try {
      matchMeta = JSON.parse(String(form.get("matchMeta") || "{}"));
    } catch {
      matchMeta = {};
    }

    const apiKey = String(form.get("apiKey") || process.env.GEMINI_API_KEY || "").trim();
    return { color, red, colorTop, colorBottom, redTop, redBottom, roster, matchMeta, apiKey };
  }

  // 後方互換: JSON+Base64
  const body = (await request.json()) as Record<string, unknown>;
  const toBuf = (v: unknown) => {
    const s = stripDataUrl(typeof v === "string" ? v : "");
    return s ? Buffer.from(s, "base64") : null;
  };
  const color = toBuf(body.colorImageBase64);
  const red = toBuf(body.redImageBase64);
  const colorTop = toBuf(body.colorTopImageBase64) || color;
  const colorBottom = toBuf(body.colorBottomImageBase64) || color;
  const redTop = toBuf(body.redTopImageBase64) || red;
  const redBottom = toBuf(body.redBottomImageBase64) || red;
  if (!color || !red || !colorTop || !colorBottom || !redTop || !redBottom) {
    throw Object.assign(new Error("画像が不足しています。先にスコアブック写真を選択してください。"), {
      status: 400,
    });
  }
  return {
    color,
    red,
    colorTop,
    colorBottom,
    redTop,
    redBottom,
    roster: Array.isArray(body.roster) ? (body.roster as RosterPlayer[]) : [],
    matchMeta: (body.matchMeta as ParsedRequest["matchMeta"]) || {},
    apiKey: String(body.apiKey || process.env.GEMINI_API_KEY || "").trim(),
  };
}

async function generateJsonFromParts(
  ai: GoogleGenAI,
  model: string,
  parts: ContentPart[],
): Promise<{ text: string; parsed: unknown[] }> {
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const text = response.text ?? "";
  if (!text) throw new Error("AIから空の応答が返りました");
  return { text, parsed: parseJsonArray(text) };
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
    candidates = await resolveGeminiModelCandidates(ai, preferredModel);
    if (cache) cache.list = candidates;
    console.info("[analyze-score] model candidates:", candidates.slice(0, 10).join(" → "));
  } else if (preferredModel) {
    candidates = [preferredModel, ...candidates.filter((m) => m !== preferredModel)];
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

function bufToBase64(buf: Buffer): string {
  return buf.toString("base64");
}

export async function POST(request: Request) {
  try {
    let parsed: ParsedRequest;
    try {
      parsed = await parseIncomingRequest(request);
    } catch (err) {
      const { message, detail } = summarizeError(err);
      const status = typeof (err as { status?: number })?.status === "number"
        ? (err as { status: number }).status
        : 400;
      return jsonError(status, message, detail);
    }

    const totalBytes =
      parsed.color.length +
      parsed.red.length +
      parsed.colorTop.length +
      parsed.colorBottom.length +
      parsed.redTop.length +
      parsed.redBottom.length;

    if (totalBytes > 4 * 1024 * 1024) {
      return jsonError(
        413,
        `画像データが大きすぎます（合計 ${(totalBytes / (1024 * 1024)).toFixed(2)}MB）。1.5MB以内に圧縮して再送してください。`,
      );
    }

    if (!parsed.apiKey) {
      return jsonError(
        400,
        "APIキーが設定されていません。画面右上の設定アイコンから Gemini API キーを入力するか、.env.local に GEMINI_API_KEY を設定してください。",
      );
    }

    const mimeType = "image/jpeg";
    const ai = new GoogleGenAI({ apiKey: parsed.apiKey });
    const candidateCache: { list?: string[] } = {};
    const colorB64 = bufToBase64(parsed.color);
    const redB64 = bufToBase64(parsed.red);

    // Step 1: 名簿抽出（全体俯瞰のみ・軽量）
    const step1 = await generateWithFallback(
      ai,
      [
        { text: buildRosterPrompt(parsed.roster) },
        { text: "【全体・高コントラスト原本】左端の打順・背番号・選手名の抽出用。" },
        { inlineData: { mimeType, data: colorB64 } },
        { text: "【全体・赤強調】位置合わせ参考。名簿は原本優先。" },
        { inlineData: { mimeType, data: redB64 } },
      ],
      { candidateCache },
    );

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

    // Step 2: 上下2グループのみ（旧9行並列はタイムアウト＝Failed to fetch の主因）
    const groupImages = {
      upper: {
        color: bufToBase64(parsed.colorTop),
        red: bufToBase64(parsed.redTop),
      },
      lower: {
        color: bufToBase64(parsed.colorBottom),
        red: bufToBase64(parsed.redBottom),
      },
    } as const;

    const groupResults = await Promise.all(
      BATTING_GROUP_SPLITS.map(async (group) => {
        const imgs = groupImages[group.id as keyof typeof groupImages];
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
            { text: "【俯瞰・全体原本（参考）】打順位置の確認用。細部はグループ拡大から読むこと。" },
            { inlineData: { mimeType, data: colorB64 } },
            { text: "【俯瞰・全体赤強調（参考）】" },
            { inlineData: { mimeType, data: redB64 } },
            {
              text: `【${group.label}・高コントラスト原本】黒文字（1-3,5-3,4F,K,B,WP,E 等）と左端選手名を精密に読むこと。`,
            },
            { inlineData: { mimeType, data: imgs.color } },
            {
              text: `【${group.label}・赤強調】菱形上の赤ペン安打線・得点●・進塁を精密に読むこと。`,
            },
            { inlineData: { mimeType, data: imgs.red } },
          ],
          { preferredModel: step1.model, candidateCache },
        );

        const playerRows = extractPlayersFromAiPayload(result.parsed);
        const players = applyRosterMatching(
          playerRows
            .map((row) => mapToPlayerAtBat(row as Record<string, unknown>))
            .filter((p) => p.batting_order >= group.from && p.batting_order <= group.to),
          parsed.roster,
        );
        const aiInningScores = extractAiInningScores(result.parsed);

        return {
          group: group.id,
          players,
          raw: result.parsed,
          model: result.model,
          aiInningScores,
        };
      }),
    );

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

    // 上下グループの inning_scores は部分観測のため、最終的には個人 scored 集計を正とする
    const mergedAiScores =
      aiScoreParts.length > 0
        ? [0, 1, 2, 3, 4, 5, 6].map((i) =>
            Math.max(...aiScoreParts.map((part) => part[i] || 0), 0),
          )
        : null;
    const reconciled = reconcileInningScores(players, mergedAiScores);

    return NextResponse.json({
      ok: true,
      players,
      match_date,
      opponent,
      model: groupResults[0]?.model || step1.model,
      pipeline: "roster+upper/lower-groups",
      bytesReceived: totalBytes,
      inningScores: reconciled.ourInnings,
      inningScoresMatched: reconciled.matched,
      aiInningScores: reconciled.aiInningScores,
      raw: {
        step1: step1.parsed,
        groups: groupResults.map((g) => ({ group: g.group, raw: g.raw })),
      },
    });

  } catch (err) {
    const { message, detail } = summarizeError(err);
    console.error("[analyze-score]", err);
    // プロセスを落とさず必ず JSON を返す
    return jsonError(500, message, detail);
  }
}
