import type { PlayerStats } from "./types";

const MIN_AB_FOR_AVG = 10;
const MIN_PA_FOR_OBP = 10;

export function assignAwards(stats: PlayerStats[]): PlayerStats[] {
  if (stats.length === 0) return stats;

  const eligibleAvg = stats.filter((s) => s.at_bats >= MIN_AB_FOR_AVG);
  const eligibleObp = stats.filter((s) => s.plate_appearances >= MIN_PA_FOR_OBP);

  const topAvg = maxBy(eligibleAvg, (s) => s.avg);
  const topObp = maxBy(eligibleObp, (s) => s.obp);
  const topOps = maxBy(eligibleAvg, (s) => s.ops);
  const topHits = maxBy(stats, (s) => s.hits);
  const topHr = maxBy(stats, (s) => s.homeruns);
  const topRbi = maxBy(stats, (s) => s.rbi);
  const topSb = maxBy(stats, (s) => s.stolen_bases);
  const topWalks = maxBy(stats, (s) => s.walks + s.deadballs);
  const lowK = minBy(
    stats.filter((s) => s.at_bats >= MIN_AB_FOR_AVG && s.strikeouts / s.at_bats < 0.2),
    (s) => (s.at_bats > 0 ? s.strikeouts / s.at_bats : 1),
  );
  const topXbh = maxBy(stats, (s) => s.doubles + s.triples + s.homeruns);

  return stats.map((s) => {
    const awards: string[] = [];
    if (topAvg && s.player_name === topAvg.player_name && topAvg.avg > 0) awards.push("首位打者");
    if (topObp && s.player_name === topObp.player_name && topObp.obp > 0) awards.push("出塁王");
    if (topOps && s.player_name === topOps.player_name && topOps.ops > 0) awards.push("OPSキング");
    if (topHits && s.player_name === topHits.player_name && topHits.hits > 0) awards.push("安打製造機");
    if (topHr && s.player_name === topHr.player_name && topHr.homeruns > 0) awards.push("ホームラン王");
    if (topRbi && s.player_name === topRbi.player_name && topRbi.rbi > 0) awards.push("打点王");
    if (topSb && s.player_name === topSb.player_name && topSb.stolen_bases > 0) awards.push("韋駄天");
    if (topWalks && s.player_name === topWalks.player_name && topWalks.walks + topWalks.deadballs > 0) {
      awards.push("選球眼マスター");
    }
    if (lowK && s.player_name === lowK.player_name) awards.push("コンタクト職人");
    if (topXbh && s.player_name === topXbh.player_name && topXbh.doubles + topXbh.triples + topXbh.homeruns > 0) {
      awards.push("長打職人");
    }
    return { ...s, awards };
  });
}

function maxBy<T>(arr: T[], fn: (x: T) => number): T | null {
  if (arr.length === 0) return null;
  return arr.reduce((best, cur) => (fn(cur) > fn(best) ? cur : best));
}

function minBy<T>(arr: T[], fn: (x: T) => number): T | null {
  if (arr.length === 0) return null;
  return arr.reduce((best, cur) => (fn(cur) < fn(best) ? cur : best));
}

export function tripleCrown(stats: PlayerStats[]) {
  // 学童は試合数が少ないため、打席1以上でランキング表示する
  const eligible = stats.filter((s) => s.plate_appearances >= 1 || s.rbi > 0 || s.stolen_bases > 0);
  return {
    avg: maxBy(
      eligible.filter((s) => s.at_bats >= 1),
      (s) => s.avg,
    ),
    rbi: maxBy(eligible, (s) => s.rbi),
    sb: maxBy(eligible, (s) => s.stolen_bases),
  };
}
