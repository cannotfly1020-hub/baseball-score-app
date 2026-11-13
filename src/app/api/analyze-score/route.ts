import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { BATTING_ROW_COUNT, emptyInnings, normalizeResult } from "@/lib/constants";
import {
  isModelUnavailableError,
  resolveGeminiModelCandidates,
} from "@/lib/gemini-models";
import { buildRosterPrompt, buildRowDetailsPrompt } from "@/lib/prompts";
import { applyRosterMatching } from "@/lib/roster-match";
import { makeOverviewThumb, sliceBattingRows } from "@/lib/row-slice";
import { normalizePlayerRecord } from "@/lib/stats";
import type { AnalyzeRequestBody, PlayerAtBat, RosterPlayer } from "@/lib/types";

type ContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

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
      const obj = parsed as { players?: unknown[]; player?: unknown };
      if (Array.isArray(obj.players)) return obj.players;
      if (obj.player) return [obj.player];
      // 単一オブジェクト
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
    /** リクエスト内で models.list 結果を再利用 */
    candidateCache?: { list?: string[] };
  },
): Promise<{ text: string; parsed: unknown[]; model: string }> {
  const preferredModel = options?.preferredModel;
  const cache = options?.candidateCache;
  let candidates = cache?.list;
  if (!candidates || candidates.length === 0) {
    candidates = await resolveGeminiModelCandidates(ai, preferredModel);
    if (cache) cache.list = candidates;
    console.info("[analyze-score] model candidates:", candidates.slice(0, 12).join(" → "));
  } else if (preferredModel) {
    // 成功モデルを先頭に寄せる
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
      // 空応答は次モデルへ（thinking モデルの一時失敗など）
      if (/空の応答/i.test(err instanceof Error ? err.message : String(err))) continue;
      throw new Error(formatGeminiError(err, model));
    }
  }
  throw new Error(formatGeminiError(lastError, candidates.join(" → ")));
}

function mapToPlayerAtBat(row: Record<string, unknown>): PlayerAtBat {
  const inningsRaw = (row.innings || {}) as Record<string, unknown>;
  return normalizePlayerRecord({
    batting_order: Number(row.batting_order) || 0,
    uniform_number: String(row.uniform_number ?? ""),
    player_name: String(row.player_name ?? ""),
    is_substitute: Boolean(row.is_substitute),
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
    highlight: String(row.highlight ?? ""),
  });
}

/** 並列実行の簡易プール */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

