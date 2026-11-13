"use client";

export type PageSlotId = 1 | 2;

function PageSlotCard({
  title,
  subtitle,
  ready,
  pickLabel,
  onPick,
  onClear,
  selected,
  onSelect,
}: {
  title: string;
  subtitle: string;
  ready: boolean;
  pickLabel: string;
  onPick: () => void;
  onClear: () => void;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`dual-page-card${selected ? " selected" : ""}${ready ? " ready" : ""}`}
      role="group"
      aria-label={title}
    >
      <button type="button" className="dual-page-card-header" onClick={onSelect}>
        <div className="dual-page-card-titles">
          <strong className="dual-page-card-title">{title}</strong>
          <span className="dual-page-card-sub">{subtitle}</span>
        </div>
        <span className={`dual-page-badge${ready ? " on" : " off"}`}>
          {ready ? "セット済" : "未選択"}
        </span>
      </button>

      {ready ? (
        <div className="dual-page-card-actions">
          <button type="button" className="btn btn-navy dual-page-main-btn" onClick={onPick}>
            変更
          </button>
          <button type="button" className="btn btn-ghost dual-page-main-btn" onClick={onClear}>
            削除
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-navy dual-page-pick-btn" onClick={onPick}>
          {pickLabel}
        </button>
      )}
    </div>
  );
}

export function DualPageSlots({
  activePage,
  onSelectPage,
  page1Ready,
  page2Ready,
  onPickPage,
  onClearPage,
}: {
  activePage: PageSlotId;
  onSelectPage: (page: PageSlotId) => void;
  page1Ready: boolean;
  page2Ready: boolean;
  onPickPage: (page: PageSlotId) => void;
  onClearPage: (page: PageSlotId) => void;
}) {
  return (
    <div className="dual-page-slots">
      <div className="dual-page-grid">
        <PageSlotCard
          title="1枚目（前半）"
          subtitle="1〜4回前後"
          ready={page1Ready}
          pickLabel="1枚目を選択 / 撮影"
          onPick={() => onPickPage(1)}
          onClear={() => onClearPage(1)}
          selected={activePage === 1}
          onSelect={() => onSelectPage(1)}
        />
        <PageSlotCard
          title="2枚目（後半・任意）"
          subtitle="5〜7回前後"
          ready={page2Ready}
          pickLabel="2枚目を選択 / 撮影"
          onPick={() => onPickPage(2)}
          onClear={() => onClearPage(2)}
          selected={activePage === 2}
          onSelect={() => onSelectPage(2)}
        />
      </div>

      <p className="dual-page-hint muted">
        見開きなら左＝1枚目、右＝2枚目。1枚だけで完結する試合は1枚目のみでOKです。
      </p>
    </div>
  );
}

/** プレビュー上部の 1枚目 / 2枚目 切替 */
export function DualPagePreviewTabs({
  activePage,
  onSelectPage,
  page1Ready,
  page2Ready,
}: {
  activePage: PageSlotId;
  onSelectPage: (page: PageSlotId) => void;
  page1Ready: boolean;
  page2Ready: boolean;
}) {
  if (!page1Ready && !page2Ready) return null;

  return (
    <div className="dual-preview-tabs" role="tablist" aria-label="プレビュー切替">
      <button
        type="button"
        role="tab"
        aria-selected={activePage === 1}
        className={`dual-preview-tab${activePage === 1 ? " active" : ""}`}
        disabled={!page1Ready}
        onClick={() => onSelectPage(1)}
      >
        1枚目プレビュー
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activePage === 2}
        className={`dual-preview-tab${activePage === 2 ? " active" : ""}`}
        disabled={!page2Ready}
        onClick={() => onSelectPage(2)}
      >
        2枚目プレビュー
      </button>
    </div>
  );
}
