"use client";

import { DualPagePreviewTabs, type PageSlotId } from "@/components/scan/DualPageSlots";
import { BattingMatrixTable } from "@/components/scan/BattingMatrixTable";
import { ImagePreview } from "@/components/scan/ImagePreview";
import { ScoreboardHeader } from "@/components/scan/ScoreboardHeader";
import type { PageImageState } from "@/lib/page-image-state";
import type { RedSensitivity } from "@/lib/image-process";
import type { PlayerAtBat, RosterPlayer } from "@/lib/types";

/**
 * 解析後のスコアボード＋写真見比べ＋打撃マトリクス担当。
 */
export function MatchReviewPanel({
  teamName,
  opponent,
  ourInnings,
  theirInnings,
  ourErrors,
  theirErrors,
  theirHits,
  players,
  roster,
  isEditingSaved,
  photoCompareOpen,
  onTogglePhoto,
  onConfirm,
  onOurInningChange,
  onTheirInningChange,
  onOurErrorsChange,
  onTheirErrorsChange,
  onTheirHitsChange,
  onPlayersChange,
  activePage,
  onSelectPage,
  page1,
  page2,
  onSensitivityChange,
}: {
  teamName: string;
  opponent: string;
  ourInnings: number[];
  theirInnings: number[];
  ourErrors: number;
  theirErrors: number;
  theirHits: number;
  players: PlayerAtBat[];
  roster: RosterPlayer[];
  isEditingSaved: boolean;
  photoCompareOpen: boolean;
  onTogglePhoto: () => void;
  onConfirm: () => void;
  onOurInningChange: (index: number, value: number) => void;
  onTheirInningChange: (index: number, value: number) => void;
  onOurErrorsChange: (value: number) => void;
  onTheirErrorsChange: (value: number) => void;
  onTheirHitsChange: (value: number) => void;
  onPlayersChange: (players: PlayerAtBat[]) => void;
  activePage: PageSlotId;
  onSelectPage: (page: PageSlotId) => void;
  page1: PageImageState;
  page2: PageImageState;
  onSensitivityChange: (page: PageSlotId, value: RedSensitivity) => void;
}) {
  const active = activePage === 1 ? page1 : page2;

  return (
    <div className="panel review-panel">
      <p className="section-label">MATCH BOARD</p>
      <h3 className="section-title" style={{ fontSize: "1.05rem", marginBottom: 10 }}>
        試合確認・1タップ修正
      </h3>

      <ScoreboardHeader
        teamName={teamName}
        opponent={opponent}
        ourInnings={ourInnings}
        theirInnings={theirInnings}
        ourErrors={ourErrors}
        theirErrors={theirErrors}
        theirHits={theirHits}
        players={players}
        onOurInningChange={onOurInningChange}
        onTheirInningChange={onTheirInningChange}
        onOurErrorsChange={onOurErrorsChange}
        onTheirErrorsChange={onTheirErrorsChange}
        onTheirHitsChange={onTheirHitsChange}
        onConfirm={onConfirm}
        onTogglePhoto={onTogglePhoto}
        photoOpen={photoCompareOpen}
        canConfirm={players.length > 0}
        confirmLabel={
          isEditingSaved ? "上書き保存する（確定）" : "試合データを保存する（確定）"
        }
        syncOurRunsFromScored
      />

      {photoCompareOpen ? (
        <div className="photo-compare">
          {page1.colorUrl || page2.colorUrl ? (
            <DualPagePreviewTabs
              activePage={activePage}
              onSelectPage={onSelectPage}
              page1Ready={Boolean(page1.colorUrl)}
              page2Ready={Boolean(page2.colorUrl)}
            />
          ) : (
            <p className="muted" style={{ marginBottom: 8 }}>
              このセッションに写真がありません。新規撮影すると見比べできます。
            </p>
          )}
          <ImagePreview
            key={`compare-${activePage}-${active.colorUrl || "none"}`}
            colorUrl={active.colorUrl}
            redUrl={active.redUrl}
            redSensitivity={active.redSensitivity}
            onRedSensitivityChange={
              active.sourceFile
                ? (value) => onSensitivityChange(activePage, value)
                : undefined
            }
            sensitivityBusy={active.sensitivityBusy}
            initialMode="red"
          />
        </div>
      ) : null}

      <div className="matrix-legend">
        <span className="matrix-legend-item">
          <i className="tone-swatch tone-hit" />
          安打
        </span>
        <span className="matrix-legend-item">
          <i className="tone-swatch tone-extra" />
          長打
        </span>
        <span className="matrix-legend-item">
          <i className="tone-swatch tone-review" />
          要確認
        </span>
        <span className="matrix-legend-item">● 得点</span>
        <span className="matrix-legend-item">選手名タップで編集</span>
      </div>

      <BattingMatrixTable players={players} roster={roster} onChange={onPlayersChange} />
    </div>
  );
}
