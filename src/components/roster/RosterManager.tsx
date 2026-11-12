"use client";

import { createId } from "@/lib/constants";
import type { RosterPlayer } from "@/lib/types";

export function RosterManager({
  roster,
  onChange,
  onClose,
}: {
  roster: RosterPlayer[];
  onChange: (roster: RosterPlayer[]) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card" style={{ maxHeight: "85dvh", overflow: "auto" }}>
        <p className="section-label">ROSTER</p>
        <h2 className="section-title">チーム名簿</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          AI読取時の選手名照合に使います。背番号は「公式,練習」の形式も可。
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {roster.map((p, idx) => (
            <div
              key={p.id}
              style={{
                display: "grid",
                gridTemplateColumns: "70px 1fr 36px",
                gap: 6,
                alignItems: "center",
              }}
            >
              <input
                aria-label="背番号"
                value={p.uniform_number}
                placeholder="番号"
                onChange={(e) => {
                  const next = [...roster];
                  next[idx] = { ...p, uniform_number: e.target.value };
                  onChange(next);
                }}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: "8px 6px",
                }}
              />
              <input
                aria-label="選手名"
                value={p.player_name}
                placeholder="選手名"
                onChange={(e) => {
                  const next = [...roster];
                  next[idx] = { ...p, player_name: e.target.value };
                  onChange(next);
                }}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: "8px 6px",
                }}
              />
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: 8 }}
                onClick={() => onChange(roster.filter((x) => x.id !== p.id))}
                aria-label="削除"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-outline"
          style={{ width: "100%", marginTop: 12 }}
          onClick={() =>
            onChange([
              ...roster,
              { id: createId("roster"), uniform_number: "", player_name: "", note: "" },
            ])
          }
        >
          選手を追加
        </button>

        <button
          type="button"
          className="btn btn-navy"
          style={{ width: "100%", marginTop: 8 }}
          onClick={onClose}
        >
          完了
        </button>
      </div>
    </div>
  );
}
