"use client";

import { useEffect, useRef, useState } from "react";
import { AtBatMatrix } from "@/components/scan/AtBatMatrix";
import {
  DualPagePreviewTabs,
  DualPageSlots,
  type PageSlotId,
} from "@/components/scan/DualPageSlots";
import { HeroCard } from "@/components/scan/HeroCard";
import { ImagePreview } from "@/components/scan/ImagePreview";
import { MatchScoreboard } from "@/components/scan/MatchScoreboard";
import { CATEGORIES, MATCH_TYPES, createId } from "@/lib/constants";
import { ANALYZE_MAX_PAYLOAD_BYTES, ANALYZE_TARGET_PAYLOAD_BYTES } from "@/lib/constants";
import {
  DEFAULT_RED_SENSITIVITY,
  buildAnalyzeFormData,
  prepareAnalyzeImages,
  processScorebookImage,
  reprocessRedOnly,
  type AnalyzePageHint,
  type RedSensitivity,
} from "@/lib/image-process";
import { mergeScorebookPages } from "@/lib/page-merge";
import {
  countNeedsReview,
  estimateInningRunsFromPlayers,
  inferMatchResult,
} from "@/lib/stats";
import {
  clearMatchDraft,
  loadMatchDraft,
  saveMatchDraft,
} from "@/lib/storage";
import type {
  AppData,
  MatchRecord,
  MatchScoreboardState,
  MatchType,
  PlayerAtBat,
} from "@/lib/types";

type PageImageState = {
  sourceFile: File | null;
  colorUrl: string | null;
  redUrl: string | null;
  redSensitivity: RedSensitivity;
  sensitivityBusy: boolean;
};

function emptyPage(): PageImageState {
  return {
    sourceFile: null,
    colorUrl: null,
    redUrl: null,
    redSensitivity: DEFAULT_RED_SENSITIVITY,
    sensitivityBusy: false,
  };
}

function emptyScoreboard(): MatchScoreboardState {
  return {
    ourInnings: [0, 0, 0, 0, 0, 0, 0],
    theirInnings: [0, 0, 0, 0, 0, 0, 0],
    ourErrors: 0,
    theirErrors: 0,
    theirHits: 0,
  };
}

function scoreboardFromMatch(match: MatchRecord): MatchScoreboardState {
  if (match.scoreboard) {
    return {
      ourInnings: [...match.scoreboard.ourInnings],
      theirInnings: [...match.scoreboard.theirInnings],
      ourErrors: match.scoreboard.ourErrors,
      theirErrors: match.scoreboard.theirErrors,
      theirHits: match.scoreboard.theirHits,
    };
  }
  const sb = emptyScoreboard();
  sb.ourInnings[0] = match.our_score;
  sb.theirInnings[0] = match.their_score;
  return sb;
}

