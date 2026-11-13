import type { GoogleGenAI } from "@google/genai";
import { DEFAULT_GEMINI_MODEL, GEMINI_MODEL_CANDIDATES } from "./constants";

/** 画像生成・TTS・埋め込みなど、スコア解析に使わない系統 */
const EXCLUDE_RE =
  /image|tts|embed|nano-banana|omni|robotics|lyria|imagen|aqa|gemma|audio|live|veo|preview-tts/i;

function normalizeModelId(name: string): string {
  return String(name || "")
    .trim()
    .replace(/^models\//, "");
}

function isUsableGeminiId(id: string): boolean {
  if (!id || !/^gemini/i.test(id)) return false;
  if (EXCLUDE_RE.test(id)) return false;
  // 新規キーでは 2.5 系は generate で 404 になる（list には残る）
  if (/^gemini-2\./i.test(id)) return false;
  return /pro|flash|argon|carbon|hydrogen/i.test(id);
}

/** argon/carbon など版番号なし ID もスコア化 */
function modelFamilyBonus(id: string): number {
  const n = id.toLowerCase();
  if (/argon/.test(n)) return 480;
  if (/carbon/.test(n)) return 470;
  if (/hydrogen/.test(n)) return 460;
  return 0;
}

/** pro/argon > flash > flash-lite。同ティアは版番号の新しい順 */
export function modelPreferenceScore(id: string): number {
  const n = normalizeModelId(id).toLowerCase();
  let tier = 0;
  if (/flash-lite/.test(n)) tier = 100;
  else if (/flash/.test(n)) tier = 200;
  else if (/pro|argon|carbon|hydrogen/.test(n)) tier = 300;
  else tier = 50;

  const ver = n.match(/gemini-(\d+(?:\.\d+)*)/);
  const versionScore = ver ? Math.round(parseFloat(ver[1]) * 100) : 0;
  const family = modelFamilyBonus(n);

  if (/latest/.test(n)) return tier + 250 + versionScore + family;
  return tier + versionScore + family;
}

/**
 * Google Gemini API の models.list から generateContent 可能な
 * gemini pro/flash 系モデル ID を取得する。
 */
export async function listAvailableGeminiModels(ai: GoogleGenAI): Promise<string[]> {
  const pager = await ai.models.list({
    config: { pageSize: 100, queryBase: true },
  });
  const ids: string[] = [];
  for await (const model of pager) {
    const id = normalizeModelId(model.name || "");
    const actions = model.supportedActions || [];
    if (!isUsableGeminiId(id)) continue;
    if (actions.length > 0 && !actions.some((a) => /generateContent/i.test(a))) continue;
    ids.push(id);
  }
  return ids;
}

/**
 * 静的優先リスト + 実行時検出モデルをマージした候補列。
 * 先頭から順に試し、404/廃止時は次へフォールバックする想定。
 */
export async function resolveGeminiModelCandidates(
  ai: GoogleGenAI,
  preferredModel?: string,
): Promise<string[]> {
  const staticPreferred = [
    preferredModel,
    ...GEMINI_MODEL_CANDIDATES,
    DEFAULT_GEMINI_MODEL,
  ].filter((m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i);

  let discovered: string[] = [];
  try {
    discovered = await listAvailableGeminiModels(ai);
  } catch (err) {
    console.warn("[gemini-models] models.list failed; using static candidates only", err);
  }

  const discoveredSet = new Set(discovered.map((m) => m.toLowerCase()));
  const result: string[] = [];
  const seen = new Set<string>();

  const push = (id: string) => {
    const key = id.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(id);
  };

  // 1) 静的リストのうち models.list で確認できたものを優先（相対順は維持）
  //    → 存在しない 3.5-pro 等で無駄な 404 を踏まずに 3.5-flash へ到達できる
  if (discoveredSet.size > 0) {
    for (const m of staticPreferred) {
      if (discoveredSet.has(m.toLowerCase())) push(m);
    }
  }
  // 2) 未確認の静的候補も試す（list 漏れ・エイリアス用）
  for (const m of staticPreferred) push(m);

  // 3) list で見つかった残りを嗜好スコア順で追加
  //    （旧 2.5 系は list に残っていても generate で 404 になり得る → 呼び出し側でスキップ）
  const extras = discovered
    .filter((m) => !seen.has(m.toLowerCase()))
    .sort((a, b) => modelPreferenceScore(b) - modelPreferenceScore(a));
  for (const m of extras) push(m);

  return result.length > 0 ? result : [...staticPreferred];
}

export function isModelUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /NOT_FOUND|not found|is not found|unsupported|does not exist|model.*unavailable|invalid model|no longer available|not available to new users|is not supported for generate/i.test(
    msg,
  );
}
