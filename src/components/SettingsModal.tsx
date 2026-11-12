"use client";

import { useRef, useState } from "react";
import type { AppData, AppSettings } from "@/lib/types";
import { exportJsonBackup, importJsonBackup } from "@/lib/storage";

export function SettingsModal({
  open,
  settings,
  data,
  onClose,
  onSave,
  onImported,
}: {
  open: boolean;
  settings: AppSettings;
  data: AppData;
  onClose: () => void;
  onSave: (next: AppSettings) => void;
  onImported: (data: AppData) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <p className="section-label">SETTINGS</p>
        <h2 className="section-title">設定</h2>

        <div className="field">
          <label htmlFor="teamName">チーム名</label>
          <input
            id="teamName"
            value={draft.teamName}
            onChange={(e) => setDraft({ ...draft, teamName: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="apiKey">Gemini API キー</label>
          <input
            id="apiKey"
            type="password"
            autoComplete="off"
            placeholder="GEMINI_API_KEY（未設定時）"
            value={draft.geminiApiKey}
            onChange={(e) => setDraft({ ...draft, geminiApiKey: e.target.value })}
          />
          <span className="muted">サーバーの環境変数より画面入力が優先されます。</span>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ flex: 1 }}
            onClick={() => exportJsonBackup(data)}
          >
            JSONバックアップ
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ flex: 1 }}
            onClick={() => fileRef.current?.click()}
          >
            復元
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const imported = await importJsonBackup(file);
                onImported(imported);
                setDraft(imported.settings);
                alert("バックアップを復元しました");
              } catch (err) {
                alert(err instanceof Error ? err.message : "復元に失敗しました");
              } finally {
                e.target.value = "";
              }
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>
            閉じる
          </button>
          <button
            type="button"
            className="btn btn-navy"
            style={{ flex: 1 }}
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
