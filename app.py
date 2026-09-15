import io
import json
from google import genai
from google.genai import types
import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
import pandas as pd
from PIL import Image
import streamlit as st

# ==========================================
# 画面設定
# ==========================================
st.set_page_config(page_title="スコア自動集計", page_icon="⚾️")
st.title("⚾️ 少年野球スコア自動集計アプリ")

# APIキーの入力（Secretsまたは画面から）
api_key = st.secrets.get("GEMINI_API_KEY", None)
if not api_key:
    api_key = st.sidebar.text_input("Gemini API Key", type="password")

if not api_key:
    st.warning(
        "サイドバーにGemini APIキーを入力するか、Secretsに登録してください。"
    )
    st.stop()

client = genai.Client(api_key=api_key)

# ==========================================
# 固定プロンプト定義
# ==========================================
SYSTEM_PROMPT = """
あなたは学童野球の手書きスコアブック（早稲田式）の解析専門AIです。
画像から出場選手全員の打撃成績を正確に抽出し、JSON配列のみを出力してください。

【厳格ルール：推測の完全排除】
- 文字・記号がかすれている、重なっている等で確信が持てない箇所は絶対に推測で埋めないこと。
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
    "is_unreadable": 読めない箇所があれば true,
    "unreadable_note": "未判別理由（例: 3回裏の記号重なり）"
  }
]
"""


# ==========================================
# Excel生成関数（選手別シート＆黄色ハイライト）
# ==========================================
def create_excel(records):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)  # 初期シート削除

    yellow_fill = PatternFill(
        start_color="FFF2CC", end_color="FFF2CC", fill_type="solid"
    )
    red_font = Font(color="9C0006", bold=True)

    # 選手ごとにデータをグルーピング
    players = {}
    for r in records:
        key = f"{r.get('uniform_number', '')}_{r.get('player_name', '未登録')}".strip(
            "_"
        )
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
                m.get("unreadable_note", ""),
            ]
            ws.append(row)
            curr_row = ws.max_row

            # 読めなかったセルを黄色で着色
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


# ==========================================
# 画面操作部
# ==========================================
uploaded_files = st.file_uploader(
    "スコアブックの写真を撮影・選択（複数枚可）",
    type=["jpg", "jpeg", "png"],
    accept_multiple_files=True,
)

if uploaded_files:
    if st.button("AI解析を実行する"):
        all_records = []
        progress_bar = st.progress(0)

        for i, file in enumerate(uploaded_files):
            st.write(f"解析中: {file.name}...")
            img_bytes = file.read()

            try:
                response = client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=[
                        types.Part.from_bytes(
                            data=img_bytes, mime_type="image/jpeg"
                        ),
                        "このスコアブックの出場選手成績を抽出してください。",
                    ],
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        response_mime_type="application/json",
                        temperature=0.1,
                    ),
                )
                data = json.loads(response.text)
                all_records.extend(data)
            except Exception as e:
                st.error(f"{file.name} の解析中にエラーが発生しました: {e}")

            progress_bar.progress((i + 1) / len(uploaded_files))

        if all_records:
            st.success("全画像の解析が完了しました！")
            excel_data = create_excel(all_records)

            st.download_button(
                label="📥 選手別シート付きExcelをダウンロード",
                data=excel_data,
                file_name="卒団生_打撃成績一覧.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
