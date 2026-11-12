"use client";

import { useMemo, useState } from "react";
import { MATCH_TYPES } from "@/lib/constants";
import { aggregatePlayerStats } from "@/lib/stats";
import type { AppData, MatchType } from "@/lib/types";

type SortKey =
  | "avg"
  | "obp"
  | "ops"
  | "hits"
  | "total_bases"
  | "rbi"
  | "stolen_bases"
  | "strikeouts";

export function StatsTab({ data }: { data: AppData }) {
  const [types, setTypes] = useState<MatchType[]>([...MATCH_TYPES]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("avg");

  const stats = useMemo(() => {
    const list = aggregatePlayerStats(data.matches, {
      matchTypes: types,
      from: from || undefined,
      to: to || undefined,
    });
    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return bv - av;
      return 0;
    });
  }, [data.matches, types, from, to, sortKey]);

  const toggleType = (t: MatchType) => {
    setTypes((prev) => {
      if (prev.includes(t)) {
        const next = prev.filter((x) => x !== t);
        return next.length === 0 ? [...MATCH_TYPES] : next;
      }
      return [...prev, t];
    });
  };

  return (
    <div className="fade-in">
      <div className="panel">
        <p className="section-label">PLAYER STATS</p>
        <h2 className="section-title">選手成績＆称号</h2>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {MATCH_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={`btn ${types.includes(t) ? "btn-navy" : "btn-ghost"}`}
              style={{ padding: "7px 10px", fontSize: "0.78rem" }}
              onClick={() => toggleType(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="grid-2">
          <div className="field">
            <label>開始日</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>終了日</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>並び替え</label>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            <option value="avg">打率</option>
            <option value="obp">出塁率</option>
            <option value="ops">OPS</option>
            <option value="hits">安打</option>
            <option value="total_bases">長打（塁打）</option>
            <option value="rbi">打点</option>
            <option value="stolen_bases">盗塁</option>
            <option value="strikeouts">三振</option>
          </select>
        </div>
      </div>

      {stats.length === 0 ? (
        <div className="panel">
          <p className="muted">表示できる成績がありません。</p>
        </div>
      ) : (
        stats.map((s, i) => (
          <div key={s.player_name} className="panel fade-in" style={{ animationDelay: `${i * 0.03}s` }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>{s.player_name}</div>
                <div className="muted">
                  #{s.uniform_numbers.join(",") || "-"} · {s.games}試合
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", fontWeight: 700 }}>
                  {s.avgDisplay}
                </div>
                <div className="muted">打率</div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 6,
                marginTop: 10,
                textAlign: "center",
              }}
            >
              <MiniStat label="出塁" value={s.obpDisplay} />
              <MiniStat label="OPS" value={s.ops.toFixed(3)} />
              <MiniStat label="安打" value={String(s.hits)} />
              <MiniStat label="打点" value={String(s.rbi)} />
              <MiniStat label="盗塁" value={String(s.stolen_bases)} />
              <MiniStat label="塁打" value={String(s.total_bases)} />
              <MiniStat label="三振" value={String(s.strikeouts)} />
              <MiniStat label="四死球" value={String(s.walks + s.deadballs)} />
            </div>

            {s.awards.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {s.awards.map((a) => (
                  <span key={a} className="badge badge-award">
                    {a}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "8px 4px", border: "1px solid var(--line)" }}>
      <div className="muted" style={{ fontSize: "0.65rem" }}>
        {label}
      </div>
      <div style={{ fontWeight: 800 }}>{value}</div>
    </div>
  );
}
