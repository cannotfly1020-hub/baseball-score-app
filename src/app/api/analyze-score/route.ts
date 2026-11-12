import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODEL_CANDIDATES,
  emptyInnings,
  normalizeResult,
} from "@/lib/constants";
import { buildDetailsPrompt, buildRosterPrompt } from "@/lib/prompts";
import { normalizePlayerRecord } from "@/lib/stats";
import type { AnalyzeRequestBody, PlayerAtBat, RosterPlayer } from "@/lib/types";

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
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { players?: unknown }).players)) {
      return (parsed as { players: unknown[] }).players;
    }
  } catch {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    }
  }
  throw new Error("AI応答のJSON解析に失敗しました。もう一度お試しください。");
}

function isModelUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /NOT_FOUND|not found|is not found|unsupported|does not exist|model.*unavailable|invalid model/i.test(
    msg,
  );
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

async function generateJson(
  ai: GoogleGenAI,
  model: string,
  prompt: string,
  colorBase64: string,
  redBase64: string,
  mimeType: string,
): Promise<{ text: string; parsed: unknown[] }> {
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            text:
              "【画像A：カラー原本（鮮鋭化・コントラスト補正済み）】枠線・マス位置・黒ボールペン／鉛筆の文字記号の把握用。赤ペン判定は次の画像Bと必ず併用すること。",
          },
          {
            inlineData: {
              mimeType,
              data: colorBase64,
            },
          },
          {
            text:
              "【画像B：赤ペン強調フィルター画像】黒枠線・選手名は残したまま、明るい赤および黒い菱形線上の暗い赤茶色までクリムゾンレッドに強調した解析用。早稲田式では菱形の辺を赤でなぞって安打を表すため、黒線の上に乗った赤強調を最優先で数え、各マスを画像Aと照合すること。",
          },
          {
            inlineData: {
              mimeType,
              data: redBase64,
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const text = response.text ?? "";
  if (!text) throw new Error("AIから空の応答が返りました");
  return { text, parsed: parseJsonArray(text) };
}

async function generateJsonWithFallback(
  ai: GoogleGenAI,
  prompt: string,
  colorBase64: string,
  redBase64: string,
  mimeType: string,
  preferredModel?: string,
): Promise<{ text: string; parsed: unknown[]; model: string }> {
  const candidates = [
    preferredModel,
    ...GEMINI_MODEL_CANDIDATES,
    DEFAULT_GEMINI_MODEL,
  ].filter((m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i);

  let lastError: unknown;
  for (const model of candidates) {
    try {
      const result = await generateJson(ai, model, prompt, colorBase64, redBase64, mimeType);
      return { ...result, model };
    } catch (err) {
      lastError = err;
      console.warn(`[analyze-score] model failed: ${model}`, err);
      if (isModelUnavailableError(err)) continue;
      throw new Error(formatGeminiError(err, model));
    }
  }
  throw new Error(formatGeminiError(lastError, candidates.join(" → ")));
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
      return NextResponse.json({ error: "画像が不足しています。先にスコアブック写真を選択してください。" }, { status: 400 });
    }

    // ざっくり容量チェック（2枚合計の base64 文字数）
    const totalChars = colorImageBase64.length + redImageBase64.length;
    if (totalChars > 12_000_000) {
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

    // Step 1: 左端名簿抽出
    const step1 = await generateJsonWithFallback(
      ai,
      buildRosterPrompt(roster),
      colorImageBase64,
      redImageBase64,
      mimeType,
    );

    const rosterExtracted = step1.parsed.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        batting_order: Number(r.batting_order) || 0,
        uniform_number: String(r.uniform_number ?? ""),
        player_name: String(r.player_name ?? ""),
        is_substitute: Boolean(r.is_substitute),
      };
    });

    // Step 2: 打席結果・打点・盗塁（Step1で成功したモデルを優先）
    const step2 = await generateJsonWithFallback(
      ai,
      buildDetailsPrompt(JSON.stringify(rosterExtracted, null, 2)),
      colorImageBase64,
      redImageBase64,
      mimeType,
      step1.model,
    );

    let match_date = body.matchMeta?.match_date || "";
    let opponent = body.matchMeta?.opponent || "";

    const players: PlayerAtBat[] = step2.parsed.map((row) => {
      const r = row as Record<string, unknown>;
      if (!match_date && r.match_date && String(r.match_date) !== "-") {
        match_date = String(r.match_date);
      }
      if (!opponent && r.opponent && String(r.opponent) !== "-") {
        opponent = String(r.opponent);
      }
      const inningsRaw = (r.innings || {}) as Record<string, unknown>;
      return normalizePlayerRecord({
        batting_order: Number(r.batting_order) || 0,
        uniform_number: String(r.uniform_number ?? ""),
        player_name: String(r.player_name ?? ""),
        is_substitute: Boolean(r.is_substitute),
        rbi: Number(r.rbi) || 0,
        stolen_bases: Number(r.stolen_bases) || 0,
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
        highlight: String(r.highlight ?? ""),
      });
    });

    // Step2が空なら名簿だけでも返す
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

    return NextResponse.json({
      players,
      match_date,
      opponent,
      model: step2.model,
      raw: { step1: step1.parsed, step2: step2.parsed },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "解析に失敗しました";
    console.error("[analyze-score]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
