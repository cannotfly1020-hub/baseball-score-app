import io
import json
import cv2
from google import genai
from google.genai import types
import numpy as np
import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
import pandas as pd
from PIL import Image
import streamlit as st

st.set_page_config(
    page_title="学童野球スコア集計＆卒団アルバム",
    page_icon="⚾️",
    layout="wide",
)

if "records" not in st.session_state:
    st.session_state.records = []
if "edited_df" not in st.session_state:
    st.session_state.edited_df = None

api_key = st.secrets.get("GEMINI_API_KEY")
if not api_key:
    api_key = st.sidebar.text_input("管理者APIキー (Gemini)", type="password")

client = genai.Client(api_key=api_key) if api_key else None


def extract_red_highlights(image_bytes):
    """
    照明ムラや薄いボールペン・朱色・ピンクがかった赤線も漏らさず拾えるよう、
    HSV色空間の範囲を大幅に拡大し、線を太く強調する
    """
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    # 赤〜朱色〜赤紫を広くカバーする2つの範囲
    lower_red1 = np.array([0, 40, 40])
    upper_red1 = np.array([15, 255, 255])
    lower_red2 = np.array([150, 40, 40])
    upper_red2 = np.array([180, 255, 255])

    mask1 = cv2.inRange(hsv, lower_red1, upper_red1)
    mask2 = cv2.inRange(hsv, lower_red2, upper_red2)
    mask = mask1 | mask2

    # 細いボールペン線を2ピクセル膨張させてクッキリ可視化
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.dilate(mask, kernel, iterations=2)

    # 元画像の赤線部分のみを抽出し、背景を白くしてコントラストを最大化
    white_bg = np.full_like(img, 255)
    res = np.where(mask[:, :, np.newaxis] == 255, img, white_bg)

    _, buffer = cv2.imencode(".jpg", res)
    return buffer.tobytes()


SYSTEM_PROMPT = """
あなたは学童野球手書きスコア（早稲田式）の「赤ペン線・打席詳細の精密鑑定員」です。
提供される画像は以下の2枚です：
- 1枚目: 元のスコアブック画像（選手名や鉛筆文字を確認）
- 2枚目: 赤ペンインクのみを太く浮き彫りにした画像（ダイヤモンドの赤線を確認）

あなたに「合計計算」や「安打の勝手な判断」は求めません。
各打席について【ダイヤモンドの赤線がどこまで伸びているか】および【鉛筆の文字】をありのまま回答してください。

【赤線の到達位置の判定ルール（2枚目の強調画像で必ず確認すること）】
各打席のダイヤモンド枠において、赤線がどこまで結線されているかを red_line_to に厳密に記録してください：
- "NONE": 赤線なし（アウト、単なる凡打など）
- "1B": 一塁（右下の辺）のみ赤線
- "2B": 一塁から二塁（真上の頂点）まで連続して赤線が引かれている
- "3B": 一塁〜二塁〜三塁（左端の頂点）まで連続して赤線が引かれている（例: 4番打者の打席）
- "HOME": 四角形（ダイヤモンド）の四辺すべてが赤線で一周囲まれている（本塁生還・得点）

※注意：
- 5番打者のマス付近にある「波線（クネクネ線）」は相手投手交代の印です。red_line_to には含めず "NONE" としてください。
- 四球(B)や死球(DB)で出塁した後に一周している場合も、赤線が一周していれば red_line_to="HOME" で問題ありません（安打か得点かの判定はシステム側で行います）。

【打順枠の二段書き（選手交代）】
- 上下二段に選手が書かれている場合、背番号が違えば別人です。上段（先発）と下段（交代/代打）を別オブジェクトとして出力してください。
- 例: 9番枠の上段・背番号19と下段・背番号21は完全に別人です。

【鉛筆文字の識別】
- "K" / "Ⓚ": 三振
- "B" / "四": 四球
- "DB" / "死": 死球
- "3A", "1A", "4-3", "6-4-3": 凡打
- "(6)", "(8)", "(9)" 等のカッコ付き数字は進塁打者の記号なので無視してください。

【出力フォーマット（JSON配列のみ返却）】
[
  {
    "match_date": "試合日",
    "opponent": "相手チーム名",
    "batting_order": 打順番号,
    "uniform_number": "背番号",
    "player_name": "選手名",
    "at_bats_details": [
      {
        "inning": イニング番号,
        "pencil_result": "鉛筆文字（例: B, K, 4-3, 3TO など）",
        "red_line_to": "NONE | 1B | 2B | 3B | HOME",
        "is_walk": true/false（四球ならtrue）,
        "is_dead_ball": true/false（死球ならtrue）,
        "is_strikeout": true/false（三振ならtrue）,
        "stolen_bases": 0,
        "rbi": 0
      }
    ],
    "highlight": "好プレー（例: 4回裏の3塁打など）"
  }
]
"""


