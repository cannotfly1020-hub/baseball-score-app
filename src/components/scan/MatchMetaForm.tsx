"use client";

import { CATEGORIES, MATCH_TYPES } from "@/lib/constants";
import type { MatchType } from "@/lib/types";

/** 試合日・相手・種別・カテゴリ入力 */
export function MatchMetaForm({
  matchDate,
  opponent,
  matchType,
  category,
  onMatchDateChange,
  onOpponentChange,
  onMatchTypeChange,
  onCategoryChange,
}: {
  matchDate: string;
  opponent: string;
  matchType: MatchType;
  category: string;
  onMatchDateChange: (value: string) => void;
  onOpponentChange: (value: string) => void;
  onMatchTypeChange: (value: MatchType) => void;
  onCategoryChange: (value: string) => void;
}) {
  return (
    <>
      <div className="grid-2">
        <div className="field">
          <label>試合日</label>
          <input type="date" value={matchDate} onChange={(e) => onMatchDateChange(e.target.value)} />
        </div>
        <div className="field">
          <label>対戦相手</label>
          <input
            value={opponent}
            onChange={(e) => onOpponentChange(e.target.value)}
            placeholder="〇〇少年野球"
          />
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>試合種別</label>
          <select
            value={matchType}
            onChange={(e) => onMatchTypeChange(e.target.value as MatchType)}
          >
            {MATCH_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>カテゴリ</label>
          <select value={category} onChange={(e) => onCategoryChange(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}
