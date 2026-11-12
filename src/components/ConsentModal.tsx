"use client";

export function ConsentModal({
  open,
  onAccept,
  onCancel,
}: {
  open: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="modal-card">
        <p className="section-label">プライバシー確認</p>
        <h2 id="consent-title" className="section-title">
          AI解析への同意
        </h2>
        <p className="muted" style={{ marginBottom: 14 }}>
          スコア解析のため画像を Google AI へ送信します（AIの学習には利用されません）。
          送信されるのはスコアブック写真と解析に必要な名簿情報のみです。
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={onCancel}>
            キャンセル
          </button>
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={onAccept}>
            同意して解析
          </button>
        </div>
      </div>
    </div>
  );
}