def summarize_player_records(raw_records):
    """AIが判定した「赤線の到達位置」と「文字」から、Pythonが安打・得点・打数を論理計算する"""
    summarized = []
    for p in raw_records:
        details = p.get("at_bats_details", []) or []

        pa = len(details)
        ab = 0
        hits = 0
        doubles = 0
        triples = 0
        hrs = 0
        so = 0
        bb = 0
        hbp = 0
        sb = 0
        rbi = 0
        runs = 0

        detail_texts = []

        for d in details:
            inning = d.get("inning", "?")
            pencil = d.get("pencil_result", "")
            red = d.get("red_line_to", "NONE")

            is_w = d.get("is_walk", False) or (pencil in ["B", "四"])
            is_db = d.get("is_dead_ball", False) or (pencil in ["DB", "死"])
            is_k = d.get("is_strikeout", False) or ("K" in pencil)

            # 得点（ホーム生還）判定: 赤線が一周していれば得点
            is_run = (red == "HOME")
            if is_run:
                runs += 1

            # 四死球・三振
            if is_w:
                bb += 1
                res_str = "四球"
            elif is_db:
                hbp += 1
                res_str = "死球"
            else:
                # 四死球以外は打数加算
                ab += 1
                if is_k:
                    so += 1
                    res_str = "三振"
                elif red == "3B":
                    triples += 1
                    res_str = "3塁打"
                elif red == "2B":
                    doubles += 1
                    res_str = "2塁打"
                elif red == "1B":
                    hits += 1
                    res_str = "単打"
                elif red == "HOME":
                    # 一周で四死球でない場合は本塁打
                    hrs += 1
                    res_str = "本塁打"
                else:
                    res_str = f"凡打({pencil})" if pencil else "凡打"

            run_str = " [生還]" if is_run else ""
            detail_texts.append(f"{inning}回:{res_str}{run_str}")

            sb += int(d.get("stolen_bases") or 0)
            rbi += int(d.get("rbi") or 0)

        summarized.append(
            {
                "match_date": p.get("match_date"),
                "opponent": p.get("opponent"),
                "batting_order": p.get("batting_order"),
                "uniform_number": p.get("uniform_number"),
                "player_name": p.get("player_name"),
                "at_bats_summary": " / ".join(detail_texts),
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
                "highlight": p.get("highlight", ""),
            }
        )
    return summarized


def create_excel_from_df(df):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    headers = [
        "日付",
        "対戦相手",
        "背番号",
        "選手名",
        "打順",
        "打席詳細",
        "打席",
        "打数",
        "単打",
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
    ]

    players = df.groupby(["uniform_number", "player_name"])

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
                row_data.get("match_date"),
                row_data.get("opponent"),
                row_data.get("uniform_number"),
                row_data.get("player_name"),
                row_data.get("batting_order"),
                row_data.get("at_bats_summary"),
                row_data.get("plate_appearances"),
                row_data.get("at_bats"),
                row_data.get("hits"),
                row_data.get("doubles"),
                row_data.get("triples"),
                row_data.get("homeruns"),
                row_data.get("strikeouts"),
                row_data.get("walks"),
                row_data.get("dead_ball"),
                row_data.get("stolen_bases"),
                row_data.get("rbi"),
                row_data.get("runs"),
                row_data.get("highlight", ""),
            ]
            ws.append(row)

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


tab_admin, tab_kids = st.tabs(
    ["📁 役員用（スコア解析＆Excel出力）", "🏆 選手名鑑＆アワード"]
)

