import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { DEFAULT_GEMINI_MODEL, emptyInnings, normalizeResult } from "@/lib/constants";
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
  throw new Error("AI応答のJSON解析に失敗しました");
}

async function generateJson(
  ai: GoogleGenAI,
  prompt: string,
  colorBase64: string,
  redBase64: string,
  mimeType: string,
): Promise<{ text: string; parsed: unknown[] }> {
  const response = await ai.models.generateContent({
    model: DEFAULT_GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType,
              data: colorBase64,
            },
          },
          {
            text: "上記が鮮鋭化・コントラスト補正したカラー原本画像です。続いて赤色抽出フィルター画像です：",
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AnalyzeRequestBody;
    const colorImageBase64 = body.colorImageBase64?.replace(/^data:image\/\w+;base64,/, "");
    const redImageBase64 = body.redImageBase64?.replace(/^data:image\/\w+;base64,/, "");
    if (!colorImageBase64 || !redImageBase64) {
      return NextResponse.json({ error: "画像が不足しています" }, { status: 400 });
    }

    const apiKey = (body.apiKey || process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY が未設定です。環境変数または設定画面から入力してください。" },
        { status: 400 },
      );
    }

    const roster: RosterPlayer[] = Array.isArray(body.roster) ? body.roster : [];
    const mimeType = body.mimeType || "image/jpeg";
    const ai = new GoogleGenAI({ apiKey });

    // Step 1: 左端名簿抽出
    const step1 = await generateJson(
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

    // Step 2: 打席結果・打点・盗塁
    const step2 = await generateJson(
      ai,
      buildDetailsPrompt(JSON.stringify(rosterExtracted, null, 2)),
      colorImageBase64,
      redImageBase64,
      mimeType,
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
      raw: { step1: step1.parsed, step2: step2.parsed },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "解析に失敗しました";
    console.error("[analyze-score]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
