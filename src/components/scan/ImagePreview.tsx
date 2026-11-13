"use client";

import { Maximize2, Minimize2, RotateCcw, RotateCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import {
  DEFAULT_RED_SENSITIVITY,
  type RedSensitivity,
  sensitivityLabel,
} from "@/lib/image-process";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function roundZoom(z: number) {
  return Number(clamp(z, MIN_ZOOM, MAX_ZOOM).toFixed(2));
}

type Point = { x: number; y: number };

/**
 * スコアブック画像の原本／赤抽出プレビュー。
 * ピンチ・ホイール・ボタンで 1〜4 倍ズーム、ドラッグ／スワイプでパン。
 * モード切替・感度変更でもズーム／パン位置を維持する。
 */
export function ImagePreview({
  colorUrl,
  redUrl,
  redSensitivity = DEFAULT_RED_SENSITIVITY,
  onRedSensitivityChange,
  sensitivityBusy = false,
  initialMode = "color",
}: {
  colorUrl: string | null;
  redUrl: string | null;
  redSensitivity?: RedSensitivity;
  onRedSensitivityChange?: (value: RedSensitivity) => void;
  sensitivityBusy?: boolean;
  initialMode?: "color" | "red";
}) {
  const [mode, setMode] = useState<"color" | "red">(initialMode);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);

  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  panRef.current = pan;
  zoomRef.current = zoom;

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const pinchRef = useRef<{
    dist0: number;
    zoom0: number;
    mid0: Point;
    pan0: Point;
  } | null>(null);

  const lastTapRef = useRef(0);

  const clampPan = useCallback((next: Point, z: number): Point => {
    const el = viewportRef.current;
    if (!el || z <= 1) return { x: 0, y: 0 };
    const { clientWidth: w, clientHeight: h } = el;
    // 拡大後に枠の半分程度までは動かせる（完全に消えない）
    const maxX = (w * (z - 1)) / 2 + 24;
    const maxY = (h * (z - 1)) / 2 + 24;
    return {
      x: clamp(next.x, -maxX, maxX),
      y: clamp(next.y, -maxY, maxY),
    };
  }, []);

  const setZoomAround = useCallback(
    (nextZoom: number, clientX?: number, clientY?: number) => {
      const z0 = zoomRef.current;
      const z1 = roundZoom(nextZoom);
      if (z1 === z0) return;
      const el = viewportRef.current;
      if (!el || clientX == null || clientY == null) {
        setZoom(z1);
        setPan((p) => clampPan(p, z1));
        return;
      }
      const rect = el.getBoundingClientRect();
      const cx = clientX - rect.left - rect.width / 2;
      const cy = clientY - rect.top - rect.height / 2;
      const p0 = panRef.current;
      // カーソル位置を基準にパンを補正
      const scale = z1 / z0;
      const nextPan = {
        x: cx - (cx - p0.x) * scale,
        y: cy - (cy - p0.y) * scale,
      };
      setZoom(z1);
      setPan(clampPan(nextPan, z1));
    },
    [clampPan],
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // 感度や URL が変わってもズームは維持。枠サイズ変化時のみパンを再クランプ。
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setPan((p) => clampPan(p, zoomRef.current));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [clampPan]);

  // wheel は passive:false が必要なため ref で登録
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoomAround(zoomRef.current + delta, e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setZoomAround]);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === "touch") return; // タッチは touch ハンドラへ
    if (zoomRef.current <= 1) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: panRef.current.x,
      originY: panRef.current.y,
    };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setPan(
      clampPan(
        {
          x: drag.originX + (e.clientX - drag.startX),
          y: drag.originY + (e.clientY - drag.startY),
        },
        zoomRef.current,
      ),
    );
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  const touchDistance = (a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) =>
    Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  const onTouchStart = (e: ReactTouchEvent) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      pinchRef.current = {
        dist0: touchDistance(a, b),
        zoom0: zoomRef.current,
        mid0: {
          x: (a.clientX + b.clientX) / 2,
          y: (a.clientY + b.clientY) / 2,
        },
        pan0: { ...panRef.current },
      };
      dragRef.current = null;
      return;
    }
    if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapRef.current < 280) {
        // ダブルタップ: 拡大 ↔ リセット
        lastTapRef.current = 0;
        if (zoomRef.current > 1.05) resetView();
        else setZoomAround(2.5, e.touches[0].clientX, e.touches[0].clientY);
        return;
      }
      lastTapRef.current = now;
      if (zoomRef.current > 1) {
        dragRef.current = {
          pointerId: -1,
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          originX: panRef.current.x,
          originY: panRef.current.y,
        };
      }
    }
  };

  const onTouchMove = (e: ReactTouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = touchDistance(a, b);
      const ratio = dist / Math.max(1, pinchRef.current.dist0);
      const mid = {
        x: (a.clientX + b.clientX) / 2,
        y: (a.clientY + b.clientY) / 2,
      };
      setZoomAround(pinchRef.current.zoom0 * ratio, mid.x, mid.y);
      return;
    }
    if (e.touches.length === 1 && dragRef.current && zoomRef.current > 1) {
      e.preventDefault();
      const t = e.touches[0];
      const drag = dragRef.current;
      setPan(
        clampPan(
          {
            x: drag.originX + (t.clientX - drag.startX),
            y: drag.originY + (t.clientY - drag.startY),
          },
          zoomRef.current,
        ),
      );
    }
  };

  const onTouchEnd = () => {
    if (pinchRef.current) pinchRef.current = null;
    dragRef.current = null;
  };

  const src = mode === "color" ? colorUrl : redUrl;
  if (!src && !colorUrl && !redUrl) {
    return (
      <div className="preview-frame">
        <p className="muted" style={{ color: "#cbd5e1", padding: 16, textAlign: "center" }}>
          スコアブック写真をアップロードすると
          <br />
          原本 / 赤抽出プレビューが表示されます
        </p>
      </div>
    );
  }

  const canPan = zoom > 1;

  return (
    <div className="image-preview">
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button
          type="button"
          className={`btn ${mode === "color" ? "btn-navy" : "btn-ghost"}`}
          style={{ flex: 1, padding: "8px 10px" }}
          onClick={() => setMode("color")}
        >
          原本
        </button>
        <button
          type="button"
          className={`btn ${mode === "red" ? "btn-primary" : "btn-ghost"}`}
          style={{ flex: 1, padding: "8px 10px" }}
          onClick={() => setMode("red")}
        >
          赤抽出
        </button>
      </div>

      <div
        className={`preview-frame preview-viewport${canPan ? " is-pannable" : ""}`}
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <button
          type="button"
          className="preview-reset-btn"
          aria-label="全体表示に戻す"
          title="全体表示に戻す"
          onClick={(e) => {
            e.stopPropagation();
            resetView();
          }}
        >
          <RotateCcw size={14} />
          リセット
        </button>

        <div
          className="preview-stage"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={(mode === "color" ? colorUrl : redUrl) || colorUrl || redUrl || ""}
            alt={mode === "color" ? "加工なし高解像度カラー原本" : "赤強調画像"}
            draggable={false}
            style={{
              opacity: mode === "red" && sensitivityBusy ? 0.55 : 1,
            }}
          />
        </div>

        <div className="preview-zoom-badge" aria-live="polite">
          {zoom.toFixed(2).replace(/\.?0+$/, "")}×
        </div>
      </div>

      {onRedSensitivityChange ? (
        <div className="sensitivity-panel">
          <div className="sensitivity-header">
            <span className="sensitivity-title">赤強調の感度</span>
            <span className="sensitivity-value">
              {sensitivityLabel(redSensitivity)}（{Math.round(redSensitivity)}）
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={redSensitivity}
            aria-label="赤強調の感度"
            onChange={(e) => {
              const next = Number(e.target.value);
              if (mode !== "red") setMode("red");
              onRedSensitivityChange(next);
            }}
            className="sensitivity-slider"
          />
          <div className="sensitivity-labels">
            <span>弱</span>
            <span>標準</span>
            <span>強</span>
          </div>
          <p className="muted" style={{ marginTop: 6, fontSize: "0.75rem" }}>
            ピンチ／ホイールで拡大、ドラッグで移動。感度変更でもズーム位置は維持されます。
            {sensitivityBusy ? " 再処理中…" : ""}
          </p>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ flex: 1 }}
          onClick={() => setZoomAround(zoom + ZOOM_STEP)}
        >
          <Maximize2 size={16} style={{ display: "inline", verticalAlign: "middle" }} /> ＋
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ flex: 1 }}
          onClick={() => setZoomAround(zoom - ZOOM_STEP)}
        >
          <Minimize2 size={16} style={{ display: "inline", verticalAlign: "middle" }} /> −
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ flex: 1 }}
          onClick={resetView}
        >
          <RotateCcw size={16} style={{ display: "inline", verticalAlign: "middle" }} /> 全体
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ flex: 1 }}
          onClick={() => setRotation((r) => (r + 90) % 360)}
        >
          <RotateCw size={16} style={{ display: "inline", verticalAlign: "middle" }} /> 回転
        </button>
      </div>
    </div>
  );
}
