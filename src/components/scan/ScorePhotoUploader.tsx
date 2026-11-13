"use client";

import { useRef } from "react";
import {
  DualPagePreviewTabs,
  DualPageSlots,
  type PageSlotId,
} from "@/components/scan/DualPageSlots";
import { ImagePreview } from "@/components/scan/ImagePreview";
import type { PageImageState } from "@/lib/page-image-state";
import type { RedSensitivity } from "@/lib/image-process";

/**
 * 1枚目／2枚目の写真選択と赤強調プレビュー担当。
 */
export function ScorePhotoUploader({
  activePage,
  onSelectPage,
  page1,
  page2,
  hasPage2,
  canAnalyze,
  analyzing,
  onPickFile,
  onClearPage,
  onSensitivityChange,
  onAnalyze,
  error,
  status,
  usageLine,
  showPreview = true,
}: {
  activePage: PageSlotId;
  onSelectPage: (page: PageSlotId) => void;
  page1: PageImageState;
  page2: PageImageState;
  hasPage2: boolean;
  canAnalyze: boolean;
  analyzing: boolean;
  onPickFile: (page: PageSlotId, file: File) => void;
  onClearPage: (page: PageSlotId) => void;
  onSensitivityChange: (page: PageSlotId, value: RedSensitivity) => void;
  onAnalyze: () => void;
  error: string;
  status: string;
  /** 解析完了後の開発用計測（モデル／秒／トークン／推定円） */
  usageLine?: string;
  /** false のときスロット＋解析ボタンのみ（レビュー画面表示中） */
  showPreview?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pickTargetRef = useRef<PageSlotId>(1);
  const active = activePage === 1 ? page1 : page2;

  const openPicker = (slot: PageSlotId) => {
    pickTargetRef.current = slot;
    fileRef.current?.click();
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPickFile(pickTargetRef.current, file);
          e.target.value = "";
        }}
      />

      <DualPageSlots
        activePage={activePage}
        onSelectPage={onSelectPage}
        page1Ready={Boolean(page1.colorUrl)}
        page2Ready={hasPage2}
        onPickPage={openPicker}
        onClearPage={onClearPage}
      />

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={analyzing || !canAnalyze}
          onClick={onAnalyze}
        >
          {analyzing
            ? "解析中…"
            : hasPage2
              ? "AI解析（2枚を1試合に統合）"
              : "AI解析"}
        </button>
      </div>

      {error ? (
        <div className="alert-error" role="alert">
          {error}
        </div>
      ) : null}
      {status ? <p className="muted">{status}</p> : null}
      {usageLine ? (
        <p
          className="muted"
          style={{
            fontSize: 11,
            lineHeight: 1.45,
            marginTop: 4,
            marginBottom: 8,
            opacity: 0.75,
            wordBreak: "break-word",
          }}
          data-testid="analyze-usage-meta"
        >
          {usageLine}
        </p>
      ) : null}

      {showPreview ? (
        <ScorePhotoPreview
          activePage={activePage}
          onSelectPage={onSelectPage}
          page1={page1}
          page2={page2}
          active={active}
          onSensitivityChange={onSensitivityChange}
        />
      ) : null}
    </>
  );
}

export function ScorePhotoPreview({
  activePage,
  onSelectPage,
  page1,
  page2,
  active,
  onSensitivityChange,
}: {
  activePage: PageSlotId;
  onSelectPage: (page: PageSlotId) => void;
  page1: PageImageState;
  page2: PageImageState;
  active: PageImageState;
  onSensitivityChange: (page: PageSlotId, value: RedSensitivity) => void;
}) {
  return (
    <div className="panel">
      <p className="section-label">PREVIEW</p>
      <h3 className="section-title" style={{ fontSize: "1.05rem" }}>
        画像プレビュー
      </h3>
      {page1.colorUrl && page2.colorUrl ? (
        <DualPagePreviewTabs
          activePage={activePage}
          onSelectPage={onSelectPage}
          page1Ready={Boolean(page1.colorUrl)}
          page2Ready={Boolean(page2.colorUrl)}
        />
      ) : page1.colorUrl || page2.colorUrl ? (
        <p className="muted" style={{ marginBottom: 10, fontSize: "0.8rem" }}>
          {activePage}枚目を表示中
          {page1.colorUrl && !page2.colorUrl ? "（2枚目は任意）" : ""}
        </p>
      ) : null}
      <ImagePreview
        // ページ切替・感度変更でもズーム／パンを維持するため key でアンマウントしない
        colorUrl={active.colorUrl}
        redUrl={active.redUrl}
        redSensitivity={active.redSensitivity}
        onRedSensitivityChange={
          active.colorUrl
            ? (value) => onSensitivityChange(activePage, value)
            : undefined
        }
        sensitivityBusy={active.sensitivityBusy}
        initialMode={active.redUrl ? "red" : "color"}
      />
    </div>
  );
}
