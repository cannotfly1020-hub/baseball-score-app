import { RESULT_OPTIONS } from "./constants";
import type { RosterPlayer } from "./types";

const OFFICIAL_LABELS_CSV = RESULT_OPTIONS.filter((x) => x !== "なし")
  .map((x) => `"${x}"`)
  .join(", ");

export function formatRosterLines(roster: RosterPlayer[]): string {
  const lines: string[] = [];
  for (const row of roster) {
    const name = (row.player_name || "").trim();
    if (!name) continue;
    const nums = (row.uniform_number || "").trim() || "-";
    const note = (row.note || "").trim();
    const notePart = note ? `（備考:${note}）` : "";
    lines.push(`・${name}（背番号:${nums}）${notePart}`);
  }
  if (lines.length === 0) {
    return "・（名簿未登録：手書きのまま抽出し、判読不能は「未登録」とする）";
  }
  return lines.join("\n");
}

export const IMAGE_ROLES_PROMPT = `
### 画像の役割
1. 俯瞰（全体原本・赤強調）: 行・列位置の把握のみ。
2. グループ拡大（上1–5 / 下6–9 の原本＋赤強調）: **黒文字・赤ペン・得点丸はここから精密読取**。
3. 俯瞰で位置確認 → 拡大で確定。赤があるのに凡打/省略は禁止。
4. 確信度: はっきり読めたマスだけ公式ラベル。不明は "要確認"（推測禁止）。

### グリッド走査（精度維持・出力は省略可）
- 1番打者から順に、各行を左→右（1〜7回）で**全マスを内部走査**すること。
- 行ズレ・列ズレ禁止。最上段の印刷数字（1〜7）の真下をイニング基準とする。
- **出力では結果が無い空マス（未打席）は含めない**（"なし" を並べない）。走査自体は省略しない。

### 早稲田式・安打（菱形辺の赤なぞり）
- 黒菱形辺の上の赤インクを最優先（赤強調画像）。
- 単打=右下のみ / 二塁打=+右上 / 三塁打=+左上 / 本塁打=4辺。

### 【最優先・絶対厳守】得点（菱形中央の丸）と打点
1. **個人得点（scored）**:
   - 菱形**中央**の ●（塗り）または 〇（白抜）→ その打者はそのイニングで生還。
   - cell に scored:true。run_mark は ●→"filled" / 〇→"open"。
   - 頂点・枠外の点、アウトカウント付近の点、進塁丸数字は得点丸ではない。
2. **イニング得点**:
   - 各回の縦列にある菱形中央の ●/〇 総数 = inning_scores["1"〜"7"]。
   - 列内の scored:true 個数と完全一致させること。
3. **打点（rbi）**:
   - 同イニングの生還を生んだ打者の cell.rbi に割り振る（選手合計 rbi はその和）。
   - 本塁打・適時打・押し出し・犠飛・ゴロ間生還等は打点になり得る。
   - **打点にしない**: WP/PB/E のみの生還。
   - 判別困難なら rbi=0 か結果"要確認"。scored（生還丸）自体は落とさない。
`.trim();

export function buildRosterPrompt(roster: RosterPlayer[]): string {
  const rosterBlock = formatRosterLines(roster);
  return `
${IMAGE_ROLES_PROMPT}

### 名簿
${rosterBlock}

### 役割
左端の打順・背番号・選手名のみ抽出（イニングマス・得点欄は読まない）。
上段=先発 / 下段=交代は別オブジェクト。名簿照合→背番号アシスト。判読不能は「未登録」。推測補完禁止。

### 出力（JSON配列のみ・最小フィールド）
[{"batting_order":1,"uniform_number":"10","player_name":"山田","is_substitute":false}]
`.trim();
}

export function buildDetailsPrompt(rosterJson: string): string {
  return `
${IMAGE_ROLES_PROMPT}

### 役割
選手リストに基づき打席結果を判定。

### 選手リスト
${rosterJson}

### ルール要約
- 曖昧・かすれは "要確認"。全マス走査するが、空マスは出力しない。
- 黒: K=三振, B/四=四球, 死=死球, E=敵失, FC=野選, 5-3/4F等=凡打
- 赤辺なぞり: 単打/二塁打/三塁打/本塁打
- stolen_bases: S/ㄭ の個数。括弧数字は無視。

### 出力（スパース。空マス・理由文・highlight禁止）
公式ラベル: ${OFFICIAL_LABELS_CSV}
[{
  "batting_order":1,"uniform_number":"10","player_name":"山田","is_substitute":false,
  "stolen_bases":0,
  "at_bats":[
    {"inning":1,"result":"単打","scored":true,"run_mark":"filled","rbi":0,"dir":"中"},
    {"inning":3,"result":"要確認","lc":true}
  ]
}]
`.trim();
}

