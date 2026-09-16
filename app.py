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

if "raw_players" not in st.session_state:
    st.session_state.raw_players = []

api_key = st.secrets.get("GEMINI_API_KEY")
if not api_key:
    api_key = st.sidebar.text_input("管理者APIキー (Gemini)", type="password")

client = genai.Client(api_key=api_key) if api_key else None

SYSTEM_PROMPT = """
あなたは学童野球の手書きスコアブック（早稲田式）の文字起こし記録員です。
各打順の選手名・背番号・各回の打席結果（鉛筆文字）を客観的に抽出してください。
合計計算はシステム側で行うため不要です。

【選手名・背番号の厳格な分離（二段書きの選手交代）】
- 打順欄に上下二段で名前がある場合、背番号が異なれば完全に別人の選手です。
  必ず「先発選手（上段）」と「交代選手（下段）」を別々の選手オブジェクトとして出力してください。
  （例: 9番枠の背番号19と背番号21は別人）
- 先発選手: 交代前の打席（1〜3回など）のみを含める。
- 交代選手: 代打（PH）や4回以降の交代後の打席のみを含める。

【打席結果の抽出基準（一次判定）】
- "B" または "四": 四球
- "DB" または "死": 死球
- "K" または "Ⓚ": 三振
- "3A", "1A", "4-3", "6-4-3" などの内野ゴロ・フライ: 凡打
- 赤線や打球メモ（例: 2TO）がある場合は、推測できる範囲で「単打」「2塁打」「3塁打」「本塁打」としてください（後から人間が画面で修正します）。
- 赤線でダイヤモンドを一周囲んでいる場合: is_run=true（得点）
- 5番打者付近などの赤い波線は投手交代の印なので無視してください。
- "(6)", "(8)" などのカッコ付き数字は進塁打者の記号なので無視してください。

【出力フォーマット（JSON配列のみ返却）】
各打席は最大5打席までリストで返してください。
[
  {
    "batting_order": 打順番号,
    "uniform_number": "背番号",
    "player_name": "選手名",
    "pa1_result": "凡打 | 単打 | 2塁打 | 3塁打 | 本塁打 | 四球 | 死球 | 三振 | なし",
    "pa1_run": true/false(得点・生還),
    "pa2_result": "凡打 | 単打 | 2塁打 | 3塁打 | 本塁打 | 四球 | 死球 | 三振 | なし",
    "pa2_run": true/false,
    "pa3_result": "凡打 | 単打 | 2塁打 | 3塁打 | 本塁打 | 四球 | 死球 | 三振 | なし",
    "pa3_run": true/false,
    "pa4_result": "凡打 | 単打 | 2塁打 | 3塁打 | 本塁打 | 四球 | 死球 | 三振 | なし",
    "pa4_run": true/false,
    "pa5_result": "凡打 | 単打 | 2塁打 | 3塁打 | 本塁打 | 四球 | 死球 | 三振 | なし",
    "pa5_run": true/false,
    "highlight": "好プレー（例: 4回裏の適時3塁打）"
  }
]
"""

RESULT_OPTIONS = ["なし", "凡打", "単打", "2塁打", "3塁打", "本塁打", "四球", "死球", "三振", "犠打"]


def calculate_stats_from_grid(df_grid):
    """グリッドの打席結果から、打数・安打・打率などの合計成績を完全自動計算する"""
    calculated_rows = []

    for _, r in df_grid.iterrows():
        pa = 0
        ab = 0
        hits = 0
        doubles = 0
        triples = 0
        hrs = 0
        so = 0
        bb = 0
        hbp = 0
        runs = 0
        details = []

        for i in range(1, 6):
            res = r.get(f"打席{i}", "なし")
            is_run = r.get(f"生還{i}", False)

            if res and res != "なし":
                pa += 1
                run_mark = " (生還)" if is_run else ""
                details.append(f"打席{i}:{res}{run_mark}")

                if res == "四球":
                    bb += 1
                elif res == "死球":
                    hbp += 1
                elif res == "犠打":
                    pass
                else:
                    ab += 1
                    if res == "三振":
                        so += 1
                    elif res == "単打":
                        hits += 1
                    elif res == "2塁打":
                        doubles += 1
                    elif res == "3塁打":
                        triples += 1
                    elif res == "本塁打":
                        hrs += 1

            if is_run:
                runs += 1

        calculated_rows.append({
            "背番号": str(r.get("背番号", "")),
            "選手名": str(r.get("選手名", "未登録")),
            "打順": r.get("打順", ""),
            "打席明細": " / ".join(details),
            "打席": pa,
            "打数": ab,
            "単打": hits,
            "2塁打": doubles,
            "3塁打": triples,
            "本塁打": hrs,
            "安打計": hits + doubles + triples + hrs,
            "三振": so,
            "四球": bb,
            "死球": hbp,
            "得点": runs,
            "ハイライト": r.get("ハイライト", ""),
        })

    return pd.DataFrame(calculated_rows)


