import type { MatchRecord, MatchScoreboardState } from "@/lib/types";

export function emptyScoreboard(): MatchScoreboardState {
  return {
    ourInnings: [0, 0, 0, 0, 0, 0, 0],
    theirInnings: [0, 0, 0, 0, 0, 0, 0],
    ourErrors: 0,
    theirErrors: 0,
    theirHits: 0,
  };
}

export function scoreboardFromMatch(match: MatchRecord): MatchScoreboardState {
  if (match.scoreboard) {
    return {
      ourInnings: [...match.scoreboard.ourInnings],
      theirInnings: [...match.scoreboard.theirInnings],
      ourErrors: match.scoreboard.ourErrors,
      theirErrors: match.scoreboard.theirErrors,
      theirHits: match.scoreboard.theirHits,
    };
  }
  const sb = emptyScoreboard();
  sb.ourInnings[0] = match.our_score;
  sb.theirInnings[0] = match.their_score;
  return sb;
}