/**
 * 打順グループ（上下半分）の精密読取プロンプト（スリム出力）。
 */
export function buildGroupDetailsPrompt(args: {
  fromOrder: number;
  toOrder: number;
  roster: RosterPlayer[];
  rosterHints?: Array<{ batting_order: number; player_name: string; uniform_number: string }>;
  pageHint?: "single" | "first_half" | "second_half";
}): string {
  const rosterBlock = formatRosterLines(args.roster);
  const hintLines =
    args.rosterHints
      ?.filter((h) => h.batting_order >= args.fromOrder && h.batting_order <= args.toOrder)
      .map((h) => `・${h.batting_order}番: ${h.player_name}（背番号:${h.uniform_number || "-"}）`)
      .join("\n") || "・（ヒントなし。左端＋名簿で確定）";

  const pageHintBlock =
    args.pageHint === "first_half"
      ? `
### ページ（前半）
主に1〜4回。後半が空白なら出力しない（推測埋め禁止）。`
      : args.pageHint === "second_half"
        ? `
### ページ（後半）
主に5〜7回。前半空白は出力しない。代打は is_substitute:true。`
        : "";

  return `
${IMAGE_ROLES_PROMPT}

### 役割
打順 ${args.fromOrder}〜${args.toOrder} を精密読取。細字・赤ペンは拡大画像から。
${pageHintBlock}

### 名簿
${rosterBlock}

### ヒント
${hintLines}

### 対象
- 打順 ${args.fromOrder}〜${args.toOrder} のみ
- 全マス走査。**結果があるマスだけ at_bats に出力**（空=未打席は配列に入れない）
- 交代は is_substitute:true の別オブジェクト

### 記号
黒: K=三振, B/四=四球, 死=死球, WP=振り逃げ, E=敵失, FC=野選, 1-3/5-3/4F/F/G=凡打
赤辺: 右下=単打 / +右上=二塁打 / +左上=三塁打 / 4辺=本塁打

### 得点・打点（論理は厳守・出力は最小）
- 菱形中央 ●/〇 → scored:true, run_mark filled/open
- 縦列の ●/〇 個数 = inning_scores
- 打点は cell.rbi（WP/PB/Eのみ生還は0）

### 出力ルール（トークン削減・精度維持）
- JSONオブジェクト1つのみ。解説文・reason・highlight・空マス禁止。
- at_bats の各要素: inning, result 必須。scored/run_mark/rbi/dir は該当時のみ。lc は低確信度のときのみ true。
- result は次のみ: ${OFFICIAL_LABELS_CSV}
- 選手合計 rbi は出力不要（サーバが cell.rbi から集計）

### 出力例
{
  "inning_scores":{"1":1,"2":0,"3":0,"4":0,"5":0,"6":0,"7":0},
  "players":[{
    "batting_order":${args.fromOrder},
    "uniform_number":"10",
    "player_name":"山田",
    "is_substitute":false,
    "stolen_bases":0,
    "at_bats":[
      {"inning":1,"result":"単打","scored":true,"run_mark":"filled","rbi":0,"dir":"中"},
      {"inning":3,"result":"要確認","lc":true}
    ]
  }]
}
`.trim();
}

/** @deprecated 互換用。グループ解析へ移行済み */
export function buildRowDetailsPrompt(args: {
  battingOrder: number;
  roster: RosterPlayer[];
  hintPlayerName?: string;
  hintUniform?: string;
}): string {
  return buildGroupDetailsPrompt({
    fromOrder: args.battingOrder,
    toOrder: args.battingOrder,
    roster: args.roster,
    rosterHints: args.hintPlayerName
      ? [
          {
            batting_order: args.battingOrder,
            player_name: args.hintPlayerName,
            uniform_number: args.hintUniform || "",
          },
        ]
      : [],
  });
}
