"use client";

import { Maximize2, Minimize2, RotateCw } from "lucide-react";
import { useState } from "react";

export function ImagePreview({
  colorUrl,
  redUrl,
}: {
  colorUrl: string | null;
  redUrl: string | null;
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
          style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
        />
      </div>

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
