"use client";

import { useEffect, useRef, useState } from "react";
import type { PageSlotId } from "@/components/scan/DualPageSlots";
import {
  DEFAULT_RED_SENSITIVITY,
  processScorebookImage,
  reprocessRedOnly,
  type RedSensitivity,
} from "@/lib/image-process";
import { emptyPageImage, type PageImageState } from "@/lib/page-image-state";

type StatusHandlers = {
  setStatus: (message: string) => void;
  setError: (message: string) => void;
};

/**
 * 1枚目／2枚目の画像選択・赤強調感度・再処理を担当するフック。
 */
export function useDualPageImages({ setStatus, setError }: StatusHandlers) {
  const [page1, setPage1] = useState<PageImageState>(() => emptyPageImage());
  const [page2, setPage2] = useState<PageImageState>(() => emptyPageImage());
  const [activePage, setActivePage] = useState<PageSlotId>(1);
  const skipSens1 = useRef(false);
  const skipSens2 = useRef(false);
  const timer1 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timer2 = useRef<ReturnType<typeof setTimeout> | null>(null);

  const active = activePage === 1 ? page1 : page2;
  const hasPage2 = Boolean(page2.colorUrl && page2.redUrl);
  const canAnalyze = Boolean(page1.colorUrl && page1.redUrl);

  const setSensitivity = (slot: PageSlotId, value: RedSensitivity) => {
    if (slot === 1) setPage1((prev) => ({ ...prev, redSensitivity: value }));
    else setPage2((prev) => ({ ...prev, redSensitivity: value }));
  };

  const clearPage = (slot: PageSlotId) => {
    if (slot === 1) {
      setPage1(emptyPageImage());
      setActivePage(page2.colorUrl ? 2 : 1);
      setStatus("1枚目を削除しました。");
      return;
    }
    setPage2(emptyPageImage());
    setActivePage(1);
    setStatus("2枚目を削除しました。1枚目のみで解析できます。");
  };

  const loadFileForPage = async (slot: PageSlotId, file: File) => {
    setStatus(`${slot}枚目を前処理中（高コントラスト＋赤強調）…`);
    setError("");
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
      setter(emptyPageImage());
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
  }, [page1.redSensitivity, page1.sourceFile, setError, setStatus]);

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
  }, [page2.redSensitivity, page2.sourceFile, setError, setStatus]);

  return {
    page1,
    page2,
    activePage,
    setActivePage,
    active,
    hasPage2,
    canAnalyze,
    setSensitivity,
    clearPage,
    loadFileForPage,
  };
}
