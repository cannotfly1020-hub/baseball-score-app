"use client";

export type PageSlotId = 1 | 2;

export function DualPageSlots({
  activePage,
  onSelectPage,
  page1Ready,
  page2Ready,
  onPickPage,
  onClearPage2,
}: {
  activePage: PageSlotId;
  onSelectPage: (page: PageSlotId) => void;
  page1Ready: boolean;
  page2Ready: boolean;
  onPickPage: (page: PageSlotId) => void;
  onClearPage2: () => void;
}) {
  return (
    <div className="dual-page-slots">
      <div className="dual-page-tabs" role="tablist" aria-label="スコアブックページ">
        <button
          type="button"
          role="tab"
          aria-selected={activePage === 1}
          className={`dual-page-tab${activePage === 1 ? " active" : ""}`}
          onClick={() => onSelectPage(1)}
        >
          1枚目（前半）
          {page1Ready ? <span className="dual-page-badge">セット済</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activePage === 2}
          className={`dual-page-tab${activePage === 2 ? " active" : ""}`}
          onClick={() => onSelectPage(2)}
        >
          2枚目（後半・任意）
          {page2Ready ? <span className="dual-page-badge">セット済</span> : null}
        </button>
      </div>

      <div className="dual-page-actions">
        <button
          type="button"
          className="btn btn-navy"
          style={{ flex: 1 }}
          onClick={() => onPickPage(activePage)}
        >
          {activePage === 1 ? "1枚目を選択 / 撮影" : "2枚目を選択 / 撮影"}
        </button>
        {activePage === 2 && page2Ready ? (
          <button type="button" className="btn btn-ghost" onClick={onClearPage2}>
            2枚目をクリア
          </button>
        ) : null}
      </div>

      <p className="dual-page-hint muted">
        見開きなら左＝1枚目（1〜4回前後）、右＝2枚目（5〜7回前後）。1枚だけで完結する試合は1枚目のみでOKです。
      </p>
    </div>
  );
}
