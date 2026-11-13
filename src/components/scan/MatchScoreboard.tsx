"use client";

import { countTeamHits } from "@/lib/stats";
import type { PlayerAtBat } from "@/lib/types";

const INNINGS = [1, 2, 3, 4, 5, 6, 7] as const;

export function MatchScoreboard({
  teamName,
  opponent,
  ourInnings,
  theirInnings,
  ourErrors,
  theirErrors,
  theirHits,
  players,
  onOurInningChange,
  onTheirInningChange,
  onOurErrorsChange,
  onTheirErrorsChange,
  onTheirHitsChange,
  onConfirm,
  onTogglePhoto,
  photoOpen,
  canConfirm,
  confirmLabel = "試合データを保存する（確定）",
}: {
  teamName: string;
  opponent: string;
  ourInnings: number[];
  theirInnings: number[];
  ourErrors: number;
  theirErrors: number;
  theirHits: number;
  players: PlayerAtBat[];
  onOurInningChange: (index: number, value: number) => void;
  onTheirInningChange: (index: number, value: number) => void;
  onOurErrorsChange: (value: number) => void;
  onTheirErrorsChange: (value: number) => void;
  onTheirHitsChange: (value: number) => void;
  onConfirm: () => void;
  onTogglePhoto: () => void;
  photoOpen: boolean;
  canConfirm: boolean;
  confirmLabel?: string;
}) {
  const ourR = ourInnings.reduce((a, b) => a + b, 0);
  const theirR = theirInnings.reduce((a, b) => a + b, 0);
  const ourH = countTeamHits(players);

  return (
    <div className="scoreboard">
      <div className="scoreboard-actions">
        <button
          type="button"
          className="btn btn-primary scoreboard-action-btn"
          disabled={!canConfirm}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          className={`btn ${photoOpen ? "btn-navy" : "btn-ghost"} scoreboard-action-btn`}
          onClick={onTogglePhoto}
        >
          {photoOpen ? "写真を閉じる" : "写真を見比べる"}
        </button>
      </div>

      <div className="scoreboard-scroll">
        <table className="scoreboard-table">
          <thead>
            <tr>
              <th className="scoreboard-team-col">TEAM</th>
              {INNINGS.map((n) => (
                <th key={n}>{n}</th>
              ))}
              <th>R</th>
              <th>H</th>
              <th>E</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="scoreboard-team-col" scope="row">
                <span className="scoreboard-team-name">{teamName || "自チーム"}</span>
              </th>
              {ourInnings.map((v, i) => (
                <td key={`our-${i}`}>
                  <input
                    className="scoreboard-cell-input"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={v}
                    aria-label={`自チーム ${i + 1}回`}
                    onChange={(e) => onOurInningChange(i, Math.max(0, Number(e.target.value) || 0))}
                  />
                </td>
              ))}
              <td className="scoreboard-total">{ourR}</td>
              <td className="scoreboard-total">{ourH}</td>
              <td>
                <input
                  className="scoreboard-cell-input"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={ourErrors}
                  aria-label="自チーム失策"
                  onChange={(e) => onOurErrorsChange(Math.max(0, Number(e.target.value) || 0))}
                />
              </td>
            </tr>
            <tr>
              <th className="scoreboard-team-col" scope="row">
                <span className="scoreboard-team-name">{opponent || "相手"}</span>
              </th>
              {theirInnings.map((v, i) => (
                <td key={`their-${i}`}>
                  <input
                    className="scoreboard-cell-input"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={v}
                    aria-label={`相手 ${i + 1}回`}
                    onChange={(e) =>
                      onTheirInningChange(i, Math.max(0, Number(e.target.value) || 0))
                    }
                  />
                </td>
              ))}
              <td className="scoreboard-total">{theirR}</td>
              <td>
                <input
                  className="scoreboard-cell-input"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={theirHits}
                  aria-label="相手安打"
                  onChange={(e) => onTheirHitsChange(Math.max(0, Number(e.target.value) || 0))}
                />
              </td>
              <td>
                <input
                  className="scoreboard-cell-input"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={theirErrors}
                  aria-label="相手失策"
                  onChange={(e) => onTheirErrorsChange(Math.max(0, Number(e.target.value) || 0))}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
