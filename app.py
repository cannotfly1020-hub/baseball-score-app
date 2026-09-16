import io
import json
import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
import pandas as pd
import streamlit as st
from google import genai
from google.genai import types

st.set_page_config(
    page_title="学童野球スコア集計＆卒団アルバム",
    page_icon="⚾️",
    layout="wide",
)

if "raw_players" not in st.session_state:
    st.session_state.raw_players = []
if "match_info" not in st.session_state:
    st.session_state.match_info = {"date": "", "opponent": ""}
if "uploaded_images" not in st.session_state:
    st.session_state.uploaded_images = []

api_key = st.secrets.get("GEMINI_API_KEY")
if not api_key:
    api_key = st.sidebar.text_input("管理者APIキー (Gemini)", type="password")

client = genai.Client(api_key=api_key) if api_key else None

SYSTEM_PROMPT = """
あなたは学童野球の手書きスコアブック（早稲田式）の文字起こし記録員です。
選手の大切な卒団記録となるため、推測や適当な補完は一切許されません。
各打順の選手名・背番号・各回の打席結果（鉛筆文字）を客観的に抽出してください。合計計算はシステム側で行うため不要です。

【最重要：選手名・背番号の厳格な分離（二段書きの選手交代）】
- 打順欄に上下二段で名前がある場合、背番号が異なれば完全に別人の選手です。
  必ず「先発選手（上段）」と「交代選手（下段）」を別々の選手オブジェクトとして出力してください。
  （例: 9番枠の背番号19と背番号21は別人）
- 先発選手: 交代前の打席（1〜3回など）のみを含める。
- 交代選手: 代打（PH）や4回以降の交代後の打席のみを含める。交代前の記録を先発選手から消してはいけません。

【打席結果の抽出基準（一次判定）】
- "B" または "四": 四球
- "DB" または "死": 死球
- "K" または "Ⓚ": 三振
- "3A", "1A", "4-3", "6-4-3" などの内野ゴロ・フライ: 凡打
- 赤線や打球メモ（例: 2TO）がある場合は、推測できる範囲で「単打」「2塁打」「3塁打」「本塁打」としてください（後から人間が画面で修正します）。
- 赤線でダイヤモンドを一周囲んでいる場合: paX_run=true（生還・得点）
- 5番打者付近などの赤い波線は投手交代の印なので無視してください。
- "(6)", "(8)" などのカッコ付き数字は進塁打者の記号なので無視してください。

【出力フォーマット（JSONオブジェクトのみ返却）】
{
  "match_date": "試合日（不明なら空文字）",
  "opponent": "相手チーム名（不明なら空文字）",
  "players": [
    {
      "batting_order": 打順番号,
      "uniform_number": "背番号",
      "player_name": "選手名",
      "pa1_result": "凡打 | 単打 | 2塁打 | 3塁打 | 本塁打 | 四球 | 死球 | 三振 | 犠打 | なし",
      "pa1_run": true/false(得点・生還),
      "pa2_result": "凡打 | 単打 | 2塁打 | 3塁打 | 本塁打 | 四球 | 死球 | 三振 | 犠打 | なし",
      "pa2_run": true/false,
      "pa3_result": "凡打 | 単打 | 2塁打 | 3塁打 | 本塁打 | 四球 | 死球 | 三振 | 犠打 | なし",
      "pa3_run": true/false,
      "pa4_result": "凡打 | 単打 | 2塁打 | 3塁打 | 本塁打 | 四球 | 死球 | 三振 | 犠打 | なし",
      "pa4_run": true/false,
      "pa5_result": "凡打 | 単打 | 2塁打 | 3塁打 | 本塁打 | 四球 | 死球 | 三振 | 犠打 | なし",
      "pa5_run": true/false,
      "stolen_bases": 盗塁数(数値),
      "rbi": 打点(数値),
      "highlight": "好プレー（例: 4回裏の適時3塁打）"
    }
  ]
}
"""

RESULT_OPTIONS = ["なし", "凡打", "単打", "2塁打", "3塁打", "本塁打", "四球", "死球", "三振", "犠打"]


def calculate_stats_from_grid(df_grid):
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
            "盗塁": int(r.get("盗塁", 0) or 0),
            "打点": int(r.get("打点", 0) or 0),
            "得点": runs,
            "ハイライト": r.get("ハイライト", ""),
        })

    return pd.DataFrame(calculated_rows)