type AnalyzeJson = {
  error?: string;
  detail?: string;
  players?: PlayerAtBat[];
  match_date?: string;
  opponent?: string;
  model?: string;
  inningScores?: number[];
  inningScoresMatched?: boolean;
};

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
  const fileRef = useRef<HTMLInputElement>(null);
  const pickTargetRef = useRef<PageSlotId>(1);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [matchDate, setMatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [opponent, setOpponent] = useState("");
  const [matchType, setMatchType] = useState<MatchType>("公式戦");
  const [category, setCategory] = useState<string>(CATEGORIES[1]);
  const [ourInnings, setOurInnings] = useState<number[]>(() => [0, 0, 0, 0, 0, 0, 0]);
  const [theirInnings, setTheirInnings] = useState<number[]>(() => [0, 0, 0, 0, 0, 0, 0]);
  const [ourErrors, setOurErrors] = useState(0);
  const [theirErrors, setTheirErrors] = useState(0);
  const [theirHits, setTheirHits] = useState(0);
  const [page1, setPage1] = useState<PageImageState>(() => emptyPage());
  const [page2, setPage2] = useState<PageImageState>(() => emptyPage());
  const [activePage, setActivePage] = useState<PageSlotId>(1);
  const [players, setPlayers] = useState<PlayerAtBat[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [savedMatch, setSavedMatch] = useState<MatchRecord | null>(null);
  const [photoCompareOpen, setPhotoCompareOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const skipSens1 = useRef(false);
  const skipSens2 = useRef(false);
  const timer1 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timer2 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createdAtRef = useRef<string>(new Date().toISOString());

  const ourScore = ourInnings.reduce((a, b) => a + b, 0);
  const theirScore = theirInnings.reduce((a, b) => a + b, 0);
  const isEditingSaved = Boolean(matchId);
  const active = activePage === 1 ? page1 : page2;
  const hasPage2 = Boolean(page2.colorUrl && page2.redUrl);
  const canAnalyze = Boolean(page1.colorUrl && page1.redUrl);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const applyScoreboard = (sb: MatchScoreboardState) => {
    setOurInnings([...sb.ourInnings]);
    setTheirInnings([...sb.theirInnings]);
    setOurErrors(sb.ourErrors);
    setTheirErrors(sb.theirErrors);
    setTheirHits(sb.theirHits);
  };

  const loadMatchIntoEditor = (match: MatchRecord) => {
    setMatchId(match.id);
    createdAtRef.current = match.created_at;
    setMatchDate(match.match_date);
    setOpponent(match.opponent);
    setMatchType(match.match_type);
    setCategory(match.category);
    const nextPlayers = match.players.map((p) => ({ ...p, innings: { ...p.innings } }));
    setPlayers(nextPlayers);
    applyScoreboard({
      ...scoreboardFromMatch(match),
      ourInnings: estimateInningRunsFromPlayers(nextPlayers),
    });
    setSavedMatch(null);
    setPhotoCompareOpen(false);
    setError("");
    setStatus(`「vs ${match.opponent}」を読み込みました。修正後に保存できます。`);
  };

  useEffect(() => {
    const draft = loadMatchDraft();
    if (draft && draft.players.length > 0) {
      setMatchId(draft.matchId);
      setMatchDate(draft.match_date);
      setOpponent(draft.opponent);
      setMatchType(draft.match_type);
      setCategory(draft.category);
      setPlayers(draft.players);
      applyScoreboard({
        ...draft.scoreboard,
        ourInnings: estimateInningRunsFromPlayers(draft.players),
      });
      setStatus("下書きを復元しました。続きから編集できます。");
      showToast("下書きを復元しました");
    }
    setDraftReady(true);
  }, []);

  useEffect(() => {
    if (!editMatch) return;
    loadMatchIntoEditor(editMatch);
    onEditMatchConsumed?.();
  }, [editMatch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!draftReady) return;
    if (players.length === 0) {
      clearMatchDraft();
      return;
    }
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      saveMatchDraft({
        matchId,
        match_date: matchDate,
        opponent,
        match_type: matchType,
        category,
        players,
        scoreboard: {
          ourInnings,
          theirInnings,
          ourErrors,
          theirErrors,
          theirHits,
        },
        updated_at: new Date().toISOString(),
      });
    }, 500);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [
    draftReady,
    matchId,
    matchDate,
    opponent,
    matchType,
    category,
    players,
    ourInnings,
    theirInnings,
    ourErrors,
    theirErrors,
    theirHits,
  ]);

  const onFileForPage = async (slot: PageSlotId, file: File) => {
    setStatus(`${slot}枚目を前処理中（高コントラスト＋赤強調）…`);
    setError("");
    setSavedMatch(null);
    setPlayers([]);
    setPhotoCompareOpen(false);
    setActivePage(slot);

    const setter = slot === 1 ? setPage1 : setPage2;
    if (slot === 1) skipSens1.current = true;
    else skipSens2.current = true;

    setter({
      sourceFile: file,
      colorUrl: null,
      redUrl: null,
      redSensitivity: DEFAULT_RED_SENSITIVITY,
      sensitivityBusy: false,
    });

    try {
      const processed = await processScorebookImage(file, {
        redSensitivity: DEFAULT_RED_SENSITIVITY,
      });
      setter({
        sourceFile: file,
        colorUrl: processed.colorDataUrl,
        redUrl: processed.redDataUrl,
        redSensitivity: DEFAULT_RED_SENSITIVITY,
        sensitivityBusy: false,
      });
      setStatus(
        `${slot}枚目の前処理完了（${processed.width}×${processed.height}）。感度（標準）を調整し、必要なら2枚目もセットしてからAI解析してください。`,
      );
    } catch (err) {
      setter(emptyPage());
      setError(err instanceof Error ? err.message : "画像処理に失敗しました");
      setStatus("");
    }
  };

  useEffect(() => {
    if (!page1.sourceFile) return;
    if (skipSens1.current) {
      skipSens1.current = false;
      return;
    }
    if (timer1.current) clearTimeout(timer1.current);
    setPage1((prev) => ({ ...prev, sensitivityBusy: true }));
    timer1.current = setTimeout(() => {
      void (async () => {
        try {
          const result = await reprocessRedOnly(page1.sourceFile!, page1.redSensitivity);
          setPage1((prev) => ({
            ...prev,
            redUrl: result.redDataUrl,
            sensitivityBusy: false,
          }));
          setStatus(`1枚目の赤強調を更新（感度 ${Math.round(page1.redSensitivity)}）。`);
          setError("");
        } catch (err) {
          setPage1((prev) => ({ ...prev, sensitivityBusy: false }));
          setError(err instanceof Error ? err.message : "1枚目の赤強調再処理に失敗しました");
        }
      })();
    }, 60);
    return () => {
      if (timer1.current) clearTimeout(timer1.current);
    };
  }, [page1.redSensitivity, page1.sourceFile]);

  useEffect(() => {
    if (!page2.sourceFile) return;
    if (skipSens2.current) {
      skipSens2.current = false;
      return;
    }
    if (timer2.current) clearTimeout(timer2.current);
    setPage2((prev) => ({ ...prev, sensitivityBusy: true }));
    timer2.current = setTimeout(() => {
      void (async () => {
        try {
          const result = await reprocessRedOnly(page2.sourceFile!, page2.redSensitivity);
          setPage2((prev) => ({
            ...prev,
            redUrl: result.redDataUrl,
            sensitivityBusy: false,
          }));
          setStatus(`2枚目の赤強調を更新（感度 ${Math.round(page2.redSensitivity)}）。`);
          setError("");
        } catch (err) {
          setPage2((prev) => ({ ...prev, sensitivityBusy: false }));
          setError(err instanceof Error ? err.message : "2枚目の赤強調再処理に失敗しました");
        }
      })();
    }, 60);
    return () => {
      if (timer2.current) clearTimeout(timer2.current);
    };
  }, [page2.redSensitivity, page2.sourceFile]);

  const analyzeOnePage = async (
    page: PageImageState,
    pageHint: AnalyzePageHint,
    label: string,
  ): Promise<AnalyzeJson> => {
    if (!page.colorUrl || !page.redUrl) {
      throw new Error(`${label}の画像がありません`);
    }
    const prepared = await prepareAnalyzeImages(page.colorUrl, page.redUrl, {
      maxBytes: ANALYZE_TARGET_PAYLOAD_BYTES,
    });
    const approxMb = (prepared.approxBytes / (1024 * 1024)).toFixed(2);
    if (prepared.approxBytes > ANALYZE_MAX_PAYLOAD_BYTES) {
      throw new Error(
        `${label}の画像が大きすぎます（約 ${approxMb}MB / 上限1.5MB・目標1.2MB）。別の写真で撮り直してください。`,
      );
    }

    setStatus(`${label}を Gemini で解析中…（FormData 約 ${approxMb}MB・直列送信）`);

    const form = buildAnalyzeFormData({
      images: prepared,
      roster: data.roster,
      matchMeta: { match_date: matchDate, opponent },
      apiKey: data.settings.geminiApiKey || undefined,
      pageHint,
    });

    let res: Response;
    try {
      // タイムアウト付き fetch（サーバ切断を Failed to fetch のまま放置しない）
      const controller = new AbortController();
      const timeoutMs = 280_000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        res = await fetch("/api/analyze-score", {
          method: "POST",
          body: form,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (fetchErr) {
      const detail =
        fetchErr instanceof Error
          ? `${fetchErr.name}: ${fetchErr.message}`
          : String(fetchErr);
      throw new Error(
        `${label}の通信エラー（${detail}）。サーバーが応答前に切断された可能性があります。画像を小さくして再試行してください。`,
      );
    }

    const rawText = await res.text();
    let json: AnalyzeJson;
    try {
      json = rawText ? (JSON.parse(rawText) as AnalyzeJson) : {};
    } catch {
      throw new Error(
        `${label}: サーバー応答の解析に失敗 (HTTP ${res.status}). ${rawText.slice(0, 200)}`,
      );
    }
    if (!res.ok) {
      const extra = json.detail ? ` / ${json.detail}` : "";
      throw new Error(
        (json.error || `${label}の解析に失敗 (HTTP ${res.status})`) + extra,
      );
    }
    return json;
  };

  const analyze = async () => {
    if (!canAnalyze) {
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
    try {
      // 2枚セット時も完全直列: 1枚目完了→2枚目（並列禁止）
      const dual = hasPage2;
      const firstHint: AnalyzePageHint = dual ? "first_half" : "single";
      const page1Result = await analyzeOnePage(page1, firstHint, "1枚目");

      let page2Result: AnalyzeJson | null = null;
      if (dual) {
        setStatus("1枚目完了。続けて2枚目を解析します…");
        page2Result = await analyzeOnePage(page2, "second_half", "2枚目");
      }

      const merged = mergeScorebookPages(
        page1Result.players || [],
        page2Result?.players || [],
      );
      const nextPlayers = merged.players;
      setPlayers(nextPlayers);
      if (!matchId) {
        createdAtRef.current = new Date().toISOString();
      }

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
      if (dateCandidate) setMatchDate(String(dateCandidate).slice(0, 10));
      if (opponentCandidate) setOpponent(String(opponentCandidate));

      setOurInnings(merged.ourInnings);
      setPhotoCompareOpen(false);
      setActivePage(1);
      setSavedMatch(null);

      const reviewCount = nextPlayers.reduce(
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

  const confirm = () => {
    if (players.length === 0) {
      setError("保存する打席データがありません");
      return;
    }
    const now = new Date().toISOString();
    const match: MatchRecord = {
      id: matchId || createId("match"),
      match_date: matchDate,
      opponent: opponent || "不明",
      match_type: matchType,
      category,
      our_score: ourScore,
      their_score: theirScore,
      result: inferMatchResult(ourScore, theirScore),
      players,
      scoreboard: {
        ourInnings: [...ourInnings],
        theirInnings: [...theirInnings],
        ourErrors,
        theirErrors,
        theirHits,
      },
      created_at: matchId ? createdAtRef.current : now,
      updated_at: now,
    };
    onSaveMatch(match);
    setMatchId(match.id);
    setSavedMatch(match);
    clearMatchDraft();
    setError("");
    setStatus(
      isEditingSaved
        ? "試合データを上書き保存しました。成績・履歴に反映済みです。"
        : "試合データを保存しました。成績・履歴に反映済みです。",
    );
    showToast("保存しました！");
  };

  const openPicker = (slot: PageSlotId) => {
    pickTargetRef.current = slot;
    fileRef.current?.click();
  };

  const clearPage = (slot: PageSlotId) => {
    if (slot === 1) {
      setPage1(emptyPage());
      setActivePage(page2.colorUrl ? 2 : 1);
      setStatus("1枚目を削除しました。");
      return;
    }
    setPage2(emptyPage());
    setActivePage(1);
    setStatus("2枚目を削除しました。1枚目のみで解析できます。");
  };

  return (
    <div className={`fade-in${players.length > 0 ? " has-save-footer" : ""}`}>
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
          {isEditingSaved ? "（保存済み試合を再編集中）" : ""}
        </p>

        <button
          type="button"
          className="btn btn-ghost"
          style={{ width: "100%", marginBottom: 12 }}
          onClick={() => onOpenHistory?.()}
        >
          保存済みの試合を呼び出す（履歴）
        </button>

        <div className="grid-2">
          <div className="field">
            <label>試合日</label>
            <input type="date" value={matchDate} onChange={(e) => setMatchDate(e.target.value)} />
          </div>
          <div className="field">
            <label>対戦相手</label>
            <input value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="〇〇少年野球" />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>試合種別</label>
            <select value={matchType} onChange={(e) => setMatchType(e.target.value as MatchType)}>
              {MATCH_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>カテゴリ</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFileForPage(pickTargetRef.current, file);
            e.target.value = "";
          }}
        />

        <DualPageSlots
          activePage={activePage}
          onSelectPage={setActivePage}
          page1Ready={Boolean(page1.colorUrl)}
          page2Ready={hasPage2}
          onPickPage={openPicker}
          onClearPage={clearPage}
        />

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={analyzing || !canAnalyze}
            onClick={() => void analyze()}
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
      </div>

      {players.length === 0 ? (
        <div className="panel">
          <p className="section-label">PREVIEW</p>
          <h3 className="section-title" style={{ fontSize: "1.05rem" }}>
            画像プレビュー
          </h3>
          {(page1.colorUrl || page2.colorUrl) && (page1.colorUrl && page2.colorUrl) ? (
            <DualPagePreviewTabs
              activePage={activePage}
              onSelectPage={setActivePage}
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
            key={`${activePage}-${active.colorUrl ? "ready" : "empty"}`}
            colorUrl={active.colorUrl}
            redUrl={active.redUrl}
            redSensitivity={active.redSensitivity}
            onRedSensitivityChange={
              active.colorUrl
                ? (value) => {
                    if (activePage === 1) {
                      setPage1((prev) => ({ ...prev, redSensitivity: value }));
                    } else {
                      setPage2((prev) => ({ ...prev, redSensitivity: value }));
                    }
                  }
                : undefined
            }
            sensitivityBusy={active.sensitivityBusy}
            initialMode={active.redUrl ? "red" : "color"}
          />
        </div>
      ) : (
        <div className="panel review-panel">
          <p className="section-label">MATCH BOARD</p>
          <h3 className="section-title" style={{ fontSize: "1.05rem", marginBottom: 10 }}>
            試合確認・1タップ修正
          </h3>

          <MatchScoreboard
            teamName={data.settings.teamName || "自チーム"}
            opponent={opponent}
            ourInnings={ourInnings}
            theirInnings={theirInnings}
            ourErrors={ourErrors}
            theirErrors={theirErrors}
            theirHits={theirHits}
            players={players}
            onOurInningChange={(i, v) =>
              setOurInnings((prev) => prev.map((n, idx) => (idx === i ? v : n)))
            }
            onTheirInningChange={(i, v) =>
              setTheirInnings((prev) => prev.map((n, idx) => (idx === i ? v : n)))
            }
            onOurErrorsChange={setOurErrors}
            onTheirErrorsChange={setTheirErrors}
            onTheirHitsChange={setTheirHits}
            onConfirm={confirm}
            onTogglePhoto={() => setPhotoCompareOpen((v) => !v)}
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
                  onSelectPage={setActivePage}
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
                    ? (value) => {
                        if (activePage === 1) {
                          setPage1((prev) => ({ ...prev, redSensitivity: value }));
                        } else {
                          setPage2((prev) => ({ ...prev, redSensitivity: value }));
                        }
                      }
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

          <AtBatMatrix
            players={players}
            roster={data.roster}
            onChange={(next) => {
              setPlayers(next);
              setOurInnings(estimateInningRunsFromPlayers(next));
            }}
          />
        </div>
      )}

      {savedMatch ? <HeroCard match={savedMatch} teamName={data.settings.teamName} /> : null}

      {players.length > 0 ? (
        <div className="save-footer">
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: "100%" }}
            onClick={confirm}
          >
            {isEditingSaved ? "上書き保存する（確定）" : "試合データを保存する（確定）"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