def create_excel_from_calc(df_calc, match_date="2026", opponent="相手チーム"):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    headers = [
        "日付", "対戦相手", "背番号", "選手名", "打順", "打席明細",
        "打席", "打数", "単打", "2塁打", "3塁打", "本塁打", "安打計",
        "三振", "四球", "死球", "得点", "ハイライト"
    ]

    for _, row_data in df_calc.iterrows():
        num_str = str(row_data.get("背番号", "")).strip()
        name_str = str(row_data.get("選手名", "未登録")).strip()
        sheet_title = f"{num_str}_{name_str}" if num_str else name_str

        for ch in [":", "\\", "/", "?", "*", "[", "]"]:
            sheet_title = sheet_title.replace(ch, "")

        ws = wb.create_sheet(title=sheet_title[:30])
        ws.append(headers)

        for col in range(1, len(headers) + 1):
            c = ws.cell(row=1, column=col)
            c.font = Font(bold=True)
            c.alignment = Alignment(horizontal="center")

        ws.append([
            match_date,
            opponent,
            row_data.get("背番号"),
            row_data.get("選手名"),
            row_data.get("打順"),
            row_data.get("打席明細"),
            row_data.get("打席"),
            row_data.get("打数"),
            row_data.get("単打"),
            row_data.get("2塁打"),
            row_data.get("3塁打"),
            row_data.get("本塁打"),
            row_data.get("安打計"),
            row_data.get("三振"),
            row_data.get("四球"),
            row_data.get("死球"),
            row_data.get("得点"),
            row_data.get("ハイライト", ""),
        ])

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


tab_admin, tab_kids = st.tabs(
    ["📁 役員用（打席盤面ポチポチ＆Excel出力）", "🏆 選手名鑑＆アワード"]
)

