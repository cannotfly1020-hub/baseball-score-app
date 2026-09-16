import io
import json
from google import genai
from google.genai import types
import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
import pandas as pd
import streamlit as st
from PIL import Image

st.set_page_config(
    page_title="学童野球スコア集計＆卒団アルバム",
    page_icon="⚾️",
    layout="wide",
)

# セッション状態の初期化
if "matches_data" not in st.session_state:
    st.session_state.matches_data = []

# APIキー設定（Secretsまたはサイドバー）
api_key = st.secrets.get("GEMINI_API_KEY")
if not api_key:
    api_key = st.sidebar.text_input("管理者APIキー (Gemini)", type="password")

client = genai.Client(api_key=api_key) if api_key else None

# ==========================================
# 妥協なし・詳細ルール完全網羅プロンプト（一切省略なし）
# ==========================================
SYSTEM_PROMPT = """
あなたは学童野球の手書きスコアブック（早稲田式）の解析専門AIです。
画像から出場選手全員の「イニング別打撃結果」および個人成績を下書きデータとして正確に抽出し、指定のJSON配列のみを出力してください。

【読み取り対象領域とイニング対応の厳格ルール（最重要）】
1. スコアシート最上部の大きな数字（1, 2, 3, 4, 5, 6, 7, 8, 9）は「イニング列（回）」です。打席結果や打点、背番号などと絶対に混同しないでください。
2. スコアシート下部の「合計・投球数・得点・安打・失策」欄は全体の集計欄です。打者の打席結果としてカウントしないでください。
3. 読み取る対象は、各打順・選手名の右横に並ぶ「ひし形（ダイヤモンド）の打席マス目」のみです。
4. 各マス目が最上部のどのイニング数字の真下にあるかを厳密に照合し、該当するイニング番号（"1"〜"7"）に打席結果を割り当ててください。打席がないイニングは必ず "なし" としてください。

【安打および長打の判定ルール（最重要・厳格適用）】
中央のひし形（ダイヤモンド）枠に引かれた「赤色の線」の本数・到達位置で安打種別を厳密に判定してください：
- 右下の辺のみ赤線（一塁到達）: 単打
- 一塁から二塁（真上頂点）まで連続した赤線: 2塁打
- 一塁〜二塁〜三塁（左端頂点）まで連続した赤線: 3塁打
- 一塁〜二塁〜三塁〜本塁まで赤線で四角を一周囲んでいる: 本塁打（ランニングホームラン含む）
※黒鉛筆でゴロやフライ等の凡打記号（3A、4-3、Kなど）が書かれていても、赤線でダイヤモンドが結線されている場合は安打の記録（単打・2塁打・3塁打・本塁打）を最優先してください。
※単なる暴投(wp)や盗塁(S)による進塁線と、打者自身の安打打球による結線を混同しないでください。

【選手交代・代打の判定ルール（最重要）】
1. 打順欄に上下二段で選手名や背番号が書かれている場合、上段が「先発選手」、下段が「途中出場・代打選手」です。
2. マス目付近に「赤ペンで代打（またはPH）」や選手名が追記された打席から、下段の交代選手に切り替えて打席・成績を集計してください。
3. 交代前のイニング・打席は上段の先発選手に割り当て、交代後のイニング・打席は下段の交代選手として別オブジェクト（選手）として独立して出力してください。

【括弧書き数字「(数字)」の解釈（最重要）】
- マス目内に書かれている「(6)」「(8)」「(9)」などの括弧付き数字は、「その打順の選手の打撃や進塁打によって次の塁へ進んだこと」を示す進塁責任打者の記録です。
- これは打者本人の打撃結果（守備位置コードや打点など）ではありません。惑わされず、進塁や得点の補助情報として扱い、打者本人の打撃結果（安打・四死球・アウト）と混同しないでください。

【早稲田式記号の標準解釈】
- 「K」「Ⓚ」: 三振
- 「四」「B」: 四球
- 「DB」「死」: 死球
- 「3A」「1A」などの「数字+A」: 内野ゴロ凡打（3A=サードゴロ等、アウト）
- 「4-3」「6-4-3」などのハイフン表記: 内野ゴロ送球アウト / 併殺打
- 「8」「7」「9」などの外野数字単体やフライ線記号: 外野フライ（アウト）
- 丸囲みの数字（①, ②, ③）: そのイニングのアウトカウント
- 「wp」: 暴投、「pb」: 捕逸、「S」: 盗塁

【確信度と判定基準】
- 上記の標準的な早稲田式ルールや赤線の結線ルールに合致している場合は、迷わず確定値として処理してください。
- インク潰れや重なり等でどうしても判別できない箇所がある場合のみ、ハイライトやメモに記載してください。

【出力フォーマット（JSON配列のみ返却）】
[
  {
    "batting_order": 打順番号(1〜9),
    "uniform_number": "背番号（不明なら空文字）",
    "player_name": "選手名",
    "is_substitute": 交代選手なら true / 先発なら false,
    "innings": {
      "1": "単打 / 2塁打 / 3塁打 / 本塁打 / 四球 / 死球 / 三振 / 凡打 / 犠打 / なし",
      "2": "なし",
      "3": "なし",
      "4": "なし",
      "5": "なし",
      "6": "なし",
      "7": "なし"
    },
    "highlight": "その試合の印象的なプレー（例: 4回裏の豪快なランニング本塁打、気迫の代打出塁など）"
  }
]
"""