export async function POST(request: Request) {
  try {
    let body: AnalyzeRequestBody;
    try {
      body = (await request.json()) as AnalyzeRequestBody;
    } catch {
      return NextResponse.json(
        {
          error:
            "リクエスト本文の読み取りに失敗しました。画像が大きすぎる可能性があります。写真を撮り直すか、設定から再試行してください。",
        },
        { status: 400 },
      );
    }

    const colorImageBase64 = body.colorImageBase64?.replace(/^data:image\/\w+;base64,/, "");
    const redImageBase64 = body.redImageBase64?.replace(/^data:image\/\w+;base64,/, "");
    if (!colorImageBase64 || !redImageBase64) {
      return NextResponse.json(
        { error: "画像が不足しています。先にスコアブック写真を選択してください。" },
        { status: 400 },
      );
    }

    const totalChars = colorImageBase64.length + redImageBase64.length;
    if (totalChars > 20_000_000) {
      return NextResponse.json(
        { error: "画像データが大きすぎます。別アングルで撮り直すか、解像度を下げてください。" },
        { status: 413 },
      );
    }

    const apiKey = (body.apiKey || process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "APIキーが設定されていません。画面右上の設定アイコンから Gemini API キーを入力するか、.env.local に GEMINI_API_KEY を設定してください。",
        },
        { status: 400 },
      );
    }

    const roster: RosterPlayer[] = Array.isArray(body.roster) ? body.roster : [];
    const mimeType = body.mimeType || "image/jpeg";
    const ai = new GoogleGenAI({ apiKey });
    const candidateCache: { list?: string[] } = {};

    // Step 1: 全体俯瞰で名簿抽出
    const step1 = await generateWithFallback(
      ai,
      [
        { text: buildRosterPrompt(roster) },
        {
          text: "【全体原本】左端の打順・背番号・選手名の抽出用（高解像度カラー原本）。",
        },
        { inlineData: { mimeType, data: colorImageBase64 } },
        {
          text: "【全体赤強調】位置合わせの参考。名簿抽出は原本を優先すること。",
        },
        { inlineData: { mimeType, data: redImageBase64 } },
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
      roster,
    );

    // 俯瞰サムネ＋打順行スライスを作成
    const [colorThumb, redThumb, colorRows, redRows] = await Promise.all([
      makeOverviewThumb(colorImageBase64, 1400),
      makeOverviewThumb(redImageBase64, 1400),
      sliceBattingRows(colorImageBase64, { rowCount: BATTING_ROW_COUNT }),
      sliceBattingRows(redImageBase64, { rowCount: BATTING_ROW_COUNT }),
    ]);

    // Step 2: 打順ごと（横1行）の拡大解析
    const rowResults = await mapPool(colorRows, 3, async (colorRow, index) => {
      const redRow = redRows[index];
      const battingOrder = colorRow.battingOrder;
      const hint = rosterExtracted.find(
        (p) => p.batting_order === battingOrder && !p.is_substitute,
      );
      const prompt = buildRowDetailsPrompt({
        battingOrder,
        roster,
        hintPlayerName: hint?.player_name,
        hintUniform: hint?.uniform_number,
      });

      const result = await generateWithFallback(
        ai,
        [
          { text: prompt },
          {
            text: "【俯瞰・全体原本（参考）】打順の位置関係確認用。細部は拡大行から読むこと。",
          },
          { inlineData: { mimeType: colorThumb.mimeType, data: colorThumb.base64 } },
          {
            text: "【俯瞰・全体赤強調（参考）】赤ペンの大まかな位置確認用。",
          },
          { inlineData: { mimeType: redThumb.mimeType, data: redThumb.base64 } },
          {
            text: `【拡大行・原本】打順${battingOrder}番の横帯を拡大。左端の選手名と黒ボールペンの小さな文字・数字（1-3、5-3、4F、K、B、WP、E、FC 等）を精密に読むこと。`,
          },
          { inlineData: { mimeType: colorRow.mimeType, data: colorRow.base64 } },
          {
            text: `【拡大行・赤強調】同じ打順${battingOrder}番の赤ペン安打線・得点●・進塁を精密に読むこと。菱形辺の重ね書きを最優先。`,
          },
          { inlineData: { mimeType: redRow.mimeType, data: redRow.base64 } },
        ],
        { preferredModel: step1.model, candidateCache },
      );

      const players = applyRosterMatching(
        result.parsed.map((row) => {
          const r = row as Record<string, unknown>;
          const mapped = mapToPlayerAtBat({ ...r, batting_order: battingOrder });
          return mapped;
        }),
        roster,
      );

      return { battingOrder, players, raw: result.parsed, model: result.model };
    });

    let match_date = body.matchMeta?.match_date || "";
    let opponent = body.matchMeta?.opponent || "";
    const players: PlayerAtBat[] = [];

    for (const row of rowResults) {
      for (const p of row.players) {
        players.push(p);
      }
      for (const raw of row.raw) {
        const r = raw as Record<string, unknown>;
        if (!match_date && r.match_date && String(r.match_date) !== "-") {
          match_date = String(r.match_date);
        }
        if (!opponent && r.opponent && String(r.opponent) !== "-") {
          opponent = String(r.opponent);
        }
      }
    }

    // 行解析が空なら名簿だけでも返す
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

    // 打順順に安定ソート
    players.sort((a, b) => {
      if (a.batting_order !== b.batting_order) return a.batting_order - b.batting_order;
      return Number(a.is_substitute) - Number(b.is_substitute);
    });

    const usedModel = rowResults[0]?.model || step1.model;

    return NextResponse.json({
      players,
      match_date,
      opponent,
      model: usedModel,
      raw: {
        step1: step1.parsed,
        rows: rowResults.map((r) => ({ battingOrder: r.battingOrder, raw: r.raw })),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "解析に失敗しました";
    console.error("[analyze-score]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