# ==========================================
# ① 役員用画面
# ==========================================
with tab_admin:
    st.subheader("手書きスコア入力盤面（AIアシスト ＋ ポチポチ確定）")
    st.caption("AIが選手名と凡打・四死球を一次入力します。赤線の安打・生還だけを画面上の表でカチカチッと直すだけで完璧な集計ができます。")

    if not client:
        st.warning("Gemini APIキーを設定してください。")
        st.stop()

    uploaded_files = st.file_uploader(
        "スコアブック写真を選択",
        type=["jpg", "jpeg", "png"],
        accept_multiple_files=True,
    )

    if uploaded_files:
        if st.button("AIで下書きを作成する", type="primary"):
            grid_data = []
            progress = st.progress(0)
            status = st.empty()

            for i, f in enumerate(uploaded_files):
                status.text(f"読み取り中 ({i+1}/{len(uploaded_files)}): {f.name}...")
                img_bytes = f.read()

                try:
                    res = client.models.generate_content(
                        model="gemini-3.6-flash",
                        contents=[
                            types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
                            "このスコアブックの選手名、背番号、各打席の文字起こしを行ってください。",
                        ],
                        config=types.GenerateContentConfig(
                            system_instruction=SYSTEM_PROMPT,
                            response_mime_type="application/json",
                            temperature=0.1,
                        ),
                    )
                    raw_data = json.loads(res.text)

                    for p in raw_data:
                        grid_data.append({
                            "打順": p.get("batting_order", 1),
                            "背番号": str(p.get("uniform_number", "")),
                            "選手名": p.get("player_name", ""),
                            "打席1": p.get("pa1_result", "なし"),
                            "生還1": p.get("pa1_run", False),
                            "打席2": p.get("pa2_result", "なし"),
                            "生還2": p.get("pa2_run", False),
                            "打席3": p.get("pa3_result", "なし"),
                            "生還3": p.get("pa3_run", False),
                            "打席4": p.get("pa4_result", "なし"),
                            "生還4": p.get("pa4_run", False),
                            "打席5": p.get("pa5_result", "なし"),
                            "生還5": p.get("pa5_run", False),
                            "ハイライト": p.get("highlight", ""),
                        })
                except Exception as e:
                    st.error(f"{f.name} の解析エラー: {e}")

                progress.progress((i + 1) / len(uploaded_files))

            status.empty()
            if grid_data:
                st.session_state.raw_players = grid_data
                st.success("🎉 AIの下書き入力が完了しました！下の表で赤線部分を確認・修正してください。")

    if st.session_state.raw_players:
        st.markdown("### ⚾️ 打席盤面エディタ（ここでポチポチ修正）")
        st.caption("各打席をクリックすると『単打 / 2塁打 / 3塁打 / 本塁打 / 凡打 / 四球』などを選択できます。生還した打席はチェックを入れてください。")

        df_editor_source = pd.DataFrame(st.session_state.raw_players)

        edited_grid = st.data_editor(
            df_editor_source,
            column_config={
                "打順": st.column_config.NumberColumn("打順", width="small"),
                "背番号": st.column_config.TextColumn("背番号", width="small"),
                "選手名": st.column_config.TextColumn("選手名", width="medium"),
                "打席1": st.column_config.SelectboxColumn("打席1", options=RESULT_OPTIONS, required=True),
                "生還1": st.column_config.CheckboxColumn("生還1", help="ホームイン・得点"),
                "打席2": st.column_config.SelectboxColumn("打席2", options=RESULT_OPTIONS, required=True),
                "生還2": st.column_config.CheckboxColumn("生還2"),
                "打席3": st.column_config.SelectboxColumn("打席3", options=RESULT_OPTIONS, required=True),
                "生還3": st.column_config.CheckboxColumn("生還3"),
                "打席4": st.column_config.SelectboxColumn("打席4", options=RESULT_OPTIONS, required=True),
                "生還4": st.column_config.CheckboxColumn("生還4"),
                "打席5": st.column_config.SelectboxColumn("打席5", options=RESULT_OPTIONS, required=True),
                "生還5": st.column_config.CheckboxColumn("生還5"),
                "ハイライト": st.column_config.TextColumn("ハイライト"),
            },
            use_container_width=True,
            num_rows="dynamic",
            key="grid_editor"
        )

        # 編集結果をもとに即座に再計算
        df_calculated = calculate_stats_from_grid(edited_grid)
        st.session_state.calculated_df = df_calculated

        st.markdown("#### 📊 自動集計プレビュー（修正が即座に反映されます）")
        st.dataframe(
            df_calculated[["背番号", "選手名", "打数", "単打", "2塁打", "3塁打", "本塁打", "安打計", "四球", "得点", "打席明細"]],
            use_container_width=True
        )

        excel_bytes = create_excel_from_calc(df_calculated)
        st.download_button(
            label="📥 確定した個人成績Excelをダウンロード",
            data=excel_bytes,
            file_name="卒団生_確定打撃成績一覧.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

# ==========================================
# ② 選手名鑑＆アワード
# ==========================================
with tab_kids:
    if "calculated_df" not in st.session_state or st.session_state.calculated_df.empty:
        st.info("👈 まず「役員用」タブでスコアを確定してください。")
    else:
        df = st.session_state.calculated_df.copy()
        df["display_name"] = df["背番号"].astype(str) + " " + df["選手名"]
        players = df["display_name"].unique().tolist()

        st.subheader("🎖️ チームタイトル・アワード")
        col1, col2, col3 = st.columns(3)

        hit_leaders = df.groupby("display_name")["安打計"].sum().sort_values(ascending=False)
        if not hit_leaders.empty and hit_leaders.iloc[0] > 0:
            col1.metric("チーム最多安打", f"{hit_leaders.index[0]} 選手", f"{int(hit_leaders.iloc[0])} 本")

        run_leaders = df.groupby("display_name")["得点"].sum().sort_values(ascending=False)
        if not run_leaders.empty and run_leaders.iloc[0] > 0:
            col2.metric("最多得点賞", f"{run_leaders.index[0]} 選手", f"{int(run_leaders.iloc[0])} 点")

        hr_leaders = df.groupby("display_name")["本塁打"].sum().sort_values(ascending=False)
        if not hr_leaders.empty and hr_leaders.iloc[0] > 0:
            col3.metric("スラッガー賞", f"{hr_leaders.index[0]} 選手", f"{int(hr_leaders.iloc[0])} 本")

        st.divider()

        st.subheader("⚾️ 卒団記念 デジタル選手名鑑")
        selected_player = st.selectbox("選手を選択してください", players)
        player_data = df[df["display_name"] == selected_player]

        ab = player_data["打数"].sum()
        h = player_data["安打計"].sum()
        avg = (h / ab) if ab > 0 else 0.0
        runs = player_data["得点"].sum()
        hr = player_data["本塁打"].sum()

        st.markdown(f"### **{selected_player}** 選手の通算成績")
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("通算打率", f".{int(avg * 1000):03d}" if avg > 0 else ".000")
        c2.metric("通算安打数", f"{int(h)} 本")
        c3.metric("本塁打", f"{int(hr)} 本")
        c4.metric("総得点", f"{int(runs)} 点")

        st.markdown("#### 📝 打席明細ログ")
        for summary in player_data["打席明細"]:
            st.write(f"・{summary}")

        st.markdown("#### 🔥 記憶に残るベストハイライト")
        for hl in player_data["ハイライト"].dropna():
            if str(hl).strip():
                st.write(f"・{hl}")
