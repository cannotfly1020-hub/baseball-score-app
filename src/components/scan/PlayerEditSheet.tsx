"use client";

import { FIELD_POSITIONS } from "@/lib/constants";
import type { PlayerAtBat, RosterPlayer } from "@/lib/types";

export function PlayerEditSheet({
  open,
  player,
  roster,
  onClose,
  onApply,
}: {
  open: boolean;
  player: PlayerAtBat | null;
  roster: RosterPlayer[];
  onClose: () => void;
  onApply: (patch: Partial<PlayerAtBat>) => void;
}) {
  if (!open || !player) return null;

  const name = player.player_name || "";
  const position = player.position || "";

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label="選手情報修正"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div>
            <strong>選手情報を修正</strong>
            <div className="muted" style={{ fontSize: "0.78rem" }}>
              {player.batting_order || "-"}番 · #{player.uniform_number || "-"}
              {player.is_substitute ? " · 交代" : ""}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" style={{ padding: "8px 12px" }} onClick={onClose}>
            閉じる
          </button>
        </div>

        <p className="sheet-section-label">チーム名簿から選択</p>
        {roster.length === 0 ? (
          <p className="muted" style={{ fontSize: "0.8rem" }}>
            名簿が未登録です。履歴タブの「チーム名簿管理」から追加できます。
          </p>
        ) : (
          <div className="sheet-grid sheet-grid-roster">
            {roster.map((r) => {
              const active = r.player_name === name;
              return (
                <button
                  key={r.id}
                  type="button"
                  className={`sheet-chip${active ? " active" : ""}`}
                  onClick={() =>
                    onApply({
                      player_name: r.player_name,
                      uniform_number: r.uniform_number || player.uniform_number,
                    })
                  }
                >
                  {r.uniform_number ? `#${r.uniform_number} ` : ""}
                  {r.player_name}
                </button>
              );
            })}
          </div>
        )}

        <p className="sheet-section-label">選手名（手入力）</p>
        <div className="field" style={{ marginBottom: 8 }}>
          <input
            value={name}
            placeholder="選手名"
            aria-label="選手名"
            onChange={(e) => onApply({ player_name: e.target.value })}
          />
        </div>
        <div className="field" style={{ marginBottom: 4 }}>
          <label>背番号</label>
          <input
            value={player.uniform_number || ""}
            placeholder="背番号"
            aria-label="背番号"
            onChange={(e) => onApply({ uniform_number: e.target.value })}
          />
        </div>

        <p className="sheet-section-label">守備位置</p>
        <div className="sheet-grid sheet-grid-dirs">
          {FIELD_POSITIONS.map((pos) => (
            <button
              key={pos}
              type="button"
              className={`sheet-chip${position === pos ? " active" : ""}`}
              onClick={() => onApply({ position: position === pos ? "" : pos })}
            >
              {pos}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
