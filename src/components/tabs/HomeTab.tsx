"use client";

import { tripleCrown } from "@/lib/awards";
import { aggregatePlayerStats, teamRecord } from "@/lib/stats";
import type { AppData } from "@/lib/types";

export function HomeTab({ data }: { data: AppData }) {
  const record = teamRecord(data.matches);
  const recent = [...data.matches]
    .sort((a, b) => b.match_date.localeCompare(a.match_date))
    .slice(0, 3);
  const stats = aggregatePlayerStats(data.matches);
  const crown = tripleCrown(stats);

  return (
    <div className="fade-in">
      <div className="stat-hero">
        <div className="section-label" style={{ color: "#FCA5A5" }}>
          TEAM DASHBOARD
        </div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: "1.35rem", fontWeight: 700, marginTop: 4 }}>
          {data.settings.teamName}
        </div>
        <div className="score-pill" style={{ marginTop: 12, position: "relative", zIndex: 1 }}>
          <span>
            {record.wins}
            <small style={{ fontSize: "0.9rem" }}>勝</small>
          </span>
          <span>
            {record.losses}
            <small style={{ fontSize: "0.9rem" }}>敗</small>
          </span>
          <span>
            {record.draws}
            <small style={{ fontSize: "0.9rem" }}>分</small>
          </span>
        </div>
        <div style={{ marginTop: 8, opacity: 0.85, position: "relative", zIndex: 1 }}>
          勝率 {record.winRateDisplay} · 試合数 {data.matches.length}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <p className="section-label">RECENT GAMES</p>
        <h2 className="section-title">直近の試合</h2>
        {recent.length === 0 ? (
          <p className="muted">まだ試合がありません。AI読取タブからスコアブックを取り込みましょう。</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {recent.map((m) => (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 0",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>vs {m.opponent}</div>
                  <div className="muted">
                    {m.match_date} · {m.match_type}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", fontWeight: 700 }}>
                    {m.our_score}-{m.their_score}
                  </div>
                  <span className="badge">{m.result}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <p className="section-label">TRIPLE CROWN</p>
        <h2 className="section-title">チーム三冠王</h2>
        <div className="grid-2" style={{ gridTemplateColumns: "1fr" }}>
          <CrownRow title="打率" player={crown.avg?.player_name} value={crown.avg?.avgDisplay} />
          <CrownRow title="打点" player={crown.rbi?.player_name} value={crown.rbi ? String(crown.rbi.rbi) : undefined} />
          <CrownRow
            title="盗塁"
            player={crown.sb?.player_name}
            value={crown.sb ? String(crown.sb.stolen_bases) : undefined}
          />
        </div>
      </div>
    </div>
  );
}

function CrownRow({
  title,
  player,
  value,
}: {
  title: string;
  player?: string;
  value?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 12px",
        borderRadius: 12,
        background: "#f8fafc",
        border: "1px solid var(--line)",
        marginBottom: 8,
      }}
    >
      <div>
        <div className="muted" style={{ fontSize: "0.72rem", fontWeight: 700 }}>
          {title}
        </div>
        <div style={{ fontWeight: 700 }}>{player || "—"}</div>
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", fontWeight: 700, color: "var(--crimson)" }}>
        {value || ".---"}
      </div>
    </div>
  );
}
