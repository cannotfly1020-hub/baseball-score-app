import io
import json
from google import genai
from google.genai import types
import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
import pandas as pd
import streamlit as st

st.set_page_config(
    page_title="学童野球スコア集計＆卒団アルバム",
    page_icon="⚾️",
    layout="wide",
)

if "records" not in st.session_state:
    st.session_state.records = []

api_key = st.secrets.get("GEMINI_API_KEY")
if not api_key:
    api_key = st.sidebar.text_input("管理者APIキー (Gemini)", type="password")

client = genai.Client(api_key=api_key) if api_key else None

SYSTEM_PROMPT = """
あなたは学童野球の手書きスコアブック（早稲田式）の打席明細記録員です。
選手の大切な卒団記録となるため、推測・捏造・適当な補完は一切許されません。
合計の集計計算はシステムが行うため、あなたは【各イニングのマス目に何が書かれているか】を1打席ずつ客観的に言語化して抽出してください。

【最重要：選手名・背番号の厳格な分離（二段書きの選手交代）】
- 打順欄に上下二段で名前がある場合、背番号が異なれば完全に別人の選手です。
  必ず「先発選手（上段）」と「交代選手（下段）」を別々の選手オブジェクトとして出力してください。
  （例: 9番枠の背番号19と背番号21は別人）
- 先発選手: 交代前のイニング（1〜3回など）の打席のみを at_bats_details に含める。
- 交代選手: 赤字で「代打」「PH」「L」とある打席、または4回以降の交代後の打席のみを含める。

【赤ペン表記の厳格ルール】
1. 赤線のダイヤモンド結線（安打種別・進塁）:
   - hit_type は "single"（単打/1H）, "double"（2塁打/2H）, "triple"（3塁打/3H）, "homerun"（本塁打/HR）, "none"（安打なし）から選択。
   - 右下一辺のみ赤線: hit_type="single"
   - 二塁（上頂点）まで連続赤線: hit_type="double"
   - 三塁（左頂点）まで連続赤線: hit_type="triple"（例: 4番打者）
   - ダイヤモンドを赤線でぐるっと一周: 本塁生還のため is_run=true（得点）。
     ※出塁が四球(B)や死球(DB)、凡打・失策等の場合は後続による生還なので hit_type="none"、is_run=true。
     ※自身の打撃で一周した場合のみ hit_type="homerun"、is_run=true。

2. 赤い波線（クネクネした区切り線）:
   - 打席付近にある赤い波線（例: 5番打者付近）は「相手投手の交代」を示す区切り線です。打撃結果ではありません。

3. 括弧書き数字「(数字)」の除外:
   - 「(6)」「(8)」「(9)」等は、その打順の選手の打撃で走者が進塁したことを示す「進塁責任打者」の記録です。打者本人の打撃結果や守備番号ではありません。

4. 凡打・三振記号:
   - 「K」「Ⓚ」: 三振（result="三振"）
   - 「四」「B」: 四球（result="四球"）
   - 「DB」「死」: 死球（result="死球"）
   - 「3A」「1A」「4-3」等: 内野ゴロ・凡打（result="凡打"）
   - 丸囲み数字（①②③）: その回のアウトカウント

【出力フォーマット（JSON配列のみ返却）】
各選手の各打席を言語化したリストとして出力してください。合計値の計算は不要です。
[
  {
    "match_date": "試合日（不明なら UNREADABLE）",
    "opponent": "相手チーム名（不明なら UNREADABLE）",
    "batting_order": 打順番号,
    "uniform_number": "背番号",
    "player_name": "選手名",
    "at_bats_details": [
      {
        "inning": イニング番号(数値),
        "raw_text": "マス目の筆跡メモ（例: (8)B, 4-3①, (6)2TO など）",
        "result": "結果（例: 四球, 三振, 単打, 二塁打, 三塁打, 本塁打, 凡打, 失策出塁, 不明）",
        "hit_type": "single | double | triple | homerun | none",
        "is_walk": true/false（四球ならtrue）,
        "is_dead_ball": true/false（死球ならtrue）,
        "is_strikeout": true/false（三振ならtrue）,
        "is_run": true/false（生還・得点していればtrue）,
        "stolen_bases": その打席での盗塁数(0または数値),
        "rbi": その打席での打点(0または数値),
        "note": "判定理由や補足（例: 赤線一周で生還）"
      }
    ],
    "highlight": "その試合の印象的な好プレー（例: 4回裏の左越え適時3塁打）",
    "is_unreadable": 読めない打席があれば true,
    "unreadable_note": "読めない箇所や理由"
  }
]
"""