RESULT_OPTIONS = ["なし", "単打", "2塁打", "3塁打", "本塁打", "四球", "死球", "三振", "凡打", "犠打"]

def calculate_stats_from_grid(grid_players):
    """ポチポチ盤面で確定されたイニング結果から個人成績を集計する"""
    compiled_records = []
    for p in grid_players:
        ab = 0
        hits = 0
        doubles = 0
        triples = 0
        hrs = 0
        so = 0
        bb = 0
        db = 0
        pa = 0

        for inn_str in ["1", "2", "3", "4", "5", "6", "7"]:
            res = p["innings"].get(inn_str, "なし")
            if res == "なし":
                continue
            pa += 1
            if res == "単打":
                hits += 1
                ab += 1
            elif res == "2塁打":
                doubles += 1
                ab += 1
            elif res == "3塁打":
                triples += 1
                ab += 1
            elif res == "本塁打":
                hrs += 1
                ab += 1
            elif res == "三振":
                so += 1
                ab += 1
            elif res == "凡打":
                ab += 1
            elif res == "四球":
                bb += 1
            elif res == "死球":
                db += 1
            elif res == "犠打":
                pass

        compiled_records.append({
            "batting_order": p.get("batting_order", 0),
            "uniform_number": p.get("uniform_number", ""),
            "player_name": p.get("player_name", "未登録"),
            "plate_appearances": pa,
            "at_bats": ab,
            "hits": hits,
            "doubles": doubles,
            "triples": triples,
            "homeruns": hrs,
            "strikeouts": so,
            "walks": bb,
            "dead_ball": db,
            "stolen_bases": 0,
            "rbi": 0,
            "runs": 0,
            "highlight": p.get("highlight", "")
        })
    return compiled_records


def create_excel_from_compiled(all_records):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    players = {}
    for r in all_records:
        name = r.get("player_name") or "未登録"
        num = r.get("uniform_number") or ""
        key = f"{num}_{name}".strip("_")
        players.setdefault(key, []).append(r)

    headers = [
        "日付", "対戦相手", "打席", "打数", "安打", "2塁打", "3塁打", "本塁打",
        "三振", "四球", "死球", "盗塁", "打点", "得点", "ハイライト"
    ]

    for player_key, matches in players.items():
        ws = wb.create_sheet(title=player_key[:30])
        ws.append(headers)

        for col in range(1, len(headers) + 1):
            c = ws.cell(row=1, column=col)
            c.font = Font(bold=True)
            c.alignment = Alignment(horizontal="center")

        for m in matches:
            ws.append([
                m.get("match_date", "-"),
                m.get("opponent", "-"),
                m.get("plate_appearances", 0),
                m.get("at_bats", 0),
                m.get("hits", 0),
                m.get("doubles", 0),
                m.get("triples", 0),
                m.get("homeruns", 0),
                m.get("strikeouts", 0),
                m.get("walks", 0),
                m.get("dead_ball", 0),
                m.get("stolen_bases", 0),
                m.get("rbi", 0),
                m.get("runs", 0),
                m.get("highlight", "")
            ])

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()


