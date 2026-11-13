"use client";

import { useState } from "react";
import { downloadMatchesExcel } from "@/lib/excel";
import { INNING_KEYS } from "@/lib/constants";
import type { AppData, MatchRecord } from "@/lib/types";

export function HistoryTab({
  data,
  onDelete,
  onOpenRoster,
  onEditMatch,
}: {
  data: AppData;
  onDelete: (id: string) => void;
  onOpenRoster: () => void;
  onEditMatch: (match: MatchRecord) => void;
}) {
  const [selected, setSelected] = useState<MatchRecord | null>(null);
  const matches = [...data.matches].sort((a, b) => {
    const byDate = b.match_date.localeCompare(a.match_date);
    if (byDate !== 0) return byDate;
    return (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at);
  });

  return (
    <div className="fade-in">
      <div className="panel">
        <p className="section-label">HISTORY</p>
        <h2 className="section-title">保存済みの試合を呼び出す</h2>
        <p className="muted" style={{ marginBottom: 10 }}>
          一覧から試合を選び、再編集・上書き保存・削除ができます。
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={matches.length === 0}
            onClick={() => downloadMatchesExcel(data.matches)}
          >
            Excel一括ダウンロード
          </button>
          <button type="button" className="btn btn-navy" style={{ flex: 1 }} onClick={onOpenRoster}>
            チーム名簿管理
          </button>
        </div>
      </div>

      {matches.length === 0 ? (
        <div className="panel">
          <p className="muted">保存済みの試合はまだありません。AI読取タブで解析して保存してください。</p>
        </div>
      ) : (
        matches.map((m) => (
          <div key={m.id} className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 800 }}>vs {m.opponent}</div>
                <div className="muted">
                  {m.match_date} · {m.match_type} · {m.category}
                  {m.updated_at ? " · 再編集あり" : ""}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.2rem" }}>
                  {m.our_score}-{m.their_score}
                </div>
                <span className="badge">{m.result}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1, minWidth: 120 }}
                onClick={() => onEditMatch(m)}
              >
                呼び出して再編集
              </button>
              <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setSelected(m)}>
                詳細
              </button>
              <button
                type="button"
                className="btn btn-outline"
                style={{ flex: 1 }}
                onClick={() => {
                  if (confirm("この試合を削除しますか？成績集計からも除外されます。")) onDelete(m.id);
                }}
              >
                削除
              </button>
            </div>
          </div>
        ))
      )}

      {selected ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxHeight: "85dvh", overflow: "auto" }}>
            <p className="section-label">MATCH DETAIL</p>
            <h2 className="section-title">
              {selected.match_date} vs {selected.opponent}
            </h2>
            <p className="muted" style={{ marginBottom: 10 }}>
              {selected.match_type} / {selected.category} / {selected.our_score}-{selected.their_score}（
              {selected.result}）
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>選手</th>
                    {INNING_KEYS.map((k) => (
                      <th key={k}>{k}</th>
                    ))}
                    <th>打点</th>
                    <th>盗塁</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.players.map((p, i) => (
                    <tr key={`${p.player_name}-${i}`}>
                      <td>
                        {p.batting_order}.{p.position ? `${p.position} ` : ""}
                        {p.player_name}
                      </td>
                      {INNING_KEYS.map((k) => (
                        <td
                          key={k}
                          className={p.innings[k] === "要確認" ? "needs-review" : undefined}
                          style={{ borderRadius: 6 }}
                        >
                          {p.innings[k]}
                        </td>
                      ))}
                      <td>{p.rbi}</td>
                      <td>{p.stolen_bases}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => {
                  setSelected(null);
                  onEditMatch(selected);
                }}
              >
                この試合を再編集
              </button>
              <button
                type="button"
                className="btn btn-navy"
                style={{ flex: 1 }}
                onClick={() => setSelected(null)}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
