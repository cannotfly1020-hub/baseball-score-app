"use client";

import { SavedGamesPanel } from "@/components/history/SavedGamesPanel";
import { downloadMatchesExcel } from "@/lib/excel";
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
            disabled={data.matches.length === 0}
            onClick={() => downloadMatchesExcel(data.matches)}
          >
            Excel一括ダウンロード
          </button>
          <button type="button" className="btn btn-navy" style={{ flex: 1 }} onClick={onOpenRoster}>
            チーム名簿管理
          </button>
        </div>
      </div>

      <SavedGamesPanel
        matches={data.matches}
        onEditMatch={onEditMatch}
        onDelete={onDelete}
      />
    </div>
  );
}
