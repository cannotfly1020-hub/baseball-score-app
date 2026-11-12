"use client";

import * as XLSX from "xlsx";
import { compileMatchPlayers, aggregatePlayerStats } from "./stats";
import type { MatchRecord } from "./types";

export function downloadMatchesExcel(matches: MatchRecord[], fileName?: string): void {
  const wb = XLSX.utils.book_new();

  const allRows = matches.flatMap((m) =>
    compileMatchPlayers(m).map((r) => ({
      試合ID: r.match_id,
      試合日: r.match_date,
      対戦相手: r.opponent,
      試合種別: r.match_type,
      選手名: r.player_name,
      背番号: r.uniform_number,
      打席: r.plate_appearances,
      打数: r.at_bats,
      単打: r.singles,
      二塁打: r.doubles,
      三塁打: r.triples,
      本塁打: r.homeruns,
      総安打: r.hits,
      塁打: r.total_bases,
      四球: r.walks,
      死球: r.deadballs,
      三振: r.strikeouts,
      犠打: r.sacrifice_hits,
      犠飛: r.sacrifice_flies,
      打点: r.rbi,
      盗塁: r.stolen_bases,
    })),
  );

  const allSheet = XLSX.utils.json_to_sheet(
    allRows.length > 0 ? allRows : [{ message: "データなし" }],
  );
  XLSX.utils.book_append_sheet(wb, allSheet, "全打席成績一覧");

  const career = aggregatePlayerStats(matches);
  const careerRows = career.map((s) => ({
    選手名: s.player_name,
    背番号: s.uniform_numbers.join(", "),
    試合数: s.games,
    打席: s.plate_appearances,
    打数: s.at_bats,
    単打: s.singles,
    二塁打: s.doubles,
    三塁打: s.triples,
    本塁打: s.homeruns,
    総安打: s.hits,
    塁打: s.total_bases,
    打点: s.rbi,
    盗塁: s.stolen_bases,
    四球: s.walks,
    死球: s.deadballs,
    四死球: s.walks + s.deadballs,
    三振: s.strikeouts,
    犠打: s.sacrifice_hits,
    犠飛: s.sacrifice_flies,
    打率: s.avgDisplay,
    出塁率: s.obpDisplay,
    長打率: s.slgDisplay,
    OPS: s.ops.toFixed(3),
    称号: s.awards.join(" / "),
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(careerRows.length > 0 ? careerRows : [{ message: "データなし" }]),
    "選手通算成績",
  );

  const used = new Set(["全打席成績一覧", "選手通算成績"]);
  for (const s of career) {
    let title = s.player_name.slice(0, 28).replace(/[\\/?*[\]]/g, "_") || "player";
    let n = 1;
    const base = title;
    while (used.has(title)) {
      title = `${base.slice(0, 24)}_${n}`;
      n += 1;
    }
    used.add(title);
    const rows = allRows.filter((r) => r.選手名 === s.player_name);
    if (rows.length > 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), title);
    }
  }

  const matchSheet = XLSX.utils.json_to_sheet(
    matches.map((m) => ({
      試合日: m.match_date,
      対戦相手: m.opponent,
      試合種別: m.match_type,
      カテゴリ: m.category,
      自チーム: m.our_score,
      相手: m.their_score,
      結果: m.result,
    })),
  );
  XLSX.utils.book_append_sheet(wb, matchSheet, "試合一覧");

  XLSX.writeFile(wb, fileName || `scorebook_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
