"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORIES, createId } from "@/lib/constants";
import { scoreboardFromMatch } from "@/lib/match-scoreboard";
import {
  clearMatchDraft,
  loadMatchDraft,
  saveMatchDraft,
} from "@/lib/storage";
import { estimateInningRunsFromPlayers, inferMatchResult } from "@/lib/stats";
import type {
  MatchRecord,
  MatchScoreboardState,
  MatchType,
  PlayerAtBat,
} from "@/lib/types";

type ToastFn = (message: string) => void;

/**
 * 試合メタ・スコアボード・打席・下書き・保存／呼び出しを担当。
 */
export function useMatchEditor(args: {
  editMatch?: MatchRecord | null;
  onEditMatchConsumed?: () => void;
  onSaveMatch: (match: MatchRecord) => void;
  showToast: ToastFn;
  setStatus: (message: string) => void;
  setError: (message: string) => void;
}) {
  const {
    editMatch,
    onEditMatchConsumed,
    onSaveMatch,
    showToast,
    setStatus,
    setError,
  } = args;

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
  const [players, setPlayers] = useState<PlayerAtBat[]>([]);
  const [savedMatch, setSavedMatch] = useState<MatchRecord | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createdAtRef = useRef<string>(new Date().toISOString());

  const ourScore = ourInnings.reduce((a, b) => a + b, 0);
  const theirScore = theirInnings.reduce((a, b) => a + b, 0);
  const isEditingSaved = Boolean(matchId);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!editMatch) return;
    loadMatchIntoEditor(editMatch);
    onEditMatchConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMatch]);

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

  const resetPlayersForNewPhotos = () => {
    setPlayers([]);
    setSavedMatch(null);
  };

  const applyAnalyzeResult = (args: {
    players: PlayerAtBat[];
    ourInnings: number[];
    matchDate?: string;
    opponent?: string;
  }) => {
    setPlayers(args.players);
    if (!matchId) {
      createdAtRef.current = new Date().toISOString();
    }
    if (args.matchDate) setMatchDate(String(args.matchDate).slice(0, 10));
    if (args.opponent) setOpponent(String(args.opponent));
    setOurInnings(args.ourInnings);
    setSavedMatch(null);
  };

  const confirmSave = () => {
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

  const syncOurInningsFromPlayers = (next: PlayerAtBat[]) => {
    setPlayers(next);
    setOurInnings(estimateInningRunsFromPlayers(next));
  };

  return {
    matchId,
    matchDate,
    setMatchDate,
    opponent,
    setOpponent,
    matchType,
    setMatchType,
    category,
    setCategory,
    ourInnings,
    setOurInnings,
    theirInnings,
    setTheirInnings,
    ourErrors,
    setOurErrors,
    theirErrors,
    setTheirErrors,
    theirHits,
    setTheirHits,
    players,
    savedMatch,
    ourScore,
    theirScore,
    isEditingSaved,
    resetPlayersForNewPhotos,
    applyAnalyzeResult,
    confirmSave,
    syncOurInningsFromPlayers,
  };
}
