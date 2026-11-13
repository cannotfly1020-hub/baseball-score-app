"use client";

import { HIT_DIRECTIONS, emptyCellMeta } from "@/lib/atbat-display";
import type {
  AtBatCellMeta,
  HitDirection,
  InningKey,
  OutKind,
  PlayerAtBat,
  ResultLabel,
  StrikeoutKind,
} from "@/lib/types";

const RESULT_BUTTONS: Array<{ label: string; result: ResultLabel; outKind?: OutKind; k?: StrikeoutKind }> =
  [
    { label: "単打", result: "単打" },
    { label: "二塁打", result: "二塁打" },
    { label: "三塁打", result: "三塁打" },
    { label: "本塁打", result: "本塁打" },
    { label: "ゴロ", result: "凡打", outKind: "ゴロ" },
    { label: "フライ", result: "凡打", outKind: "フライ" },
    { label: "空三", result: "三振", k: "空" },
    { label: "見三", result: "三振", k: "見" },
    { label: "四球", result: "四球" },
    { label: "死球", result: "死球" },
    { label: "犠打", result: "犠打" },
    { label: "犠飛", result: "犠飛" },
    { label: "敵失", result: "敵失" },
    { label: "野選", result: "野選" },
    { label: "なし", result: "なし" },
    { label: "要確認", result: "要確認" },
  ];

export function AtBatEditSheet({
  open,
  player,
  playerIndex,
  inning,
  onClose,
  onApply,
}: {
  open: boolean;
  player: PlayerAtBat | null;
  playerIndex: number;
  inning: InningKey | null;
  onClose: () => void;
  onApply: (
    playerIndex: number,
    inning: InningKey,
    result: ResultLabel,
    meta: AtBatCellMeta,
  ) => void;
}) {
  if (!open || !player || !inning) return null;

  const current = player.innings[inning];
  const meta: AtBatCellMeta = {
    ...emptyCellMeta(),
    ...(player.cellMeta?.[inning] || {}),
  };

  const apply = (nextResult: ResultLabel, patch: Partial<AtBatCellMeta> = {}) => {
    const nextMeta: AtBatCellMeta = {
      ...meta,
      ...patch,
    };
    if (nextResult !== "凡打") nextMeta.outKind = "";
    if (nextResult !== "三振") nextMeta.strikeoutKind = "";
    onApply(playerIndex, inning, nextResult, nextMeta);
  };

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label="打席修正"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div>
            <strong>
              {player.batting_order || "-"}番 {player.player_name || "未登録"}
            </strong>
            <div className="muted" style={{ fontSize: "0.78rem" }}>
              {inning}回 · 現在: {current}
              {player.position ? ` · ${player.position}` : ""}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" style={{ padding: "8px 12px" }} onClick={onClose}>
            閉じる
          </button>
        </div>

        <p className="sheet-section-label">結果</p>
        <div className="sheet-grid">
          {RESULT_BUTTONS.map((btn) => {
            const active =
              current === btn.result &&
              (btn.outKind ? meta.outKind === btn.outKind : true) &&
              (btn.k ? meta.strikeoutKind === btn.k : true);
            return (
              <button
                key={btn.label}
                type="button"
                className={`sheet-chip${active ? " active" : ""}`}
                onClick={() =>
                  apply(btn.result, {
                    outKind: btn.outKind || "",
                    strikeoutKind: btn.k || "",
                  })
                }
              >
                {btn.label}
              </button>
            );
          })}
        </div>

        <p className="sheet-section-label">打球方向</p>
        <div className="sheet-grid sheet-grid-dirs">
          {HIT_DIRECTIONS.map((d) => (
            <button
              key={d}
              type="button"
              className={`sheet-chip${meta.direction === d ? " active" : ""}`}
              onClick={() =>
                apply(current, {
                  direction: (meta.direction === d ? "" : d) as HitDirection,
                })
              }
            >
              {d}
            </button>
          ))}
        </div>

        <div className="sheet-meta-row">
          <button
            type="button"
            className={`sheet-toggle${meta.scored ? " on" : ""}`}
            onClick={() => apply(current, { scored: !meta.scored })}
          >
            得点 ● {meta.scored ? "ON" : "OFF"}
          </button>
          <div className="sheet-rbi">
            <span>打点</span>
            <button
              type="button"
              className="sheet-step"
              onClick={() =>
                apply(current, { rbi: Math.max(0, (meta.rbi || 0) - 1) })
              }
            >
              −
            </button>
            <strong>{meta.rbi || 0}</strong>
            <button
              type="button"
              className="sheet-step"
              onClick={() => apply(current, { rbi: Math.min(4, (meta.rbi || 0) + 1) })}
            >
              ＋
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