# タブ構成
tab_admin, tab_kids = st.tabs(
    ["📝 役員用（打席盤面ポチポチ＆Excel出力）", "🏆 選手名鑑＆アワード"]
)

# ==========================================
# ① 役員用（画像照合 ＋ 付箋タブ形式ポチポチ確定）
# ==========================================
with tab_admin:
    st.subheader("手書きスコア入力盤面（画像照合 ＋ ポチポチ確定）")
    st.caption("AIが選手名やイニングごとの打席結果（1回〜7回）を下書きします。付箋タブで選手を切り替えながら、プルダウンでサッと直して確定できます。")

    if not client:
        st.warning("Gemini APIキーを設定してください（Secrets または サイドバー）。")
        st.stop()

    uploaded_file = st.file_uploader("スコアブック写真を選択", type=["jpg", "jpeg", "png"])

    if uploaded_file:
        img = Image.open(uploaded_file)

        if st.button("AIで下書きを作成する", type="primary"):
            with st.spinner("スコアブックを詳細ルールに基づいて解析中..."):
                img_bytes = uploaded_file.getvalue()
                try:
                    res = client.models.generate_content(
                        model="gemini-3.6-flash",
                        contents=[
                            types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
                            "このスコアブックのイニング別打席詳細と選手成績を抽出してください。"
                        ],
                        config=types.GenerateContentConfig(
                            system_instruction=SYSTEM_PROMPT,
                            response_mime_type="application/json",
                            temperature=0.1
                        )
                    )
                    parsed = json.loads(res.text)
                    st.session_state.matches_data = parsed
                    st.success("✅ 下書きが完了しました！下の付箋タブで選手を切り替えて確認・微修正してください。")
                except Exception as e:
                    st.error(f"解析エラー: {e}")

        # 照合・付箋（タブ）形式編集エリア
        if st.session_state.matches_data:
            st.divider()
            col_img, col_grid = st.columns([1, 1.4])

            with col_img:
                st.markdown("#### 📷 スコアブック原本")
                st.image(img, use_container_width=True)

            with col_grid:
                st.markdown("#### 🎯 打席盤面エディタ（付箋タブで選手選択）")
                st.caption("選手名の付箋（タブ）をクリックすると、その選手の打席結果（1回〜7回）が表示されます。")

                # 選手ごとの付箋（タブタイトル）リストを作成
                tab_labels = []
                for idx, player in enumerate(st.session_state.matches_data):
                    order_val = player.get("batting_order", idx + 1)
                    p_name = player.get("player_name", "選手")
                    sub_tag = "(代)" if player.get("is_substitute") else ""
                    tab_labels.append(f"{order_val}番 {p_name}{sub_tag}")

                # 付箋（タブ）を生成
                player_tabs = st.tabs(tab_labels)
                edited_players = []

                for idx, (p_tab, player) in enumerate(zip(player_tabs, st.session_state.matches_data)):
                    with p_tab:
                        is_sub = player.get("is_substitute", False)
                        order_val = player.get("batting_order", idx + 1)

                        st.markdown(f"##### **【{order_val}番打者】 {'途中交代・代打' if is_sub else '先発出場'}**")

                        p_cols = st.columns([1, 2, 3])
                        u_num = p_cols[0].text_input("背番号", value=player.get("uniform_number", ""), key=f"num_{idx}")
                        p_name = p_cols[1].text_input("選手名", value=player.get("player_name", ""), key=f"name_{idx}")
                        hl = p_cols[2].text_input("ハイライトメモ", value=player.get("highlight", ""), key=f"hl_{idx}")

                        st.markdown("**各イニングの打撃結果（1回〜7回）**")
                        inn_cols = st.columns(7)
                        new_innings = {}
                        for i_idx, inn_str in enumerate(["1", "2", "3", "4", "5", "6", "7"]):
                            cur_val = player.get("innings", {}).get(inn_str, "なし")
                            default_idx = RESULT_OPTIONS.index(cur_val) if cur_val in RESULT_OPTIONS else 0
                            sel = inn_cols[i_idx].selectbox(
                                f"{inn_str}回",
                                RESULT_OPTIONS,
                                index=default_idx,
                                key=f"inn_{idx}_{inn_str}"
                            )
                            new_innings[inn_str] = sel

                        edited_players.append({
                            "batting_order": order_val,
                            "uniform_number": u_num,
                            "player_name": p_name,
                            "is_substitute": is_sub,
                            "innings": new_innings,
                            "highlight": hl
                        })

                st.write("")
                if st.button("💾 この内容で成績を確定・Excelを作成する", type="primary", use_container_width=True):
                    st.session_state.matches_data = edited_players
                    compiled = calculate_stats_from_grid(edited_players)
                    st.session_state["compiled_records"] = compiled
                    st.success("🎉 成績を確定しました！下のボタンからダウンロードできます。")

            # 確定後のExcelダウンロードボタン
            if "compiled_records" in st.session_state:
                st.divider()
                excel_data = create_excel_from_compiled(st.session_state["compiled_records"])
                st.download_button(
                    label="📥 確定版 選手別シート付きExcelをダウンロード",
                    data=excel_data,
                    file_name="卒団生_打撃成績一覧.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    use_container_width=True
                )

