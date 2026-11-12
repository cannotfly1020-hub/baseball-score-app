import type { InningsMap, ResultLabel } from "./types";
import { RESULT_OPTIONS } from "./types";

export { RESULT_OPTIONS };

export const RESULT_OPTIONS_SET = new Set<string>(RESULT_OPTIONS);

export const RESULT_ALIASES: Record<string, ResultLabel> = {
  "1塁打": "単打",
  "１塁打": "単打",
  ヒット: "単打",
  安打: "単打",
  シングル: "単打",
  H: "単打",
  "1B": "単打",
  "2塁打": "二塁打",
  "２塁打": "二塁打",
  二塁: "二塁打",
  ツーベース: "二塁打",
  "2B": "二塁打",
  "3塁打": "三塁打",
  "３塁打": "三塁打",
  三塁: "三塁打",
  スリーベース: "三塁打",
  "3B": "三塁打",
  ホームラン: "本塁打",
  HR: "本塁打",
  本塁: "本塁打",
  フォアボール: "四球",
  BB: "四球",
  歩き: "四球",
  デッドボール: "死球",
  HBP: "死球",
  DB: "死球",
  空振り三振: "三振",
  見逃し三振: "三振",
  K: "三振",
  SO: "三振",
  アウト: "凡打",
  ゴロ: "凡打",
  フライ: "凡打",
  ライナー: "凡打",
  バント: "犠打",
  犠牲バント: "犠打",
  SH: "犠打",
  犠牲フライ: "犠飛",
  SF: "犠飛",
  エラー: "敵失",
  E: "敵失",
  FC: "野選",
  不明: "要確認",
  "？": "要確認",
  "?": "要確認",
  無: "なし",
  空白: "なし",
  "-": "なし",
  "—": "なし",
  "": "なし",
};

export const AT_BAT_RESULTS = new Set<ResultLabel>([
  "単打",
  "二塁打",
  "三塁打",
  "本塁打",
  "凡打",
  "三振",
  "敵失",
  "野選",
  "振り逃げ",
]);

export const HIT_RESULTS = new Set<ResultLabel>(["単打", "二塁打", "三塁打", "本塁打"]);

export const NON_PA_RESULTS = new Set<ResultLabel>(["なし", "要確認"]);

export const TOTAL_BASES_VALUE: Partial<Record<ResultLabel, number>> = {
  単打: 1,
  二塁打: 2,
  三塁打: 3,
  本塁打: 4,
};

export const INNING_KEYS = ["1", "2", "3", "4", "5", "6", "7"] as const;

/** 安定・高速寄りの候補。先頭から試し、モデル未対応時は次へフォールバック */
export const GEMINI_MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash-lite",
] as const;

export const DEFAULT_GEMINI_MODEL = GEMINI_MODEL_CANDIDATES[0];

/** Canvas 前処理時の長辺上限（iPhone高画質対策） */
export const IMAGE_MAX_SIDE = 1600;

/** JPEG 出力品質（0–1） */
export const IMAGE_JPEG_QUALITY = 0.82;

export const STORAGE_KEY = "baseball-scorebook-v1";

export const MATCH_TYPES = ["公式戦", "練習試合", "紅白戦"] as const;

export const CATEGORIES = ["低学年", "高学年", "混合", "その他"] as const;

export function emptyInnings(): InningsMap {
  return {
    "1": "なし",
    "2": "なし",
    "3": "なし",
    "4": "なし",
    "5": "なし",
    "6": "なし",
    "7": "なし",
  };
}

export function normalizeResult(label: unknown): ResultLabel {
  if (label == null) return "要確認";
  const text = String(label).trim();
  if (RESULT_OPTIONS_SET.has(text)) return text as ResultLabel;
  if (text in RESULT_ALIASES) return RESULT_ALIASES[text];
  const compact = text.replace(/[\s　]/g, "");
  if (RESULT_OPTIONS_SET.has(compact)) return compact as ResultLabel;
  if (compact in RESULT_ALIASES) return RESULT_ALIASES[compact];
  return "要確認";
}

export function createId(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}
