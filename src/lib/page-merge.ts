import { INNING_KEYS, normalizeResult } from "./constants";
import { estimateInningRunsFromPlayers, normalizePlayerRecord, syncPlayerRbiFromCells } from "./stats";
import type { AtBatCellMeta, CellMetaMap, InningKey, InningsMap, PlayerAtBat, ResultLabel } from "./types";

export type PageSource = 1 | 2;

export type InningSourceMap = Record<InningKey, PageSource>;

/** そのイニングに「実記入」があるかのスコア（多い側のページを採用） */
export function inningFillScore(players: PlayerAtBat[], key: InningKey): number {
  let score = 0;
  for (const p of players) {
    const result = normalizeResult(p.innings[key]);
    if (result !== "なし") score += 2;
    const meta = p.cellMeta?.[key];
    if (meta?.scored) score += 1;
    if ((meta?.rbi || 0) > 0) score += 1;
    if (meta?.direction) score += 0.5;
  }
  return score;
}

/**
 * 各イニングをどちらのページから取るか決める。
 * 前半ページに多い列＝前半、後半に多い列＝後半。同点時は 1〜4→1枚目、5〜7→2枚目。
 */
export function chooseInningSources(
  page1: PlayerAtBat[],
  page2: PlayerAtBat[],
): InningSourceMap {
  const out = {} as InningSourceMap;
  for (const key of INNING_KEYS) {
    const s1 = inningFillScore(page1, key);
    const s2 = inningFillScore(page2, key);
    const n = Number(key);
    if (s2 > s1) out[key] = 2;
    else if (s1 > s2) out[key] = 1;
    else out[key] = n <= 4 ? 1 : 2;
  }
  return out;
}

function namesClose(a: string, b: string): boolean {
  const x = a.replace(/\s/g, "");
  const y = b.replace(/\s/g, "");
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** 2枚目の選手を1枚目の行へ対応付ける（打順・背番号・氏名） */
export function findMatchingPlayerIndex(
  base: PlayerAtBat[],
  candidate: PlayerAtBat,
): number {
  const orderMatches = base
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.batting_order === candidate.batting_order);

  const scoped = orderMatches.length > 0 ? orderMatches : base.map((p, i) => ({ p, i }));

  const byUniform = scoped.find(
    ({ p }) =>
      candidate.uniform_number &&
      p.uniform_number === candidate.uniform_number &&
      Boolean(p.is_substitute) === Boolean(candidate.is_substitute),
  );
  if (byUniform) return byUniform.i;

  const byName = scoped.find(
    ({ p }) =>
      namesClose(p.player_name, candidate.player_name) &&
      Boolean(p.is_substitute) === Boolean(candidate.is_substitute),
  );
  if (byName) return byName.i;

  const byOrderStarter = scoped.find(
    ({ p }) =>
      !p.is_substitute &&
      !candidate.is_substitute &&
      p.batting_order === candidate.batting_order,
  );
  if (byOrderStarter) return byOrderStarter.i;

  const byOrderSameSub = scoped.find(
    ({ p }) =>
      Boolean(p.is_substitute) === Boolean(candidate.is_substitute) &&
      p.batting_order === candidate.batting_order,
  );
  if (byOrderSameSub) return byOrderSameSub.i;

  return -1;
}