def create_excel_from_calc(df_calc, match_date, opponent):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    yellow_fill = PatternFill(start_color="FFF2CC", end_color="FFF2CC", fill_type="solid")
    red_font = Font(color="9C0006", bold=True)

    headers = [
        "日付", "対戦相手", "背番号", "選手名", "打順", "打席明細",
        "打席", "打数", "単打", "2塁打", "3塁打", "本塁打", "安打計",
        "三振", "四球", "死球", "盗塁", "打点", "得点", "ハイライト"
    ]

    players = df_calc.groupby(["背番号", "選手名"])

    for (num, name), group in players:
        num_str = str(num).strip() if pd.notna(num) else ""
        name_str = str(name).strip() if pd.notna(name) else "未登録"
        sheet_title = f"{num_str}_{name_str}" if num_str else name_str

        for ch in [":", "\\", "/", "?", "*", "[", "]"]:
            sheet_title = sheet_title.replace(ch, "")

        ws = wb.create_sheet(title=sheet_title[:30])
        ws.append(headers)

        for col in range(1, len(headers) + 1):
            c = ws.cell(row=1, column=col)
            c.font = Font(bold=True)
            c.alignment = Alignment(horizontal="center")

        for _, row_data in group.iterrows():
            row = [
                match_date or "未記入",
                opponent or "未記入",
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
                row_data.get("盗塁"),
                row_data.get("打点"),
                row_data.get("得点"),
                row_data.get("ハイライト", ""),
            ]
            ws.append(row)
            curr_row = ws.max_row

            for idx, val in enumerate(row, start=1):
                cell = ws.cell(row=curr_row, column=idx)
                if val is None or val == "未登録" or val == "未記入":
                    cell.fill = yellow_fill
                    cell.font = red_font
                    cell.alignment = Alignment(horizontal="center")

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
    st.subheader("手書きスコア入力盤面（画像照合 ＋ ポチポチ確定）")
    st.caption("AIが選手名・背番号・凡打や四死球を下書きします。画面上の画像を見ながら、赤線の安打・生還を数回直すだけで集計が完了します。")

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
            st.session_state.uploaded_images = []
            progress = st.progress(0)
            status = st.empty()

            for i, f in enumerate(uploaded_files):
                status.text(f"読み取り中 ({i+1}/{len(uploaded_files)}): {f.name}...")
                img_bytes = f.read()
                st.session_state.uploaded_images.append({"name": f.name, "bytes": img_bytes})

                try:
                    res = client.models.generate_content(
                        model="gemini-1.5-flash",
                        contents=[
                            types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
                            "このスコアブックの試合日、相手チーム名、全出場選手の背番号・名前・各打席の文字起こしを行ってください。",
                        ],
                        config=types.GenerateContentConfig(
                            system_instruction=SYSTEM_PROMPT,
                            response_mime_type="application/json",
                            temperature=0.1,
                        ),
                    )
                    parsed = json.loads(res.text)

                    if isinstance(parsed, dict):
                        st.session_state.match_info["date"] = parsed.get("match_date", "")
                        st.session_state.match_info["opponent"] = parsed.get("opponent", "")
                        raw_players = parsed.get("players", [])
                    else:
                        raw_players = parsed

                    for p in raw_players:
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
                            "盗塁": int(p.get("stolen_bases", 0) or 0),
                            "打点": int(p.get("rbi", 0) or 0),
                            "ハイライト": p.get("highlight", ""),
                        })
                except Exception as e:
                    st.error(f"{f.name} の解析エラー: {e}")

                progress.progress((i + 1) / len(uploaded_files))

            status.empty()
            if grid_data:
                st.session_state.raw_players = grid_data
                st.success("🎉 下書き作成が完了しました！下のプレビュー画像を見ながら確認・修正してください。")

    if st.session_state.raw_players:
        # スコア写真のプレビュー表示エリア
        if st.session_state.uploaded_images:
            with st.expander("📷 読み込んだスコアブック写真（確認用プレビュー）", expanded=True):
                for img_data in st.session_state.uploaded_images:
                    st.image(img_data["bytes"], caption=img_data["name"], use_container_width=True)

        st.markdown("### ⚾️ 打席盤面エディタ（確認・修正）")
        st.caption("上の写真を見比べながら、ドロップダウンで「単打 / 2塁打 / 3塁打 / 本塁打 / 四球」などを切り替え、生還した回はチェックを入れてください。")

        col_m1, col_m2 = st.columns(2)
        match_date = col_m1.text_input("試合日", value=st.session_state.match_info.get("date", ""))
        opponent = col_m2.text_input("対戦相手", value=st.session_state.match_info.get("opponent", ""))

        df_editor_source = pd.DataFrame(st.session_state.raw_players)

        edited_grid = st.data_editor(
            df_editor_source,
            column_config={
                "打順": st.column_config.NumberColumn("打順", width="small"),
                "背番号": st.column_config.TextColumn("背番号", width="small"),
                "選手名": st.column_config.TextColumn("選手名", width="medium"),
                "打席1": st.column_config.SelectboxColumn("打席1", options=RESULT_OPTIONS, required=True),
                "生還1": st.column_config.CheckboxColumn("生還1"),
                "打席2": st.column_config.SelectboxColumn("打席2", options=RESULT_OPTIONS, required=True),
                "生還2": st.column_config.CheckboxColumn("生還2"),
                "打席3": st.column_config.SelectboxColumn("打席3", options=RESULT_OPTIONS, required=True),
                "生還3": st.column_config.CheckboxColumn("生還3"),
                "打席4": st.column_config.SelectboxColumn("打席4", options=RESULT_OPTIONS, required=True),
                "生還4": st.column_config.CheckboxColumn("生還4"),
                "打席5": st.column_config.SelectboxColumn("打席5", options=RESULT_OPTIONS, required=True),
                "生還5": st.column_config.CheckboxColumn("生還5"),
                "盗塁": st.column_config.NumberColumn("盗塁", width="small"),
                "打点": st.column_config.NumberColumn("打点", width="small"),
                "ハイライト": st.column_config.TextColumn("ハイライト"),
            },
            use_container_width=True,
            num_rows="dynamic",
            key="grid_editor"
        )

        df_calculated = calculate_stats_from_grid(edited_grid)
        st.session_state.calculated_df = df_calculated

        st.markdown("#### 📊 個人成績プレビュー（自動合算）")
        st.dataframe(
            df_calculated[["背番号", "選手名", "打数", "単打", "2塁打", "3塁打", "本塁打", "安打計", "四球", "盗塁", "打点", "得点", "打席明細"]],
            use_container_width=True
        )

        excel_bytes = create_excel_from_calc(df_calculated, match_date, opponent)
        st.download_button(
            label="📥 確定した個人成績Excelをダウンロード",
            data=excel_bytes,
            file_name=f"卒団生_確定成績_{match_date or '最新'}.xlsx",
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

        sb_leaders = df.groupby("display_name")["盗塁"].sum().sort_values(ascending=False)
        if not sb_leaders.empty and sb_leaders.iloc[0] > 0:
            col2.metric("スピードスター賞（最多盗塁）", f"{sb_leaders.index[0]} 選手", f"{int(sb_leaders.iloc[0])} 個")

        hr_leaders = df.groupby("display_name")["本塁打"].sum().sort_values(ascending=False)
        if not hr_leaders.empty and hr_leaders.iloc[0] > 0:
            col3.metric("スラッガー賞（本塁打）", f"{hr_leaders.index[0]} 選手", f"{int(hr_leaders.iloc[0])} 本")

        st.divider()

        st.subheader("⚾️ 卒団記念 デジタル選手名鑑")
        selected_player = st.selectbox("選手を選択してください", players)
        player_data = df[df["display_name"] == selected_player]

        ab = player_data["打数"].sum()
        h = player_data["安打計"].sum()
        avg = (h / ab) if ab > 0 else 0.0
        runs = player_data["得点"].sum()
        hr = player_data["本塁打"].sum()
        sb = player_data["盗塁"].sum()

        st.markdown(f"### **{selected_player}** 選手の通算成績")
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("通算打率", f".{int(avg * 1000):03d}" if avg > 0 else ".000")
        c2.metric("通算安打数", f"{int(h)} 本")
        c3.metric("本塁打", f"{int(hr)} 本")
        c4.metric("盗塁数", f"{int(sb)} 個")

        st.markdown("#### 📝 打席明細ログ")
        for summary in player_data["打席明細"]:
            st.write(f"・{summary}")

        st.markdown("#### 🔥 記憶に残るベストハイライト")
        for hl in player_data["ハイライト"].dropna():
            if str(hl).strip():
                st.write(f"・{hl}")
