import {
  AT_BAT_RESULTS,
  HIT_RESULTS,
  INNING_KEYS,
  NON_PA_RESULTS,
  TOTAL_BASES_VALUE,
  normalizeResult,
} from "./constants";
import { assignAwards } from "./awards";
import type { MatchRecord, MatchType, PlayerAtBat, PlayerStats, ResultLabel } from "./types";

function isPlateAppearance(result: ResultLabel): boolean {
  return !NON_PA_RESULTS.has(result);
}

function isAtBat(result: ResultLabel): boolean {
  return AT_BAT_RESULTS.has(result);
}

function isHit(result: ResultLabel): boolean {
  return HIT_RESULTS.has(result);
}

function totalBasesFor(result: ResultLabel): number {
  return TOTAL_BASES_VALUE[result] ?? 0;
}

export function normalizePlayerRecord(player: Partial<PlayerAtBat>): PlayerAtBat {
  const inningsIn = (player.innings ?? {}) as Partial<PlayerAtBat["innings"]>;
  const innings = {} as PlayerAtBat["innings"];
  for (const key of INNING_KEYS) {
    innings[key] = normalizeResult(inningsIn[key] ?? "なし");
  }
  return {
    batting_order: Number(player.batting_order) || 0,
    uniform_number: String(player.uniform_number ?? "").trim(),
    player_name: String(player.player_name ?? "").trim(),
    is_substitute: Boolean(player.is_substitute),
    rbi: Number(player.rbi) || 0,
    stolen_bases: Number(player.stolen_bases) || 0,
    innings,
    highlight: String(player.highlight ?? "").trim(),
  };
}

export function countNeedsReview(player: PlayerAtBat): number {
  return INNING_KEYS.filter((k) => normalizeResult(player.innings[k]) === "要確認").length;
}

export function rateDisplay(numerator: number, denominator: number): string {
  if (denominator <= 0) return ".---";
  const rate = numerator / denominator;
  if (rate >= 1) return rate.toFixed(3);
  return `.${Math.round(rate * 1000)
    .toString()
    .padStart(3, "0")}`;
}

interface GameCompiled {
  match_id: string;
  match_date: string;
  opponent: string;
  match_type: MatchType;
  player_name: string;
  uniform_number: string;
  plate_appearances: number;
  at_bats: number;
  singles: number;
  doubles: number;
  triples: number;
  homeruns: number;
  hits: number;
  total_bases: number;
  walks: number;
  deadballs: number;
  strikeouts: number;
  sacrifice_hits: number;
  sacrifice_flies: number;
  rbi: number;
  stolen_bases: number;
}

export function compileMatchPlayers(match: MatchRecord): GameCompiled[] {
  return match.players.map((raw) => {
    const p = normalizePlayerRecord(raw);
    let singles = 0;
    let doubles = 0;
    let triples = 0;
    let homeruns = 0;
    let walks = 0;
    let deadballs = 0;
    let strikeouts = 0;
    let sacrifice_hits = 0;
    let sacrifice_flies = 0;
    let plate_appearances = 0;
    let at_bats = 0;
    let hits = 0;
    let total_bases = 0;

    for (const res of Object.values(p.innings)) {
      if (!isPlateAppearance(res)) continue;
      plate_appearances += 1;
      if (isAtBat(res)) at_bats += 1;
      if (isHit(res)) {
        hits += 1;
        total_bases += totalBasesFor(res);
      }
      if (res === "単打") singles += 1;
      else if (res === "二塁打") doubles += 1;
      else if (res === "三塁打") triples += 1;
      else if (res === "本塁打") homeruns += 1;
      else if (res === "四球") walks += 1;
      else if (res === "死球") deadballs += 1;
      else if (res === "三振") strikeouts += 1;
      else if (res === "振り逃げ") strikeouts += 1;
      else if (res === "犠打") sacrifice_hits += 1;
      else if (res === "犠飛") sacrifice_flies += 1;
    }

    return {
      match_id: match.id,
      match_date: match.match_date,
      opponent: match.opponent,
      match_type: match.match_type,
      player_name: p.player_name,
      uniform_number: p.uniform_number,
      plate_appearances,
      at_bats,
      singles,
      doubles,
      triples,
      homeruns,
      hits,
      total_bases,
      walks,
      deadballs,
      strikeouts,
      sacrifice_hits,
      sacrifice_flies,
      rbi: p.rbi,
      stolen_bases: p.stolen_bases,
    };
  });
}