function emptyInningsMap(): InningsMap {
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

function pickCell(
  primary: PlayerAtBat | undefined,
  fallback: PlayerAtBat | undefined,
  key: InningKey,
): { result: ResultLabel; meta?: AtBatCellMeta } {
  const from = primary || fallback;
  if (!from) return { result: "なし" };
  const result = normalizeResult(from.innings[key]);
  const meta = from.cellMeta?.[key];
  return { result, meta: meta ? { ...meta } : undefined };
}

function mergeTwoPlayers(
  page1Player: PlayerAtBat | undefined,
  page2Player: PlayerAtBat | undefined,
  sources: InningSourceMap,
): PlayerAtBat {
  const base = normalizePlayerRecord(page1Player || page2Player || {});
  const innings = emptyInningsMap();
  const cellMeta: CellMetaMap = {};

  for (const key of INNING_KEYS) {
    const preferPage2 = sources[key] === 2;
    const primary = preferPage2 ? page2Player : page1Player;
    const fallback = preferPage2 ? page1Player : page2Player;
    const picked = pickCell(primary, fallback, key);
    innings[key] = picked.result;
    if (picked.meta && (picked.meta.scored || (picked.meta.rbi || 0) > 0 || picked.meta.runMark || picked.meta.direction || picked.meta.outKind || picked.meta.strikeoutKind)) {
      cellMeta[key] = picked.meta;
    }
  }

  const name =
    (page1Player?.player_name && page1Player.player_name !== "未登録"
      ? page1Player.player_name
      : "") ||
    page2Player?.player_name ||
    base.player_name;
  const uniform =
    page1Player?.uniform_number || page2Player?.uniform_number || base.uniform_number;
  const position = page1Player?.position || page2Player?.position || base.position;
  const stolen = Math.max(page1Player?.stolen_bases || 0, page2Player?.stolen_bases || 0);

  return syncPlayerRbiFromCells(
    normalizePlayerRecord({
      batting_order: base.batting_order || page2Player?.batting_order || 0,
      uniform_number: uniform,
      player_name: name,
      is_substitute: Boolean(page1Player?.is_substitute || page2Player?.is_substitute),
      position,
      stolen_bases: stolen,
      rbi: 0,
      innings,
      cellMeta: Object.keys(cellMeta).length > 0 ? cellMeta : undefined,
      highlight: page1Player?.highlight || page2Player?.highlight || "",
    }),
  );
}

export interface MergePagesResult {
  players: PlayerAtBat[];
  inningSources: InningSourceMap;
  ourInnings: number[];
}

/**
 * 1枚目（前半）と2枚目（後半）の解析結果を1試合分の選手行に連結する。
 * page2 が空なら page1 をそのまま返す。
 */
export function mergeScorebookPages(
  page1Players: PlayerAtBat[],
  page2Players: PlayerAtBat[],
): MergePagesResult {
  const p1 = page1Players.map((p) => normalizePlayerRecord(p));
  const p2 = page2Players.map((p) => normalizePlayerRecord(p));

  if (p2.length === 0) {
    const players = p1.map((p) => syncPlayerRbiFromCells(p));
    return {
      players,
      inningSources: Object.fromEntries(INNING_KEYS.map((k) => [k, 1])) as InningSourceMap,
      ourInnings: estimateInningRunsFromPlayers(players),
    };
  }
  if (p1.length === 0) {
    const players = p2.map((p) => syncPlayerRbiFromCells(p));
    return {
      players,
      inningSources: Object.fromEntries(INNING_KEYS.map((k) => [k, 2])) as InningSourceMap,
      ourInnings: estimateInningRunsFromPlayers(players),
    };
  }

  const sources = chooseInningSources(p1, p2);
  const merged: PlayerAtBat[] = p1.map((player) => {
    const idx = findMatchingPlayerIndex(p2, player);
    return mergeTwoPlayers(player, idx >= 0 ? p2[idx] : undefined, sources);
  });

  // 2枚目にだけいる代打・代走などを追加
  for (const candidate of p2) {
    if (findMatchingPlayerIndex(p1, candidate) >= 0) continue;
    if (findMatchingPlayerIndex(merged, candidate) >= 0) continue;
    merged.push(mergeTwoPlayers(undefined, candidate, sources));
  }

  merged.sort((a, b) => {
    if (a.batting_order !== b.batting_order) return a.batting_order - b.batting_order;
    return Number(a.is_substitute) - Number(b.is_substitute);
  });

  return {
    players: merged,
    inningSources: sources,
    ourInnings: estimateInningRunsFromPlayers(merged),
  };
}
