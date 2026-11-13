"use client";

import { useEffect, useRef, useState } from "react";
import { AtBatMatrix } from "@/components/scan/AtBatMatrix";
import { HeroCard } from "@/components/scan/HeroCard";
import { ImagePreview } from "@/components/scan/ImagePreview";
import { MatchScoreboard } from "@/components/scan/MatchScoreboard";
import { CATEGORIES, MATCH_TYPES, createId } from "@/lib/constants";
import {
  DEFAULT_RED_SENSITIVITY,
  buildAnalyzeFormData,
  prepareAnalyzeImages,
  processScorebookImage,
  reprocessRedOnly,
  type RedSensitivity,
} from "@/lib/image-process";
import {
  countNeedsReview,
  estimateInningRunsFromPlayers,
  inferMatchResult,
} from "@/lib/stats";
import type { AppData, MatchRecord, MatchType, PlayerAtBat } from "@/lib/types";

export function ScanTab({
  data,
  onSaveMatch,
  onRequestConsent,
  consentAccepted,
}: {
  data: AppData;
  onSaveMatch: (match: MatchRecord) => void;
  onRequestConsent: () => Promise<boolean>;
  consentAccepted: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [matchDate, setMatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [opponent, setOpponent] = useState("");
  const [matchType, setMatchType] = useState<MatchType>("公式戦");
  const [category, setCategory] = useState<string>(CATEGORIES[1]);
  const [ourInnings, setOurInnings] = useState<number[]>(() => [0, 0, 0, 0, 0, 0, 0]);
  const [theirInnings, setTheirInnings] = useState<number[]>(() => [0, 0, 0, 0, 0, 0, 0]);
  const [ourErrors, setOurErrors] = useState(0);
  const [theirErrors, setTheirErrors] = useState(0);
  const [theirHits, setTheirHits] = useState(0);
  const [colorUrl, setColorUrl] = useState<string | null>(null);
  const [redUrl, setRedUrl] = useState<string | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [redSensitivity, setRedSensitivity] = useState<RedSensitivity>(DEFAULT_RED_SENSITIVITY);
  const [sensitivityBusy, setSensitivityBusy] = useState(false);
  const [players, setPlayers] = useState<PlayerAtBat[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [savedMatch, setSavedMatch] = useState<MatchRecord | null>(null);
  const [photoCompareOpen, setPhotoCompareOpen] = useState(false);
  const sensitivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSensitivityEffect = useRef(false);

  const ourScore = ourInnings.reduce((a, b) => a + b, 0);
  const theirScore = theirInnings.reduce((a, b) => a + b, 0);

  const onFile = async (file: File) => {
    setStatus("画像を前処理中（高コントラスト＋赤強調）…");
    setError("");
    setSavedMatch(null);
    setSourceFile(file);
    setRedSensitivity(DEFAULT_RED_SENSITIVITY);
    skipNextSensitivityEffect.current = true;
    try {
      const processed = await processScorebookImage(file, {
        redSensitivity: DEFAULT_RED_SENSITIVITY,
      });
      setColorUrl(processed.colorDataUrl);
      setRedUrl(processed.redDataUrl);
      setStatus(
        `前処理完了（${processed.width}×${processed.height}）。赤強調感度を調整してからAI解析できます。`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "画像処理に失敗しました");
      setStatus("");
    }
  };

  // 感度スライダー変更時に赤抽出だけ再処理（デバウンス）
  useEffect(() => {
    if (!sourceFile) return;
    if (skipNextSensitivityEffect.current) {
      skipNextSensitivityEffect.current = false;
      return;
    }
    if (sensitivityTimer.current) clearTimeout(sensitivityTimer.current);
    setSensitivityBusy(true);
    sensitivityTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const result = await reprocessRedOnly(sourceFile, redSensitivity);
          setRedUrl(result.redDataUrl);
          setStatus(`赤強調を更新しました（感度 ${Math.round(redSensitivity)}）。`);
          setError("");
        } catch (err) {
          setError(err instanceof Error ? err.message : "赤強調の再処理に失敗しました");
        } finally {
          setSensitivityBusy(false);
        }
      })();
    }, 60);
    return () => {
      if (sensitivityTimer.current) clearTimeout(sensitivityTimer.current);
    };
  }, [redSensitivity, sourceFile]);

  const analyze = async () => {
    if (!colorUrl || !redUrl) {
      setError("先にスコアブック写真をアップロードしてください");
      return;
    }
    if (!data.settings.geminiApiKey?.trim()) {
      // サーバー側の環境変数もあるため警告のみ。未設定ならサーバーが明確に返す
      setStatus("APIキー未入力の場合はサーバー環境変数を使用します…");
    }
    if (!consentAccepted) {
      const ok = await onRequestConsent();
      if (!ok) return;
    }

    setAnalyzing(true);
    setError("");
    setStatus("画像を圧縮して FormData 送信準備中…");
    try {
      const prepared = await prepareAnalyzeImages(colorUrl, redUrl);
      const approxMb = (prepared.approxBytes / (1024 * 1024)).toFixed(2);

      if (prepared.approxBytes > 1.5 * 1024 * 1024) {
        setError(
          `画像データが大きすぎます（約 ${approxMb}MB / 上限1.5MB）。別の写真で撮り直してください。`,
        );
        setStatus("");
        return;
      }

      setStatus(
        `Gemini で解析中…（FormData 約 ${approxMb}MB / 名簿→上下2グループ）`,
      );

      const form = buildAnalyzeFormData({
        images: prepared,
        roster: data.roster,
        matchMeta: { match_date: matchDate, opponent },
        apiKey: data.settings.geminiApiKey || undefined,
      });

      let res: Response;
      try {
        res = await fetch("/api/analyze-score", {
          method: "POST",
          body: form,
        });
      } catch (fetchErr) {
        const detail =
          fetchErr instanceof Error
            ? `${fetchErr.name}: ${fetchErr.message}`
            : String(fetchErr);
        throw new Error(
          `通信エラーが発生しました（${detail}）。サーバーが応答前に切断された可能性があります。再試行するか、画像を明るく撮り直してください。`,
        );
      }

      const rawText = await res.text();
      let json: {
        error?: string;
        detail?: string;
        players?: PlayerAtBat[];
        match_date?: string;
        opponent?: string;
        model?: string;
      };
      try {
        json = rawText ? (JSON.parse(rawText) as typeof json) : {};
      } catch {
        throw new Error(
          `サーバー応答の解析に失敗しました (HTTP ${res.status} ${res.statusText || ""})。本文: ${rawText.slice(0, 240) || "(空)"}`,
        );
      }

      if (!res.ok) {
        const extra = json.detail ? ` / ${json.detail}` : "";
        throw new Error(
          (json.error ||
            `解析に失敗しました (HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""})`) +
            extra,
        );
      }

      const nextPlayers = json.players || [];
      setPlayers(nextPlayers);
      if (json.match_date && json.match_date !== "-") setMatchDate(String(json.match_date).slice(0, 10));
      if (json.opponent && json.opponent !== "-") setOpponent(String(json.opponent));

      const estimated = estimateInningRunsFromPlayers(nextPlayers);
      if (estimated.some((n) => n > 0)) setOurInnings(estimated);
      setPhotoCompareOpen(false);

      const reviewCount = nextPlayers.reduce(
        (sum: number, p: PlayerAtBat) => sum + countNeedsReview(p),
        0,
      );
      const modelNote = json.model ? `（${json.model}）` : "";
      setStatus(
        reviewCount > 0
          ? `解析完了${modelNote}。要確認 ${reviewCount} マスがあります（黄色）。タップして修正してください。`
          : `解析完了${modelNote}。スコアボードと一覧を確認して確定してください。`,
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
      setError("確定する打席データがありません");
      return;
    }
    const match: MatchRecord = {
      id: createId("match"),
      match_date: matchDate,
      opponent: opponent || "不明",
      match_type: matchType,
      category,
      our_score: ourScore,
      their_score: theirScore,
      result: inferMatchResult(ourScore, theirScore),
      players,
      created_at: new Date().toISOString(),
    };
    onSaveMatch(match);
    setSavedMatch(match);
    setError("");
    setStatus("試合を保存しました。ヒーローカードを共有できます。");
  };

  return (
    <div className="fade-in">
      <div className="panel">
        <p className="section-label">AI SCORE READER</p>
        <h2 className="section-title">スコア読取＆修正</h2>
        <p className="muted">早稲田式スコアブックを撮影 → 赤抽出＋カラーで高精度解析</p>

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
            if (file) void onFile(file);
            e.target.value = "";
          }}
        />

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button type="button" className="btn btn-navy" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
            写真を選択 / 撮影
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={analyzing || !colorUrl}
            onClick={() => void analyze()}
          >
            {analyzing ? "解析中…" : "AI解析"}
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
          <ImagePreview
            colorUrl={colorUrl}
            redUrl={redUrl}
            redSensitivity={redSensitivity}
            onRedSensitivityChange={setRedSensitivity}
            sensitivityBusy={sensitivityBusy}
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
          />

          {photoCompareOpen ? (
            <div className="photo-compare">
              <ImagePreview
                colorUrl={colorUrl}
                redUrl={redUrl}
                redSensitivity={redSensitivity}
                onRedSensitivityChange={setRedSensitivity}
                sensitivityBusy={sensitivityBusy}
              />
            </div>
          ) : null}

          <div className="matrix-legend">
            <span className="matrix-legend-item">
              <i className="tone-swatch tone-hit" />安打
            </span>
            <span className="matrix-legend-item">
              <i className="tone-swatch tone-extra" />長打
            </span>
            <span className="matrix-legend-item">
              <i className="tone-swatch tone-review" />要確認
            </span>
            <span className="matrix-legend-item">● 得点</span>
          </div>

          <AtBatMatrix players={players} onChange={setPlayers} />
        </div>
      )}

      {savedMatch ? <HeroCard match={savedMatch} teamName={data.settings.teamName} /> : null}
    </div>
  );
}
