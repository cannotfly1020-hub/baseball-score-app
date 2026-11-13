"use client";

import { Maximize2, Minimize2, RotateCw } from "lucide-react";
import { useState } from "react";
import {
  DEFAULT_RED_SENSITIVITY,
  type RedSensitivity,
  sensitivityLabel,
} from "@/lib/image-process";

export function ImagePreview({
  colorUrl,
  redUrl,
  redSensitivity = DEFAULT_RED_SENSITIVITY,
  onRedSensitivityChange,
  sensitivityBusy = false,
}: {
  colorUrl: string | null;
  redUrl: string | null;
  redSensitivity?: RedSensitivity;
  onRedSensitivityChange?: (value: RedSensitivity) => void;
  sensitivityBusy?: boolean;
}) {
  const [mode, setMode] = useState<"color" | "red">("color");
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const src = mode === "color" ? colorUrl : redUrl;
  if (!src) {
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

  return (
    <div>
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

      <div className="preview-frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={mode === "color" ? "鮮鋭化カラー原本" : "赤色抽出画像"}
          style={{
            transform: `scale(${zoom}) rotate(${rotation}deg)`,
            opacity: mode === "red" && sensitivityBusy ? 0.55 : 1,
          }}
        />
      </div>

      {mode === "red" && onRedSensitivityChange ? (
        <div className="sensitivity-panel">
          <div className="sensitivity-header">
            <span className="sensitivity-title">赤強調の強度</span>
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
            aria-label="赤強調の強度"
            onChange={(e) => onRedSensitivityChange(Number(e.target.value))}
            className="sensitivity-slider"
          />
          <div className="sensitivity-labels">
            <span>原本 (0)</span>
            <span>自然 (50)</span>
            <span>最大 (100)</span>
          </div>
          <p className="muted" style={{ marginTop: 6, fontSize: "0.75rem" }}>
            線の細さはそのまま、赤みのある画素の彩度だけを上げます（ベタ塗りなし）。0は加工なし。見やすい位置にしてから「AI解析」を押してください。
            {sensitivityBusy ? " 再処理中…" : ""}
          </p>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ flex: 1 }}
          onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.25).toFixed(2))))}
        >
          <Maximize2 size={16} style={{ display: "inline", verticalAlign: "middle" }} /> 拡大
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ flex: 1 }}
          onClick={() => setZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}
        >
          <Minimize2 size={16} style={{ display: "inline", verticalAlign: "middle" }} /> 縮小
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
