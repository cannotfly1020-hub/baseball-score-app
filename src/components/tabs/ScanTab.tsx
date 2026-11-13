"use client";

import { useState } from "react";
import { HeroCard } from "@/components/scan/HeroCard";
import { MatchMetaForm } from "@/components/scan/MatchMetaForm";
import { MatchReviewPanel } from "@/components/scan/MatchReviewPanel";
import {
  ScorePhotoPreview,
  ScorePhotoUploader,
} from "@/components/scan/ScorePhotoUploader";
import { useDualPageImages } from "@/hooks/useDualPageImages";
import { useMatchEditor } from "@/hooks/useMatchEditor";
import { analyzeScorePage } from "@/lib/analyze-client";
import {
  formatAnalyzeUsageLine,
  mergeAnalyzeUsageMeta,
  type AnalyzeUsageMeta,
} from "@/lib/analyze-meta";
import type { AnalyzePageHint } from "@/lib/image-process";
import { mergeScorebookPages } from "@/lib/page-merge";
import { countNeedsReview } from "@/lib/stats";
import type { AppData, MatchRecord } from "@/lib/types";

/**
 * スコア読取タブのオーケストレータ。
 * 写真／レビュー／試合セッションの責務は各フック・子コンポーネントへ委譲。
 */
export function ScanTab({
  data,
  onSaveMatch,
  onRequestConsent,
  consentAccepted,
  editMatch,
  onEditMatchConsumed,
  onOpenHistory,
}: {
  data: AppData;
  onSaveMatch: (match: MatchRecord) => void;
  onRequestConsent: () => Promise<boolean>;
  consentAccepted: boolean;
  editMatch?: MatchRecord | null;
  onEditMatchConsumed?: () => void;
  onOpenHistory?: () => void;
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [usageMeta, setUsageMeta] = useState<AnalyzeUsageMeta | null>(null);
  const [photoCompareOpen, setPhotoCompareOpen] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const match = useMatchEditor({
    editMatch,
    onEditMatchConsumed,
    onSaveMatch,
    showToast,
    setStatus,
    setError,
  });

  const pages = useDualPageImages({ setStatus, setError });

  const analyze = async () => {
    if (!pages.canAnalyze) {
      setError("先に1枚目のスコアブック写真をアップロードしてください");
      return;
    }
    if (!data.settings.geminiApiKey?.trim()) {
      setStatus("APIキー未入力の場合はサーバー環境変数を使用します…");
    }
    if (!consentAccepted) {
      const ok = await onRequestConsent();
      if (!ok) return;
    }

    setAnalyzing(true);
    setError("");
    setUsageMeta(null);
    try {
      const dual = pages.hasPage2;
      const firstHint: AnalyzePageHint = dual ? "first_half" : "single";
      const page1Result = await analyzeScorePage({
        page: pages.page1,
        pageHint: firstHint,
        label: "1枚目",
        roster: data.roster,
        matchMeta: { match_date: match.matchDate, opponent: match.opponent },
        apiKey: data.settings.geminiApiKey || undefined,
        onStatus: setStatus,
      });

      let page2Result = null as Awaited<ReturnType<typeof analyzeScorePage>> | null;
      if (dual) {
        setStatus("1枚目完了。続けて2枚目を解析します…");
        page2Result = await analyzeScorePage({
          page: pages.page2,
          pageHint: "second_half",
          label: "2枚目",
          roster: data.roster,
          matchMeta: { match_date: match.matchDate, opponent: match.opponent },
          apiKey: data.settings.geminiApiKey || undefined,
          onStatus: setStatus,
        });
      }

      const mergedMeta = mergeAnalyzeUsageMeta([
        page1Result.meta,
        page2Result?.meta,
      ]);
      setUsageMeta(mergedMeta);
      if (mergedMeta) {
        console.info("[ScanTab] analyze usage meta", mergedMeta);
      }

      const merged = mergeScorebookPages(
        page1Result.players || [],
        page2Result?.players || [],
      );

      const dateCandidate =
        (page1Result.match_date && page1Result.match_date !== "-"
          ? page1Result.match_date
          : "") ||
        (page2Result?.match_date && page2Result.match_date !== "-"
          ? page2Result.match_date
          : "");
      const opponentCandidate =
        (page1Result.opponent && page1Result.opponent !== "-"
          ? page1Result.opponent
          : "") ||
        (page2Result?.opponent && page2Result.opponent !== "-"
          ? page2Result.opponent
          : "");

      match.applyAnalyzeResult({
        players: merged.players,
        ourInnings: merged.ourInnings,
        matchDate: dateCandidate || undefined,
        opponent: opponentCandidate || undefined,
      });
      setPhotoCompareOpen(false);
      pages.setActivePage(1);

      const reviewCount = merged.players.reduce(
        (sum, p) => sum + countNeedsReview(p),
        0,
      );
      const models = [page1Result.model, page2Result?.model].filter(Boolean);
      const modelNote = models.length ? `（${models.join(" / ")}）` : "";
      const mergeNote = dual
        ? ` 2枚を1試合に統合（イニング割当: ${Object.entries(merged.inningSources)
            .map(([k, v]) => `${k}回→${v}枚目`)
            .join("、")}）。`
        : "";
      setStatus(
        reviewCount > 0
          ? `解析完了${modelNote}。${mergeNote}要確認 ${reviewCount} マスがあります（黄色）。`
          : `解析完了${modelNote}。${mergeNote}内容を確認して保存してください。`,
      );
      setError("");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `解析に失敗しました（${String(err)}）`;
      setError(message);
      setStatus("");
      console.error("[ScanTab] analyze failed", err);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className={`fade-in${match.players.length > 0 ? " has-save-footer" : ""}`}>
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}

      <div className="panel">
        <p className="section-label">AI SCORE READER</p>
        <h2 className="section-title">スコア読取＆修正</h2>
        <p className="muted">
          見開き2枚までセット可能 → 赤抽出＋カラーで1試合に自動統合
          {match.isEditingSaved ? "（保存済み試合を再編集中）" : ""}
        </p>

        <button
          type="button"
          className="btn btn-ghost"
          style={{ width: "100%", marginBottom: 12 }}
          onClick={() => onOpenHistory?.()}
        >
          保存済みの試合を呼び出す（履歴）
        </button>

        <MatchMetaForm
          matchDate={match.matchDate}
          opponent={match.opponent}
          matchType={match.matchType}
          category={match.category}
          onMatchDateChange={match.setMatchDate}
          onOpponentChange={match.setOpponent}
          onMatchTypeChange={match.setMatchType}
          onCategoryChange={match.setCategory}
        />

        <ScorePhotoUploader
          activePage={pages.activePage}
          onSelectPage={pages.setActivePage}
          page1={pages.page1}
          page2={pages.page2}
          hasPage2={pages.hasPage2}
          canAnalyze={pages.canAnalyze}
          analyzing={analyzing}
          onPickFile={(slot, file) => {
            match.resetPlayersForNewPhotos();
            setPhotoCompareOpen(false);
            void pages.loadFileForPage(slot, file);
          }}
          onClearPage={pages.clearPage}
          onSensitivityChange={pages.setSensitivity}
          onAnalyze={() => void analyze()}
          error={error}
          status={status}
          usageLine={usageMeta ? formatAnalyzeUsageLine(usageMeta) : ""}
          showPreview={false}
        />
      </div>

      {match.players.length === 0 ? (
        <ScorePhotoPreview
          activePage={pages.activePage}
          onSelectPage={pages.setActivePage}
          page1={pages.page1}
          page2={pages.page2}
          active={pages.active}
          onSensitivityChange={pages.setSensitivity}
        />
      ) : (
        <MatchReviewPanel
          teamName={data.settings.teamName || "自チーム"}
          opponent={match.opponent}
          ourInnings={match.ourInnings}
          theirInnings={match.theirInnings}
          ourErrors={match.ourErrors}
          theirErrors={match.theirErrors}
          theirHits={match.theirHits}
          players={match.players}
          roster={data.roster}
          isEditingSaved={match.isEditingSaved}
          photoCompareOpen={photoCompareOpen}
          onTogglePhoto={() => setPhotoCompareOpen((v) => !v)}
          onConfirm={match.confirmSave}
          onOurInningChange={(i, v) =>
            match.setOurInnings((prev) => prev.map((n, idx) => (idx === i ? v : n)))
          }
          onTheirInningChange={(i, v) =>
            match.setTheirInnings((prev) => prev.map((n, idx) => (idx === i ? v : n)))
          }
          onOurErrorsChange={match.setOurErrors}
          onTheirErrorsChange={match.setTheirErrors}
          onTheirHitsChange={match.setTheirHits}
          onPlayersChange={match.syncOurInningsFromPlayers}
          activePage={pages.activePage}
          onSelectPage={pages.setActivePage}
          page1={pages.page1}
          page2={pages.page2}
          onSensitivityChange={pages.setSensitivity}
        />
      )}

      {match.savedMatch ? (
        <HeroCard match={match.savedMatch} teamName={data.settings.teamName} />
      ) : null}

      {match.players.length > 0 ? (
        <div className="save-footer">
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: "100%" }}
            onClick={match.confirmSave}
          >
            {match.isEditingSaved ? "上書き保存する（確定）" : "試合データを保存する（確定）"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