def summarize_player_records(raw_records):
    """AIが言葉にした打席明細から、Python側で確実に合計値を計算する"""
    summarized = []
    for p in raw_records:
        details = p.get("at_bats_details", []) or []

        pa = len(details)  # 打席数
        ab = 0  # 打数
        hits = 0  # 単打
        doubles = 0  # 2塁打
        triples = 0  # 3塁打
        hrs = 0  # 本塁打
        so = 0  # 三振
        bb = 0  # 四球
        hbp = 0  # 死球
        sb = 0  # 盗塁
        rbi = 0  # 打点
        runs = 0  # 得点

        detail_texts = []

        for d in details:
            inning = d.get("inning", "?")
            res = d.get("result", "不明")
            ht = d.get("hit_type", "none")

            # 打席の言葉まとめ
            run_mark = " (生還)" if d.get("is_run") else ""
            detail_texts.append(f"{inning}回:{res}{run_mark}")

            # 四死球・三振
            if d.get("is_walk"):
                bb += 1
            elif d.get("is_dead_ball"):
                hbp += 1
            else:
                # 四死球・犠打等以外は打数にカウント
                if res not in ["犠打", "犠飛"]:
                    ab += 1

            if d.get("is_strikeout"):
                so += 1

            # 安打
            if ht == "single":
                hits += 1
            elif ht == "double":
                doubles += 1
            elif ht == "triple":
                triples += 1
            elif ht == "homerun":
                hrs += 1

            # 得点・盗塁・打点
            if d.get("is_run"):
                runs += 1
            sb += int(d.get("stolen_bases") or 0)
            rbi += int(d.get("rbi") or 0)

        # 読めない箇所がある場合の処理
        is_unreadable = p.get("is_unreadable", False)
        unreadable_note = p.get("unreadable_note", "")

        summarized.append(
            {
                "match_date": p.get("match_date"),
                "opponent": p.get("opponent"),
                "batting_order": p.get("batting_order"),
                "uniform_number": p.get("uniform_number"),
                "player_name": p.get("player_name"),
                "plate_appearances": pa,
                "at_bats": ab,
                "hits": hits,
                "doubles": doubles,
                "triples": triples,
                "homeruns": hrs,
                "strikeouts": so,
                "walks": bb,
                "dead_ball": hbp,
                "stolen_bases": sb,
                "rbi": rbi,
                "runs": runs,
                "at_bats_summary": " / ".join(detail_texts),
                "highlight": p.get("highlight", ""),
                "is_unreadable": is_unreadable,
                "unreadable_note": unreadable_note,
            }
        )
    return summarized


