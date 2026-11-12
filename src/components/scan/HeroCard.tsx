"use client";

import { useEffect, useRef, useState } from "react";
import type { MatchRecord } from "@/lib/types";

export function HeroCard({
  match,
  teamName,
}: {
  match: MatchRecord;
  teamName: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = 1080;
    const h = 1350;
    canvas.width = w;
    canvas.height = h;

    // background
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#0F172A");
    grad.addColorStop(0.55, "#1E293B");
    grad.addColorStop(1, "#7F1D1D");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // accent stripe
    ctx.fillStyle = "#DC2626";
    ctx.fillRect(0, 0, w, 18);

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.arc(w - 80, 120, 220, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#F8FAFC";
    ctx.font = "700 42px sans-serif";
    ctx.fillText("GAME RESULT", 64, 100);

    ctx.font = "600 36px sans-serif";
    ctx.fillStyle = "#FCA5A5";
    ctx.fillText(match.match_date || "-", 64, 160);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "800 64px sans-serif";
    ctx.fillText(teamName, 64, 280);

    ctx.font = "600 40px sans-serif";
    ctx.fillStyle = "#CBD5E1";
    ctx.fillText("VS", 64, 360);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "800 72px sans-serif";
    ctx.fillText(match.opponent || "対戦相手", 64, 450);

    // score box
    roundRect(ctx, 64, 520, w - 128, 280, 28);
    ctx.fillStyle = "rgba(15,23,42,0.55)";
    ctx.fill();

    ctx.fillStyle = "#F8FAFC";
    ctx.font = "800 120px sans-serif";
    const score = `${match.our_score}  -  ${match.their_score}`;
    ctx.fillText(score, 120, 700);

    ctx.font = "800 56px sans-serif";
    ctx.fillStyle = match.result === "勝" ? "#4ADE80" : match.result === "敗" ? "#F87171" : "#FDE68A";
    ctx.fillText(match.result, w - 220, 700);

    ctx.fillStyle = "#E2E8F0";
    ctx.font = "600 34px sans-serif";
    ctx.fillText(`${match.match_type}  /  ${match.category || "-"}`, 64, 880);

    const highlights = match.players
      .filter((p) => p.highlight)
      .slice(0, 3)
      .map((p) => `・${p.player_name}: ${p.highlight}`);
    ctx.fillStyle = "#F8FAFC";
    ctx.font = "500 30px sans-serif";
    let y = 960;
    if (highlights.length === 0) {
      ctx.fillText("スコアブックAI解析より自動生成", 64, y);
    } else {
      for (const line of highlights) {
        ctx.fillText(line.slice(0, 36), 64, y);
        y += 48;
      }
    }

    ctx.fillStyle = "#94A3B8";
    ctx.font = "500 26px sans-serif";
    ctx.fillText("学童野球スコアブック読取", 64, h - 60);

    setDataUrl(canvas.toDataURL("image/png"));
  }, [match, teamName]);

  const share = async () => {
    if (!dataUrl) return;
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], `result-${match.match_date || "game"}.png`, { type: "image/png" });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "試合結果",
        text: `${teamName} vs ${match.opponent} ${match.our_score}-${match.their_score}`,
      });
      return;
    }
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = file.name;
    a.click();
  };

  return (
    <div className="panel fade-in">
      <p className="section-label">LINE SHARE</p>
      <h3 className="section-title" style={{ fontSize: "1.05rem" }}>
        試合結果ヒーローカード
      </h3>
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dataUrl}
          alt="試合結果カード"
          style={{ width: "100%", borderRadius: 12, border: "1px solid var(--line)" }}
        />
      ) : null}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={share}>
          ダウンロード / 共有
        </button>
      </div>
    </div>
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