# ==========================================
# ② 選手名鑑＆アワード
# ==========================================
with tab_kids:
    compiled_data = st.session_state.get("compiled_records")
    if not compiled_data:
        st.info("👈 まず「役員用」タブでスコアを確定させてください。")
    else:
        df = pd.DataFrame(compiled_data)
        df["display_name"] = df["uniform_number"].fillna("").astype(str) + " " + df["player_name"].fillna("未登録")
        players = df["display_name"].unique().tolist()

        st.subheader("🎖️ チームタイトル・アワード")
        c1, c2, c3 = st.columns(3)

        hit_leaders = df.groupby("player_name")["hits"].sum().sort_values(ascending=False)
        if not hit_leaders.empty and hit_leaders.iloc[0] > 0:
            c1.metric("チーム最多単打", f"{hit_leaders.index[0]} 選手", f"{int(hit_leaders.iloc[0])} 本")

        total_h = df["hits"] + df["doubles"] + df["triples"] + df["homeruns"]
        df["total_hits"] = total_h
        tb_leaders = df.groupby("player_name")["total_hits"].sum().sort_values(ascending=False)
        if not tb_leaders.empty and tb_leaders.iloc[0] > 0:
            c2.metric("最多安打（長打含む）", f"{tb_leaders.index[0]} 選手", f"{int(tb_leaders.iloc[0])} 本")

        hr_leaders = df.groupby("player_name")["homeruns"].sum().sort_values(ascending=False)
        if not hr_leaders.empty and hr_leaders.iloc[0] > 0:
            c3.metric("スラッガー賞（本塁打）", f"{hr_leaders.index[0]} 選手", f"{int(hr_leaders.iloc[0])} 本")

        st.divider()
        st.subheader("⚾️ 卒団記念 デジタル選手名鑑")
        selected_player = st.selectbox("選手を選択してください", players)
        player_data = df[df["display_name"] == selected_player]

        ab = player_data["at_bats"].sum()
        h = player_data["total_hits"].sum()
        avg = (h / ab) if ab > 0 else 0.0
        hr = player_data["homeruns"].sum()

        st.markdown(f"### **{selected_player}** 選手の確定成績")
        col1, col2, col3 = st.columns(3)
        col1.metric("打率", f".{int(avg * 1000):03d}" if avg > 0 else ".000")
        col2.metric("通算安打", f"{int(h)} 本")
        col3.metric("本塁打", f"{int(hr)} 本")

        st.markdown("#### 🔥 ベストハイライト")
        hl_list = player_data[player_data["highlight"].str.strip() != ""]["highlight"].tolist()
        if hl_list:
            for hl in hl_list:
                st.write(f"・{hl}")
        else:
            st.write("・全力プレーでチームに大きく貢献！")