export function aggregatePlayerStats(
  matches: MatchRecord[],
  options?: { matchTypes?: MatchType[]; from?: string; to?: string },
): PlayerStats[] {
  const filtered = matches.filter((m) => {
    if (options?.matchTypes && options.matchTypes.length > 0) {
      if (!options.matchTypes.includes(m.match_type)) return false;
    }
    if (options?.from && m.match_date < options.from) return false;
    if (options?.to && m.match_date > options.to) return false;
    return true;
  });

  const buckets = new Map<
    string,
    {
      player_name: string;
      uniform_numbers: Set<string>;
      games: Set<string>;
      plate_appearances: number;
      at_bats: number;
      singles: number;
      doubles: number;
      triples: number;
      homeruns: number;
      hits: number;
      total_bases: number;
      walks: number;
      deadballs: number;
      strikeouts: number;
      sacrifice_hits: number;
      sacrifice_flies: number;
      rbi: number;
      stolen_bases: number;
    }
  >();

  for (const match of filtered) {
    for (const row of compileMatchPlayers(match)) {
      const name = row.player_name.trim();
      if (!name) continue;
      let b = buckets.get(name);
      if (!b) {
        b = {
          player_name: name,
          uniform_numbers: new Set(),
          games: new Set(),
          plate_appearances: 0,
          at_bats: 0,
          singles: 0,
          doubles: 0,
          triples: 0,
          homeruns: 0,
          hits: 0,
          total_bases: 0,
          walks: 0,
          deadballs: 0,
          strikeouts: 0,
          sacrifice_hits: 0,
          sacrifice_flies: 0,
          rbi: 0,
          stolen_bases: 0,
        };
        buckets.set(name, b);
      }
      b.games.add(match.id);
      if (row.uniform_number) b.uniform_numbers.add(row.uniform_number);
      b.plate_appearances += row.plate_appearances;
      b.at_bats += row.at_bats;
      b.singles += row.singles;
      b.doubles += row.doubles;
      b.triples += row.triples;
      b.homeruns += row.homeruns;
      b.hits += row.hits;
      b.total_bases += row.total_bases;
      b.walks += row.walks;
      b.deadballs += row.deadballs;
      b.strikeouts += row.strikeouts;
      b.sacrifice_hits += row.sacrifice_hits;
      b.sacrifice_flies += row.sacrifice_flies;
      b.rbi += row.rbi;
      b.stolen_bases += row.stolen_bases;
    }
  }

  const stats: PlayerStats[] = [];
  for (const b of buckets.values()) {
    const ab = b.at_bats;
    const h = b.hits;
    const bb = b.walks;
    const hbp = b.deadballs;
    const sf = b.sacrifice_flies;
    const avg = ab > 0 ? h / ab : 0;
    const obpDenom = ab + bb + hbp + sf;
    const obp = obpDenom > 0 ? (h + bb + hbp) / obpDenom : 0;
    const slg = ab > 0 ? b.total_bases / ab : 0;
    const ops = obp + slg;
    stats.push({
      player_name: b.player_name,
      uniform_numbers: [...b.uniform_numbers].sort(),
      games: b.games.size,
      plate_appearances: b.plate_appearances,
      at_bats: ab,
      singles: b.singles,
      doubles: b.doubles,
      triples: b.triples,
      homeruns: b.homeruns,
      hits: h,
      total_bases: b.total_bases,
      walks: bb,
      deadballs: hbp,
      strikeouts: b.strikeouts,
      sacrifice_hits: b.sacrifice_hits,
      sacrifice_flies: sf,
      rbi: b.rbi,
      stolen_bases: b.stolen_bases,
      avg,
      obp,
      slg,
      ops,
      avgDisplay: rateDisplay(h, ab),
      obpDisplay: rateDisplay(h + bb + hbp, obpDenom),
      slgDisplay: rateDisplay(b.total_bases, ab),
      opsDisplay: ops >= 1 ? ops.toFixed(3) : rateDisplay(Math.round(ops * 1000), 1000),
      awards: [],
    });
  }

  const withAwards = assignAwards(stats);
  return withAwards.sort((a, b) => b.hits - a.hits || b.rbi - a.rbi || a.player_name.localeCompare(b.player_name, "ja"));
}

export function teamRecord(matches: MatchRecord[]) {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const m of matches) {
    if (m.result === "勝") wins += 1;
    else if (m.result === "敗") losses += 1;
    else draws += 1;
  }
  const decided = wins + losses;
  const winRate = decided > 0 ? wins / decided : 0;
  return {
    wins,
    losses,
    draws,
    winRate,
    winRateDisplay: decided > 0 ? rateDisplay(wins, decided) : ".---",
  };
}

export function inferMatchResult(our: number, their: number): "勝" | "敗" | "分" {
  if (our > their) return "勝";
  if (our < their) return "敗";
  return "分";
}