def create_excel(records):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    yellow_fill = PatternFill(
        start_color="FFF2CC", end_color="FFF2CC", fill_type="solid"
    )
    red_font = Font(color="9C0006", bold=True)

    players = {}
    for r in records:
        name = str(r.get("player_name") or "未登録").strip()
        num = str(r.get("uniform_number") or "").strip()
        order = str(r.get("batting_order") or "").strip()

        if num and num != "UNREADABLE":
            sheet_title = f"{num}_{name}"
        elif order:
            sheet_title = f"{order}番_{name}"
        else:
            sheet_title = name

        for ch in [":", "\\", "/", "?", "*", "[", "]"]:
            sheet_title = sheet_title.replace(ch, "")

        players.setdefault(sheet_title, []).append(r)

    headers = [
        "日付",
        "対戦相手",
        "背番号",
        "選手名",
        "打順",
        "打席詳細（各回の結果）",
        "打席",
        "打数",
        "安打",
        "2塁打",
        "3塁打",
        "本塁打",
        "三振",
        "四球",
        "死球",
        "盗塁",
        "打点",
        "得点",
        "ハイライト",
        "要確認メモ",
    ]

    for sheet_name, matches in players.items():
        ws = wb.create_sheet(title=sheet_name[:30])
        ws.append(headers)

        for col in range(1, len(headers) + 1):
            c = ws.cell(row=1, column=col)
            c.font = Font(bold=True)
            c.alignment = Alignment(horizontal="center")

        for m in matches:
            row = [
                m.get("match_date"),
                m.get("opponent"),
                m.get("uniform_number"),
                m.get("player_name"),
                m.get("batting_order"),
                m.get("at_bats_summary"),
                m.get("plate_appearances"),
                m.get("at_bats"),
                m.get("hits"),
                m.get("doubles"),
                m.get("triples"),
                m.get("homeruns"),
                m.get("strikeouts"),
                m.get("walks"),
                m.get("dead_ball"),
                m.get("stolen_bases"),
                m.get("rbi"),
                m.get("runs"),
                m.get("highlight", ""),
                m.get("unreadable_note", ""),
            ]
            ws.append(row)
            curr_row = ws.max_row

            for idx, val in enumerate(row, start=1):
                cell = ws.cell(row=curr_row, column=idx)
                if val is None or val == "UNREADABLE":
                    cell.value = "要確認"
                    cell.fill = yellow_fill
                    cell.font = red_font
                    cell.alignment = Alignment(horizontal="center")

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


# タブ分離
tab_admin, tab_kids = st.tabs(
    ["📁 役員用（スコア解析＆Excel出力）", "🏆 選手名鑑＆アワード"]
)

