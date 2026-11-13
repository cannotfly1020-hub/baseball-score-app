import type { RosterPlayer } from "./types";

function normalizeName(name: string): string {
  return String(name || "")
    .trim()
    .replace(/[\s　]/g, "")
    .replace(/[・･]/g, "")
    .toLowerCase();
}

/** 簡易レーベンシュタイン距離 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.92;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - dist / maxLen;
}

/**
 * AIが読んだ選手名を登録名簿へ最も近い名前に紐づける。
 * 近すぎない場合は元の名前を返す。
 */
export function matchPlayerToRoster(
  rawName: string,
  roster: RosterPlayer[],
  opts?: { minScore?: number },
): { player_name: string; uniform_number?: string; matched: boolean; score: number } {
  const minScore = opts?.minScore ?? 0.55;
  const raw = String(rawName || "").trim();
  if (!raw || roster.length === 0) {
    return { player_name: raw || "未登録", matched: false, score: 0 };
  }

  let best: RosterPlayer | null = null;
  let bestScore = 0;
  for (const p of roster) {
    const score = similarity(raw, p.player_name);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  if (best && bestScore >= minScore) {
    return {
      player_name: best.player_name,
      uniform_number: best.uniform_number,
      matched: true,
      score: bestScore,
    };
  }
  return { player_name: raw, matched: false, score: bestScore };
}

export function applyRosterMatching<T extends { player_name: string; uniform_number?: string }>(
  players: T[],
  roster: RosterPlayer[],
): T[] {
  return players.map((p) => {
    const matched = matchPlayerToRoster(p.player_name, roster);
    if (!matched.matched) return p;
    return {
      ...p,
      player_name: matched.player_name,
      uniform_number: p.uniform_number?.trim()
        ? p.uniform_number
        : matched.uniform_number || p.uniform_number,
    };
  });
}