# ==========================================
# ① 役員用画面
# ==========================================
with tab_admin:
    st.subheader("手書きスコア自動解析（赤線ハイパーブースト版）")
    st.caption("赤インク検出範囲を広げ、太く強調した画像と照合して解析します。")

    if not client:
        st.warning("Gemini APIキーを設定してください。")
        st.stop()

    uploaded_files = st.file_uploader(
        "スコアブック写真を選択",
        type=["jpg", "jpeg", "png"],
        accept_multiple_files=True,
    )

    if uploaded_files:
        if st.button("AI自動解析を開始する", type="primary"):
            new_records = []
            progress = st.progress(0)
            status = st.empty()

            for i, f in enumerate(uploaded_files):
                status.text(f"赤線強化中 ({i+1}/{len(uploaded_files)}): {f.name}...")
                img_bytes = f.read()

                # 赤ペン強調画像を生成
                red_highlight_bytes = extract_red_highlights(img_bytes)

                # 画面上でも「赤線がどう見えているか」を確認できるように表示
                with st.expander(f"🔍 {f.name} の赤ペン抽出プレビュー（AIに送る強調画像）"):
                    col_img1, col_img2 = st.columns(2)
                    col_img1.image(img_bytes, caption="元画像", use_container_width=True)
                    col_img2.image(red_highlight_bytes, caption="赤線抽出・強調画像", use_container_width=True)

                try:
                    res = client.models.generate_content(
                        model="gemini-3.6-flash",
                        contents=[
                            types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
                            types.Part.from_bytes(data=red_highlight_bytes, mime_type="image/jpeg"),
                            "1枚目の元画像と、2枚目の赤ペン強調画像を照合し、各打席の赤線の到達位置(1B, 2B, 3B, HOME, NONE)と鉛筆文字を漏れなく抽出してください。",
                        ],
                        config=types.GenerateContentConfig(
                            system_instruction=SYSTEM_PROMPT,
                            response_mime_type="application/json",
                            temperature=0.1,
                        ),
                    )
                    raw_data = json.loads(res.text)
                    calc_data = summarize_player_records(raw_data)
                    new_records.extend(calc_data)
                except Exception as e:
                    st.error(f"{f.name} の解析エラー: {e}")

                progress.progress((i + 1) / len(uploaded_files))

            status.empty()
            if new_records:
                st.session_state.records = new_records
                st.session_state.edited_df = pd.DataFrame(new_records)
                st.success("🎉 赤線鑑定と成績計算が完了しました！")

    if st.session_state.records:
        st.markdown("### ✏️ 成績確認・手動修正テーブル")
        st.caption("AIが読み取った打席明細です。表のセルをクリックして修正できます。")

        display_columns = [
            "uniform_number",
            "player_name",
            "at_bats_summary",
            "plate_appearances",
            "at_bats",
            "hits",
            "doubles",
            "triples",
            "homeruns",
            "walks",
            "runs",
            "highlight",
        ]

        if st.session_state.edited_df is None:
            st.session_state.edited_df = pd.DataFrame(st.session_state.records)

        edited_df = st.data_editor(
            st.session_state.edited_df[display_columns],
            column_config={
                "uniform_number": "背番号",
                "player_name": "選手名",
                "at_bats_summary": "打席明細（各回の結果）",
                "plate_appearances": "打席",
                "at_bats": "打数",
                "hits": "単打",
                "doubles": "2塁打",
                "triples": "3塁打",
                "homeruns": "本塁打",
                "walks": "四球",
                "runs": "得点",
                "highlight": "ハイライト",
            },
            use_container_width=True,
            num_rows="dynamic",
        )

        st.session_state.edited_df.update(edited_df)

        excel_file = create_excel_from_df(st.session_state.edited_df)
        st.download_button(
            label="📥 修正を反映したExcelをダウンロード",
            data=excel_file,
            file_name="卒団生_打撃成績一覧.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

# ==========================================
# ② 選手名鑑＆アワード
# ==========================================
with tab_kids:
    active_df = (
        st.session_state.edited_df
        if st.session_state.edited_df is not None
        else pd.DataFrame(st.session_state.records)
    )

    if active_df.empty:
        st.info("👈 まず「役員用」タブでスコアを解析してください。")
    else:
        df = active_df.copy()
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
            df.groupby("display_name")["stolen_bases"].sum().sort_values(ascending=False)
        )
        if not sb_leaders.empty and sb_leaders.iloc[0] > 0:
            col2.metric("スピードスター賞", f"{sb_leaders.index[0]} 選手", f"{int(sb_leaders.iloc[0])} 個")

        hr_leaders = (
            df.groupby("display_name")["homeruns"].sum().sort_values(ascending=False)
        )
        if not hr_leaders.empty and hr_leaders.iloc[0] > 0:
            col3.metric("スラッガー賞", f"{hr_leaders.index[0]} 選手", f"{int(hr_leaders.iloc[0])} 本")

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