# ==========================================
# ① 役員・集計担当用画面
# ==========================================
with tab_admin:
    st.subheader("手書きスコア自動解析（打席明細付き）")
    st.caption(
        "AIが各イニングの打席結果を言語化し、Pythonが正確に合計成績を算出します。"
    )

    if not client:
        st.warning(
            "Gemini APIキーを設定してください（Secrets または サイドバー）。"
        )
        st.stop()

    uploaded_files = st.file_uploader(
        "スコアブック写真を選択（複数可）",
        type=["jpg", "jpeg", "png"],
        accept_multiple_files=True,
    )

    if uploaded_files:
        if st.button("AI自動解析を開始する", type="primary"):
            new_records = []
            progress = st.progress(0)
            status = st.empty()

            for i, f in enumerate(uploaded_files):
                status.text(
                    f"解析中 ({i+1}/{len(uploaded_files)}): {f.name}..."
                )
                img_bytes = f.read()

                try:
                    res = client.models.generate_content(
                        model="gemini-3.6-flash",
                        contents=[
                            types.Part.from_bytes(
                                data=img_bytes, mime_type="image/jpeg"
                            ),
                            "このスコアブックの全出場選手の打席明細を漏れなく抽出してください。",
                        ],
                        config=types.GenerateContentConfig(
                            system_instruction=SYSTEM_PROMPT,
                            response_mime_type="application/json",
                            temperature=0.1,
                        ),
                    )
                    raw_data = json.loads(res.text)
                    # Python側で確実に合算
                    calc_data = summarize_player_records(raw_data)
                    new_records.extend(calc_data)
                except Exception as e:
                    st.error(f"{f.name} の解析エラー: {e}")

                progress.progress((i + 1) / len(uploaded_files))

            status.empty()
            if new_records:
                st.session_state.records = new_records
                st.success("🎉 全選手の打席明細と言語化解析が完了しました！")

    if st.session_state.records:
        st.markdown("### 📋 解析結果プレビュー（打席詳細）")
        df_preview = pd.DataFrame(st.session_state.records)[
            [
                "uniform_number",
                "player_name",
                "at_bats_summary",
                "at_bats",
                "hits",
                "doubles",
                "triples",
                "homeruns",
                "walks",
                "runs",
            ]
        ]
        df_preview.columns = [
            "背番号",
            "選手名",
            "打席明細",
            "打数",
            "単打",
            "2塁打",
            "3塁打",
            "本塁打",
            "四球",
            "得点",
        ]
        st.dataframe(df_preview, use_container_width=True)

        excel_file = create_excel(st.session_state.records)
        st.download_button(
            label="📥 選手別シート付きExcelをダウンロード",
            data=excel_file,
            file_name="卒団生_打撃成績一覧.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

# ==========================================
# ② 子どもたち・指導者用画面
# ==========================================
with tab_kids:
    if not st.session_state.records:
        st.info("👈 まず「役員用」タブでスコアを解析してください。")
    else:
        df = pd.DataFrame(st.session_state.records)

        df["display_name"] = (
            df["uniform_number"].fillna("").astype(str)
            + " "
            + df["player_name"].fillna("未登録")
        )
        players = df["display_name"].unique().tolist()

        st.subheader("🎖️ チームタイトル・アワード")
        col1, col2, col3 = st.columns(3)

        hit_leaders = (
            df.groupby("display_name")["hits"].sum().sort_values(ascending=False)
        )
        if not hit_leaders.empty and hit_leaders.iloc[0] > 0:
            col1.metric("チーム最多安打", f"{hit_leaders.index[0]} 選手", f"{int(hit_leaders.iloc[0])} 本")

        sb_leaders = (
            df.groupby("display_name")["stolen_bases"]
            .sum()
            .sort_values(ascending=False)
        )
        if not sb_leaders.empty and sb_leaders.iloc[0] > 0:
            col2.metric("スピードスター賞（最多盗塁）", f"{sb_leaders.index[0]} 選手", f"{int(sb_leaders.iloc[0])} 個")

        hr_leaders = (
            df.groupby("display_name")["homeruns"]
            .sum()
            .sort_values(ascending=False)
        )
        if not hr_leaders.empty and hr_leaders.iloc[0] > 0:
            col3.metric("スラッガー賞（本塁打）", f"{hr_leaders.index[0]} 選手", f"{int(hr_leaders.iloc[0])} 本")

        st.divider()

        st.subheader("⚾️ 卒団記念 デジタル選手名鑑")
        selected_player = st.selectbox("選手を選択してください", players)

        player_data = df[df["display_name"] == selected_player]

        ab = player_data["at_bats"].sum()
        h = (
            player_data["hits"].sum()
            + player_data["doubles"].sum()
            + player_data["triples"].sum()
            + player_data["homeruns"].sum()
        )
        avg = (h / ab) if ab > 0 else 0.0
        sb = player_data["stolen_bases"].sum()
        hr = player_data["homeruns"].sum()

        st.markdown(f"### **{selected_player}** 選手の通算成績")
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("通算打率", f".{int(avg * 1000):03d}" if avg > 0 else ".000")
        c2.metric("通算安打数", f"{int(h)} 本")
        c3.metric("通算本塁打", f"{int(hr)} 本")
        c4.metric("通算盗塁数", f"{int(sb)} 個")

        st.markdown("#### 📝 打席明細ログ")
        for summary in player_data["at_bats_summary"]:
            st.write(f"・{summary}")

        st.markdown("#### 🔥 記憶に残るベストハイライト")
        highlights = player_data[
            player_data["highlight"].str.strip() != ""
        ]["highlight"].tolist()
        if highlights:
            for hl in highlights:
                st.write(f"・{hl}")
        else:
            st.write("・全力プレーでチームに大きく貢献！")
