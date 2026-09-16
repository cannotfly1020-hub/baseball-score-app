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

# セッション状態の初期化
if "records" not in st.session_state:
    st.session_state.records = []

# APIキー設定（Secretsまたは管理者入力）
api_key = st.secrets.get("GEMINI_API_KEY")
if not api_key:
    api_key = st.sidebar.text_input("管理者APIキー (Gemini)", type="password")

client = genai.Client(api_key=api_key) if api_key else None

SYSTEM_PROMPT = """
あなたは学童野球の手書きスコアブック（早稲田式）の解析専門AIです。
画像から出場選手全員の打撃成績を正確に抽出し、指定のJSON配列のみを出力してください。

【厳格ルール：推測の完全排除】
- 文字や記号がかすれている、重なっている等で確信が持てない箇所は絶対に推測で埋めないこと。
- 判別不能な数値は null、文字列は "UNREADABLE" とし、is_unreadable を true にすること。

【スコア記号ルール】
- 守備番号: 1投, 2捕, 3一, 4二, 5三, 6遊, 7左, 8中, 9右
- 単打/二塁打/三塁打/本塁打/四球(B)/死球(DB)/三振(K)/犠打/盗塁(S)/得点/失策(E)を正しく分類すること。

【出力フォーマット（JSON配列のみ返却）】
[
  {
    "match_date": "試合日（不明なら UNREADABLE）",
    "opponent": "相手チーム名（不明なら UNREADABLE）",
    "batting_order": 打順番号,
    "uniform_number": "背番号",
    "player_name": "選手名",
    "plate_appearances": 打席数(null),
    "at_bats": 打数(null),
    "hits": 単打数(null),
    "doubles": 二塁打数(null),
    "triples": 三塁打数(null),
    "homeruns": 本塁打数(null),
    "strikeouts": 三振数(null),
    "walks": 四球数(null),
    "dead_ball": 死球数(null),
    "stolen_bases": 盗塁数(null),
    "rbi": 打点(null),
    "runs": 得点(null),
    "highlight": "その試合の印象的なプレー（例: 豪快な中越え本塁打、気迫の二盗など）",
    "is_unreadable": 読めない箇所があれば true,
    "unreadable_note": "未判別理由（例: 3回裏の記号重なり）"
  }
]
"""


def create_excel(records):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    yellow_fill = PatternFill(
        start_color="FFF2CC", end_color="FFF2CC", fill_type="solid"
    )
    red_font = Font(color="9C0006", bold=True)

    players = {}
    for r in records:
        name = r.get("player_name") or "未登録"
        num = r.get("uniform_number") or ""
        key = f"{num}_{name}".strip("_")
        players.setdefault(key, []).append(r)

    headers = [
        "日付",
        "対戦相手",
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

    for player_key, matches in players.items():
        ws = wb.create_sheet(title=player_key[:30])
        ws.append(headers)

        for col in range(1, len(headers) + 1):
            c = ws.cell(row=1, column=col)
            c.font = Font(bold=True)
            c.alignment = Alignment(horizontal="center")

        for m in matches:
            row = [
                m.get("match_date"),
                m.get("opponent"),
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


# タブで画面を明確に分離
tab_admin, tab_kids = st.tabs(
    ["📁 役員用（スコア解析＆Excel出力）", "🏆 選手名鑑＆アワード"]
)

# ==========================================
# ① 役員・集計担当用画面
# ==========================================
with tab_admin:
    st.subheader("手書きスコア自動解析")
    st.caption(
        "複数枚の写真をまとめてアップロードすると、選手別シート付きExcelを生成します。"
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
                            "このスコアブックの選手成績を抽出してください。",
                        ],
                        config=types.GenerateContentConfig(
                            system_instruction=SYSTEM_PROMPT,
                            response_mime_type="application/json",
                            temperature=0.1,
                        ),
                    )
                    data = json.loads(res.text)
                    new_records.extend(data)
                except Exception as e:
                    st.error(f"{f.name} の解析エラー: {e}")

                progress.progress((i + 1) / len(uploaded_files))

            status.empty()
            if new_records:
                st.session_state.records = new_records
                st.success("🎉 全試合の集計が完了しました！")

    if st.session_state.records:
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

        # 選手名のユニーク一覧
        df["display_name"] = (
            df["uniform_number"].fillna("").astype(str)
            + " "
            + df["player_name"].fillna("未登録")
        )
        players = df["display_name"].unique().tolist()

        st.subheader("🎖️ チームタイトル・アワード")
        col1, col2, col3 = st.columns(3)

        # 最多安打
        hit_leaders = (
            df.groupby("player_name")["hits"].sum().sort_values(ascending=False)
        )
        if not hit_leaders.empty and hit_leaders.iloc[0] > 0:
            col1.metric("チーム最多安打", f"{hit_leaders.index[0]} 選手", f"{int(hit_leaders.iloc[0])} 本")

        # 盗塁王
        sb_leaders = (
            df.groupby("player_name")["stolen_bases"]
            .sum()
            .sort_values(ascending=False)
        )
        if not sb_leaders.empty and sb_leaders.iloc[0] > 0:
            col2.metric("スピードスター賞（最多盗塁）", f"{sb_leaders.index[0]} 選手", f"{int(sb_leaders.iloc[0])} 個")

        # ホームラン王
        hr_leaders = (
            df.groupby("player_name")["homeruns"]
            .sum()
            .sort_values(ascending=False)
        )
        if not hr_leaders.empty and hr_leaders.iloc[0] > 0:
            col3.metric("スラッガー賞（本塁打）", f"{hr_leaders.index[0]} 選手", f"{int(hr_leaders.iloc[0])} 本")

        st.divider()

        # 個別選手カード表示
        st.subheader("⚾️ 卒団記念 デジタル選手名鑑")
        selected_player = st.selectbox("選手を選択してください", players)

        player_data = df[df["display_name"] == selected_player]

        # 個人通算集計
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

        st.markdown("#### 🔥 記憶に残るベストハイライト")
        highlights = player_data[
            player_data["highlight"].str.strip() != ""
        ]["highlight"].tolist()
        if highlights:
            for hl in highlights:
                st.write(f"・{hl}")
        else:
            st.write("・全力プレーでチームに大きく貢献！")
