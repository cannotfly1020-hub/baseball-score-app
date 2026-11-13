import { INNING_KEYS } from "./constants";
import { estimateInningRunsFromPlayers, syncPlayerRbiFromCells } from "./stats";
import type {
  AtBatCellMeta,
  CellMetaMap,
  InningKey,
  PlayerAtBat,
  RunMarkKind,
} from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseRunMark(raw: unknown): RunMarkKind {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (s === "filled" || s === "●" || s === "black" || s === "solid") return "filled";
  if (s === "open" || s === "〇" || s === "○" || s === "white" || s === "hollow") return "open";
  return "";
}

function parseCellMetaEntry(raw: unknown): AtBatCellMeta {
  const obj = asRecord(raw) || {};
  const scored =
    Boolean(obj.scored) ||
    Boolean(obj.runs) ||
    Boolean(obj.run) ||
    obj.scored === 1 ||
    String(obj.scored).toLowerCase() === "true";
  const runMark = parseRunMark(obj.run_mark ?? obj.runMark ?? (scored ? "filled" : ""));
  const rbi = Math.max(0, Number(obj.rbi ?? obj.RBI ?? 0) || 0);
  return {
    scored: scored || runMark === "filled" || runMark === "open",
    runMark: scored && !runMark ? "filled" : runMark,
    rbi,
    direction: (obj.direction as AtBatCellMeta["direction"]) || "",
    outKind: (obj.outKind as AtBatCellMeta["outKind"]) || (obj.out_kind as AtBatCellMeta["outKind"]) || "",
    strikeoutKind:
      (obj.strikeoutKind as AtBatCellMeta["strikeoutKind"]) ||
      (obj.strikeout_kind as AtBatCellMeta["strikeoutKind"]) ||
      "",
  };
}

/** AI応答の cell_meta / scored マップを CellMetaMap に正規化 */
export function parseAiCellMeta(row: Record<string, unknown>): CellMetaMap | undefined {
  const metaRaw = asRecord(row.cell_meta) || asRecord(row.cellMeta);
  const scoredRaw = asRecord(row.scored) || asRecord(row.runs_scored);
  const rbiRaw = asRecord(row.rbi_by_inning) || asRecord(row.rbiByInning);

  if (!metaRaw && !scoredRaw && !rbiRaw) return undefined;

  const out: CellMetaMap = {};
  for (const key of INNING_KEYS) {
    const fromMeta = metaRaw ? parseCellMetaEntry(metaRaw[key]) : undefined;
    const scoredFlag =
      scoredRaw?.[key] === true ||
      scoredRaw?.[key] === 1 ||
      String(scoredRaw?.[key] ?? "").toLowerCase() === "true";
    const rbiVal = rbiRaw ? Math.max(0, Number(rbiRaw[key]) || 0) : undefined;
    const entry: AtBatCellMeta = {
      ...(fromMeta || {}),
      scored: Boolean(fromMeta?.scored || scoredFlag),
      rbi: typeof rbiVal === "number" ? rbiVal : fromMeta?.rbi || 0,
      runMark: fromMeta?.runMark || (scoredFlag || fromMeta?.scored ? "filled" : ""),
    };
    if (entry.scored || (entry.rbi || 0) > 0 || entry.runMark) {
      out[key] = entry;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** グループ応答から players 配列を取り出す（配列直返し互換） */
export function extractPlayersFromAiPayload(parsed: unknown[]): unknown[] {
  // parseJsonArray が既に配列化した結果を受ける想定。
  // オブジェクト全体が1要素として入っている場合もある。
  if (parsed.length === 1) {
    const only = asRecord(parsed[0]);
    if (only && Array.isArray(only.players)) return only.players;
  }
  const withPlayers = parsed.find((row) => Array.isArray(asRecord(row)?.players));
  if (withPlayers) {
    return (asRecord(withPlayers)?.players as unknown[]) || parsed;
  }
  return parsed.filter((row) => {
    const r = asRecord(row);
    return r && ("batting_order" in r || "player_name" in r || "innings" in r);
  });
}

/** AIが返した inning_scores を配列化（なければ null） */
export function extractAiInningScores(parsed: unknown[]): number[] | null {
  const candidates: unknown[] = [...parsed];
  if (parsed.length === 1) candidates.push(parsed[0]);
  for (const row of candidates) {
    const obj = asRecord(row);
    const scores = asRecord(obj?.inning_scores) || asRecord(obj?.inningScores);
    if (!scores) continue;
    return INNING_KEYS.map((k) => Math.max(0, Number(scores[k]) || 0));
  }
  return null;
}

/**
 * 個人得点丸（scored）からイニング得点を再計算し、
 * AIの inning_scores と食い違う場合は scored 集計を正とする。
 */
export function reconcileInningScores(
  players: PlayerAtBat[],
  aiInningScores?: number[] | null,
): { ourInnings: number[]; aiInningScores: number[] | null; matched: boolean } {
  const fromScored = estimateInningRunsFromPlayers(players);
  const ai = aiInningScores && aiInningScores.length === 7 ? aiInningScores : null;
  const matched = ai ? ai.every((n, i) => n === fromScored[i]) : true;
  return {
    ourInnings: fromScored,
    aiInningScores: ai,
    matched,
  };
}

export function finalizePlayersAfterAi(players: PlayerAtBat[]): PlayerAtBat[] {
  return players.map((p) => syncPlayerRbiFromCells(p));
}

export function emptyInningScoreMap(): Record<InningKey, number> {
  return { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0 };
}
