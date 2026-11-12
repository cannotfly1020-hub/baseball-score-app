"use client";

import { useRef, useState } from "react";
import { AtBatGrid } from "@/components/scan/AtBatGrid";
import { HeroCard } from "@/components/scan/HeroCard";
import { ImagePreview } from "@/components/scan/ImagePreview";
import { CATEGORIES, MATCH_TYPES, createId } from "@/lib/constants";
import { dataUrlToBase64, processScorebookImage } from "@/lib/image-process";
import { countNeedsReview, inferMatchResult } from "@/lib/stats";
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
  const [ourScore, setOurScore] = useState(0);
  const [theirScore, setTheirScore] = useState(0);
  const [colorUrl, setColorUrl] = useState<string | null>(null);
  const [redUrl, setRedUrl] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerAtBat[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [status, setStatus] = useState("");
  const [savedMatch, setSavedMatch] = useState<MatchRecord | null>(null);

  const onFile = async (file: File) => {
    setStatus("画像を前処理中…");
    setSavedMatch(null);
    try {
      const processed = await processScorebookImage(file);
      setColorUrl(processed.colorDataUrl);
      setRedUrl(processed.redDataUrl);
      setStatus("前処理完了。AI解析を実行できます。");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "画像処理に失敗しました");
    }
  };

  const analyze = async () => {
    if (!colorUrl || !redUrl) {
      setStatus("先にスコアブック写真をアップロードしてください");
      return;
    }
    if (!consentAccepted) {
      const ok = await onRequestConsent();
      if (!ok) return;
    }

    setAnalyzing(true);
    setStatus("Gemini で2段階解析中…（名簿 → 打席）");
    try {
      const res = await fetch("/api/analyze-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          colorImageBase64: dataUrlToBase64(colorUrl),
          redImageBase64: dataUrlToBase64(redUrl),
          mimeType: "image/jpeg",
          apiKey: data.settings.geminiApiKey || undefined,
          roster: data.roster,
          matchMeta: { match_date: matchDate, opponent },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "解析に失敗しました");

      setPlayers(json.players || []);
      if (json.match_date && json.match_date !== "-") setMatchDate(String(json.match_date).slice(0, 10));
      if (json.opponent && json.opponent !== "-") setOpponent(String(json.opponent));

      const reviewCount = (json.players || []).reduce(
        (sum: number, p: PlayerAtBat) => sum + countNeedsReview(p),
        0,
      );
      setStatus(
        reviewCount > 0
          ? `解析完了。要確認 ${reviewCount} マスがあります（黄色）。タップして修正してください。`
          : "解析完了。内容を確認して確定してください。",
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "解析に失敗しました");
    } finally {
      setAnalyzing(false);
    }
  };

  const confirm = () => {
    if (players.length === 0) {
      setStatus("確定する打席データがありません");
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

        <div className="grid-2">
          <div className="field">
            <label>自チーム得点</label>
            <input
              type="number"
              min={0}
              value={ourScore}
              onChange={(e) => setOurScore(Number(e.target.value) || 0)}
            />
          </div>
          <div className="field">
            <label>相手得点</label>
            <input
              type="number"
              min={0}
              value={theirScore}
              onChange={(e) => setTheirScore(Number(e.target.value) || 0)}
            />
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

        {status ? <p className="muted">{status}</p> : null}
      </div>

      <div className="panel">
        <p className="section-label">PREVIEW</p>
        <h3 className="section-title" style={{ fontSize: "1.05rem" }}>
          画像プレビュー
        </h3>
        <ImagePreview colorUrl={colorUrl} redUrl={redUrl} />
      </div>

      <div className="panel">
        <p className="section-label">EDIT BOARD</p>
        <h3 className="section-title" style={{ fontSize: "1.05rem" }}>
          打席盤面の修正
        </h3>
        <AtBatGrid players={players} onChange={setPlayers} />
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: "100%", marginTop: 12 }}
          disabled={players.length === 0}
          onClick={confirm}
        >
          確定して保存
        </button>
      </div>

      {savedMatch ? <HeroCard match={savedMatch} teamName={data.settings.teamName} /> : null}
    </div>
  );
}
