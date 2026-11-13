"use client";

import { useMemo, useState } from "react";
import { AtBatEditSheet } from "@/components/scan/AtBatEditSheet";
import { badgeTone, formatAtBatBadge, getCellMeta } from "@/lib/atbat-display";
import { INNING_KEYS } from "@/lib/constants";
import { syncPlayerRbiFromCells } from "@/lib/stats";
import type { AtBatCellMeta, InningKey, PlayerAtBat, ResultLabel } from "@/lib/types";

export function AtBatMatrix({
  players,
  onChange,
}: {
  players: PlayerAtBat[];
  onChange: (players: PlayerAtBat[]) => void;
}) {
  const [edit, setEdit] = useState<{
    playerIndex: number;
    inning: InningKey;
  } | null>(null);

  const sorted = useMemo(() => {
    return players
      .map((p, index) => ({ p, index }))
      .sort((a, b) => {
        if (a.p.batting_order !== b.p.batting_order) {
          return a.p.batting_order - b.p.batting_order;
        }
        return Number(a.p.is_substitute) - Number(b.p.is_substitute);
      });
  }, [players]);

  if (players.length === 0) {
    return (
      <p className="muted">
        解析結果がここに表示されます。AI解析後、全員の打席が一覧で見渡せます。
      </p>
    );
  }

  const applyCell = (
    playerIndex: number,
    inning: InningKey,
    result: ResultLabel,
    meta: AtBatCellMeta,
  ) => {
    const next = players.map((p, i) => {
      if (i !== playerIndex) return p;
      const updated: PlayerAtBat = {
        ...p,
        innings: { ...p.innings, [inning]: result },
        cellMeta: { ...(p.cellMeta || {}), [inning]: meta },
      };
      return syncPlayerRbiFromCells(updated);
    });
    onChange(next);
  };

  const editingPlayer = edit ? players[edit.playerIndex] : null;

  return (
    <>
      <div className="matrix-wrap">
        <div className="matrix-scroll">
          <table className="matrix-table">
            <thead>
              <tr>
                <th className="matrix-sticky matrix-sticky-head">打順</th>
                <th className="matrix-sticky matrix-sticky-head matrix-sticky-2">選手</th>
                {INNING_KEYS.map((k) => (
                  <th key={k}>{k}回</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ p, index }) => (
                <tr key={`${p.batting_order}-${p.player_name}-${index}`}>
                  <td className="matrix-sticky">
                    <div className="matrix-order">
                      <span className="matrix-order-num">{p.batting_order || "-"}</span>
                      {p.is_substitute ? <span className="matrix-sub">交</span> : null}
                    </div>
                  </td>
                  <td className="matrix-sticky matrix-sticky-2">
                    <div className="matrix-player">
                      <span className="matrix-pos">{p.position || `#${p.uniform_number || "-"}`}</span>
                      <span className="matrix-name">{p.player_name || "未登録"}</span>
                    </div>
                  </td>
                  {INNING_KEYS.map((k) => {
                    const result = p.innings[k];
                    const meta = getCellMeta(p, k);
                    const label = formatAtBatBadge(result, meta);
                    const tone = badgeTone(result);
                    const needs = result === "要確認";
                    return (
                      <td key={k}>
                        <button
                          type="button"
                          className={`matrix-cell tone-${tone}${needs ? " needs" : ""}`}
                          aria-label={`${p.player_name} ${k}回 ${label}`}
                          onClick={() => setEdit({ playerIndex: index, inning: k })}
                        >
                          <span className="matrix-cell-label">{label}</span>
                          {meta.scored ? <span className="matrix-run-dot" aria-hidden>●</span> : null}
                          {(meta.rbi || 0) > 0 ? (
                            <span className="matrix-rbi-chip">点{meta.rbi}</span>
                          ) : null}
                          {needs ? <span className="matrix-warn-icon" aria-hidden>!</span> : null}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AtBatEditSheet
        open={Boolean(edit)}
        player={editingPlayer}
        playerIndex={edit?.playerIndex ?? -1}
        inning={edit?.inning ?? null}
        onClose={() => setEdit(null)}
        onApply={(playerIndex, inning, result, meta) => {
          applyCell(playerIndex, inning, result, meta);
        }}
      />
    </>
  );
}
