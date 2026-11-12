"use client";

import { INNING_KEYS, RESULT_OPTIONS } from "@/lib/constants";
import type { PlayerAtBat, ResultLabel } from "@/lib/types";

export function AtBatGrid({
  players,
  onChange,
}: {
  players: PlayerAtBat[];
  onChange: (players: PlayerAtBat[]) => void;
}) {
  if (players.length === 0) {
    return <p className="muted">解析結果がここに表示されます。要確認マスは黄色くハイライトされます。</p>;
  }

  const update = (index: number, patch: Partial<PlayerAtBat>) => {
    const next = players.map((p, i) => (i === index ? { ...p, ...patch } : p));
    onChange(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {players.map((p, idx) => (
        <div key={`${p.player_name}-${idx}`} className="panel" style={{ padding: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <div>
              <strong>
                {p.batting_order || "-"}番 {p.player_name || "未登録"}
              </strong>
              <div className="muted">
                #{p.uniform_number || "-"}
                {p.is_substitute ? " · 交代" : ""}
              </div>
            </div>
            <div className="grid-2" style={{ width: 140 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>打点</label>
                <input
                  type="number"
                  min={0}
                  value={p.rbi}
                  onChange={(e) => update(idx, { rbi: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>盗塁</label>
                <input
                  type="number"
                  min={0}
                  value={p.stolen_bases}
                  onChange={(e) => update(idx, { stolen_bases: Number(e.target.value) || 0 })}
                />
              </div>
            </div>
          </div>

          <div className="table-scroll">
            <div className="atbat-grid" style={{ minWidth: 520 }}>
              <div className="atbat-cell header">選手</div>
              {INNING_KEYS.map((k) => (
                <div key={k} className="atbat-cell header">
                  {k}回
                </div>
              ))}
              <div className="atbat-cell header">打点</div>
              <div className="atbat-cell header">盗塁</div>

              <div className="atbat-cell" style={{ cursor: "default", fontWeight: 700 }}>
                {p.player_name.slice(0, 4) || "-"}
              </div>
              {INNING_KEYS.map((k) => {
                const val = p.innings[k];
                const needs = val === "要確認";
                return (
                  <select
                    key={k}
                    className={`atbat-cell${needs ? " needs-review" : ""}`}
                    value={val}
                    aria-label={`${p.player_name} ${k}回`}
                    onChange={(e) =>
                      update(idx, {
                        innings: { ...p.innings, [k]: e.target.value as ResultLabel },
                      })
                    }
                    style={{ appearance: "none", width: "100%" }}
                  >
                    {RESULT_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                );
              })}
              <div className="atbat-cell" style={{ cursor: "default" }}>
                {p.rbi}
              </div>
              <div className="atbat-cell" style={{ cursor: "default" }}>
                {p.stolen_bases}
              </div>
            </div>
          </div>

          {p.highlight ? (
            <p className="muted" style={{ marginTop: 8 }}>
              ハイライト: {p.highlight}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
