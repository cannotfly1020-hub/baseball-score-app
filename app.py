import io
import json
import base64
from google import genai
from google.genai import types
import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
import pandas as pd
import streamlit as st
import streamlit.components.v1 as components
from PIL import Image

st.set_page_config(
    page_title="学童野球スコア集計",
    page_icon="⚾️",
    layout="wide",
)

# セッション状態の初期化
if "all_matches_data" not in st.session_state:
    # 複数試合を辞書形式で管理: { "ファイル名": [選手データリスト], ... }
    st.session_state.all_matches_data = {}
if "match_images_b64" not in st.session_state:
    # 各試合のBase64画像辞書: { "ファイル名": base64文字列, ... }
    st.session_state.match_images_b64 = {}

# APIキー設定（Secretsまたはサイドバー）
api_key = st.secrets.get("GEMINI_API_KEY")
if not api_key:
    api_key = st.sidebar.text_input("管理者APIキー (Gemini)", type="password")

client = genai.Client(api_key=api_key) if api_key else None

# ==========================================
# 妥協なし・打点＆盗塁対応 精度研磨プロンプト
# ==========================================
SYSTEM_PROMPT = """
あなたは学童野球の手書きスコアブック（早稲田式）の解析専門AIです。
画像から出場選手全員（先発・交代選手・代打を漏れなく）の「イニング別打撃結果」「打点」「盗塁数」および個人成績を下書きデータとして正確に抽出し、指定のJSON配列のみを出力してください。

【選手名・背番号の網羅（最重要・漏れ厳禁）】
1. 打順欄が上下二段書きになっている場合、上段の「先発選手」だけでなく、下段に書かれた「交代選手・代打選手」も絶対に漏らさず別の選手オブジェクトとして抽出してください。
2. 背番号（数字）と選手名（漢字・ひらがな）を正確に読み取ってください。
3. 代打メモ（赤ペンでPH、代打など）がある打席から、下段の交代選手へ打席を切り替えてください。交代前の打席は先発選手に割り当ててください。

【読み取り対象領域とイニング対応の厳格ルール】
1. スコアシート最上部の大きな数字（1, 2, 3, 4, 5, 6, 7, 8, 9）は「イニング列（回）」です。打席結果や打点、背番号などと絶対に混同しないでください。
2. スコアシート下部の「合計・投球数・得点・安打・失策」欄は全体の集計欄です。打者の打席結果としてカウントしないでください。
3. 読み取る対象は、各選手の行にある「ひし形（ダイヤモンド）の打席マス目」のみです。
4. 各マス目が最上部のどのイニング数字の真下にあるかを照合し、該当するイニング番号（"1"〜"7"）に打席結果を割り当ててください。打席のないイニングは必ず "なし" としてください。

【安打および長打の判定ルール（厳格適用）】
中央のひし形（ダイヤモンド）枠に引かれた「赤色の線」の本数・到達位置で安打種別を厳密に判定してください：
- 右下の辺のみ赤線（一塁到達）: 単打
- 一塁から二塁（真上頂点）まで連続した赤線: 2塁打
- 一塁〜二塁〜三塁（左端頂点）まで連続した赤線: 3塁打
- 一塁〜二塁〜三塁〜本塁まで赤線で四角を一周囲んでいる: 本塁打（ランニングホームラン含む）
※黒鉛筆でゴロやフライ等の凡打記号（3A、4-3、Kなど）が書かれていても、赤線でダイヤモンドが結線されている場合は安打の記録（単打・2塁打・3塁打・本塁打）を最優先してください。
※単なる暴投(wp)や盗塁(S)による進塁線と、打者自身の安打打球による結線を混同しないでください。

【打点および盗塁の判定ルール】
1. 打点 (rbi):
   - 安打（赤線）や適時打の際、マス目周辺や打点欄に記された数字、あるいは得点が入ったことが明確なタイムリー打席から試合全体の合計打点を計算してください（不明・なしなら0）。
2. 盗塁 (stolen_bases):
   - マス目内のダイヤモンド進塁線周辺に「S」「〄」などの盗塁記号がある場合、その個数をカウントして合計盗塁数としてください（不明・なしなら0）。

【括弧書き数字「(数字)」の解釈】
- マス目内に書かれている「(6)」「(8)」「(9)」などの括弧付き数字は、「その打順の選手の打撃や進塁打によって次の塁へ進んだこと」を示す進塁責任打者の記録です。
- これは打者本人の打撃結果（守備位置コードや打点など）ではありません。打者本人の打撃結果（安打・四死球・アウト）と混同しないでください。

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
- 標準的な記号や赤線の規則に合致している場合は確定値として処理してください。
- インク潰れや重なり等でどうしても判別できない箇所がある場合のみ、ハイライトやメモに記載してください。

【出力フォーマット（JSON配列のみ返却）】
[
  {
    "match_date": "スコア記載の試合日（不明なら UNREADABLE）",
    "opponent": "対戦相手チーム名（不明なら UNREADABLE）",
    "batting_order": 打順番号(1〜9),
    "uniform_number": "背番号（不明なら空文字）",
    "player_name": "選手名",
    "is_substitute": 交代選手なら true / 先発なら false,
    "rbi": 打点数(数値),
    "stolen_bases": 盗塁数(数値),
    "innings": {
      "1": "単打 / 2塁打 / 3塁打 / 本塁打 / 四球 / 死球 / 三振 / 凡打 / 犠打 / なし",
      "2": "なし",
      "3": "なし",
      "4": "なし",
      "5": "なし",
      "6": "なし",
      "7": "なし"
    },
    "highlight": "その試合の印象的なプレー（例: 4回裏の豪快なランニング本塁打、代打での気迫の出塁など）"
  }
]
"""

RESULT_OPTIONS = ["なし", "単打", "2塁打", "3塁打", "本塁打", "四球", "死球", "三振", "凡打", "犠打"]

def calculate_stats_from_grid(grid_players, match_file_name=""):
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
            "source_file": match_file_name,
            "match_date": p.get("match_date", "-"),
            "opponent": p.get("opponent", "-"),
            "batting_order": p.get("batting_order", 0),
            "uniform_number": str(p.get("uniform_number", "")).strip(),
            "player_name": str(p.get("player_name", "未登録")).strip(),
            "plate_appearances": pa,
            "at_bats": ab,
            "hits": hits,
            "doubles": doubles,
            "triples": triples,
            "homeruns": hrs,
            "strikeouts": so,
            "walks": bb,
            "dead_ball": db,
            "stolen_bases": int(p.get("stolen_bases", 0)),
            "rbi": int(p.get("rbi", 0)),
            "runs": 0,
            "highlight": p.get("highlight", "")
        })
    return compiled_records


def create_excel_from_compiled(all_records):
    """選手名（名前）のみをキーにしてシートを生成（複数試合・背番号違いを1シートに統合）"""
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    players = {}
    for r in all_records:
        name = (r.get("player_name") or "未登録").strip()
        players.setdefault(name, []).append(r)

    headers = [
        "背番号", "試合日", "対戦相手", "打席", "打数", "安打", "2塁打", "3塁打", "本塁打",
        "三振", "四球", "死球", "盗塁", "打点", "得点", "ハイライト"
    ]

    for player_name, matches in players.items():
        sheet_title = player_name[:30] if player_name else "未登録"
        ws = wb.create_sheet(title=sheet_title)
        ws.append(headers)

        for col in range(1, len(headers) + 1):
            c = ws.cell(row=1, column=col)
            c.font = Font(bold=True)
            c.alignment = Alignment(horizontal="center")

        for m in matches:
            ws.append([
                m.get("uniform_number", ""),
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
    ["📝 役員用（複数試合一括解析＆ポチポチ確定）", "🏆 選手名鑑＆アワード"]
)

# ==========================================
# ① 役員用（複数試合一括アップロード ＋ 切り替え照合エディタ）
# ==========================================
with tab_admin:
    st.subheader("複数手書きスコア一括解析 ＆ 照合エディタ")
    st.caption("何試合分でもまとめてアップロード可能です。1試合ずつ個別に最高精度でAI下書きを行い、画面上で切り替えて微修正できます。")

    if not client:
        st.warning("Gemini APIキーを設定してください（Secrets または サイドバー）。")
        st.stop()

    uploaded_files = st.file_uploader(
        "スコアブック写真を選択（複数ファイル選択可）",
        type=["jpg", "jpeg", "png"],
        accept_multiple_files=True
    )

    if uploaded_files:
        if st.button(f"AIで全{len(uploaded_files)}試合の下書きを一括作成する", type="primary"):
            progress_bar = st.progress(0)
            status_text = st.empty()
            
            new_all_matches = {}
            new_images_b64 = {}

            for idx, f in enumerate(uploaded_files):
                status_text.text(f"解析中 ({idx+1}/{len(uploaded_files)}): {f.name}...")
                raw_bytes = f.read()
                new_images_b64[f.name] = base64.b64encode(raw_bytes).decode()

                try:
                    res = client.models.generate_content(
                        model="gemini-3.6-flash",
                        contents=[
                            types.Part.from_bytes(data=raw_bytes, mime_type="image/jpeg"),
                            "このスコアブックの出場選手全員、イニング別打席詳細、打点、盗塁を正確に抽出してください。"
                        ],
                        config=types.GenerateContentConfig(
                            system_instruction=SYSTEM_PROMPT,
                            response_mime_type="application/json",
                            temperature=0.1
                        )
                    )
                    parsed = json.loads(res.text)
                    new_all_matches[f.name] = parsed
                except Exception as e:
                    st.error(f"{f.name} の解析エラー: {e}")

                progress_bar.progress((idx + 1) / len(uploaded_files))

            status_text.empty()
            if new_all_matches:
                st.session_state.all_matches_data = new_all_matches
                st.session_state.match_images_b64 = new_images_b64
                st.success(f"🎉 全 {len(new_all_matches)} 試合分の下書きが完了しました！下のセレクターで試合を切り替えて確認・確定してください。")

    # 複数試合の照合・編集盤面
    if st.session_state.all_matches_data:
        st.divider()
        match_files = list(st.session_state.all_matches_data.keys())
        
        # 試合選択切り替えボックス
        sel_c1, sel_c2 = st.columns([2, 1])
        selected_match_file = sel_c1.selectbox(
            "📁 確認・編集する試合（スコア写真）を選択してください",
            match_files
        )

        current_players = st.session_state.all_matches_data.get(selected_match_file, [])
        current_b64 = st.session_state.match_images_b64.get(selected_match_file, "")

        # 手動で選手を追加するボタン（選択中の試合に対して）
        add_col1, add_col2 = st.columns([1, 4])
        with add_col1:
            if st.button("➕ この試合に選手を手動追加", help="AIが見落とした交代選手や代打選手枠を新しく追加します"):
                new_player_template = {
                    "batting_order": len(current_players) + 1,
                    "uniform_number": "",
                    "player_name": f"追加選手{len(current_players) + 1}",
                    "is_substitute": True,
                    "rbi": 0,
                    "stolen_bases": 0,
                    "innings": {"1": "なし", "2": "なし", "3": "なし", "4": "なし", "5": "なし", "6": "なし", "7": "なし"},
                    "highlight": ""
                }
                st.session_state.all_matches_data[selected_match_file].append(new_player_template)
                st.rerun()

        col_img, col_grid = st.columns([1.1, 1.3])

        # 左側：選択中試合の原本画像（ズーム機能付き）
        with col_img:
            st.markdown(f"#### 📷 原本画像: `{selected_match_file}`")
            zoom_val = st.slider("🔍 画像拡大率", min_value=100, max_value=350, value=150, step=25, format="%d%%")
            
            viewer_html = f"""
            <div style="width:100%; height:620px; overflow:auto; border:2px solid #ccc; border-radius:8px; background-color:#222; text-align:center;">
                <img src="data:image/jpeg;base64,{current_b64}" style="width:{zoom_val}%; max-width:none; transition:width 0.15s ease-in-out; cursor:grab;" />
            </div>
            """
            components.html(viewer_html, height=640)

        # 右側：選択中試合の付箋タブ編集盤面
        with col_grid:
            st.markdown("#### 🎯 打席盤面エディタ（背番号・名前で選択）")
            st.caption("付箋タブをクリックして、各イニング（1回〜7回）、打点、盗塁を修正できます。")

            tab_labels = []
            for idx, player in enumerate(current_players):
                u_num = str(player.get("uniform_number", "")).strip()
                num_str = f"#{u_num} " if u_num else ""
                p_name = str(player.get("player_name", "選手")).strip()
                sub_tag = "(代)" if player.get("is_substitute") else ""
                tab_labels.append(f"{num_str}{p_name}{sub_tag}")

            player_tabs = st.tabs(tab_labels)
            edited_current_players = []

            for idx, (p_tab, player) in enumerate(zip(player_tabs, current_players)):
                with p_tab:
                    is_sub = player.get("is_substitute", False)
                    order_val = player.get("batting_order", idx + 1)

                    st.markdown(f"##### **選手情報設定 {'（途中交代・代打）' if is_sub else '（先発）'}**")

                    p_cols = st.columns([1, 2, 3])
                    u_num = p_cols[0].text_input("背番号", value=str(player.get("uniform_number", "")), key=f"{selected_match_file}_num_{idx}")
                    p_name = p_cols[1].text_input("選手名（漢字）", value=str(player.get("player_name", "")), key=f"{selected_match_file}_name_{idx}")
                    hl = p_cols[2].text_input("ハイライトメモ", value=str(player.get("highlight", "")), key=f"{selected_match_file}_hl_{idx}")

                    stat_c1, stat_c2 = st.columns(2)
                    rbi_val = stat_c1.number_input("打点 (RBI)", min_value=0, max_value=20, value=int(player.get("rbi", 0)), step=1, key=f"{selected_match_file}_rbi_{idx}")
                    sb_val = stat_c2.number_input("盗塁数 (SB)", min_value=0, max_value=20, value=int(player.get("stolen_bases", 0)), step=1, key=f"{selected_match_file}_sb_{idx}")

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
                            key=f"{selected_match_file}_inn_{idx}_{inn_str}"
                        )
                        new_innings[inn_str] = sel

                    edited_current_players.append({
                        "match_date": player.get("match_date", "-"),
                        "opponent": player.get("opponent", "-"),
                        "batting_order": order_val,
                        "uniform_number": u_num,
                        "player_name": p_name,
                        "is_substitute": is_sub,
                        "rbi": rbi_val,
                        "stolen_bases": sb_val,
                        "innings": new_innings,
                        "highlight": hl
                    })

            # 現在の試合の編集内容をセッションに反映
            st.session_state.all_matches_data[selected_match_file] = edited_current_players

            st.write("")
            if st.button("💾 全試合の成績を統合確定・Excelを作成する", type="primary", use_container_width=True):
                # 全試合のデータを一括で個人成績に変換・統合
                all_compiled = []
                for m_file, p_list in st.session_state.all_matches_data.items():
                    compiled_single = calculate_stats_from_grid(p_list, match_file_name=m_file)
                    all_compiled.extend(compiled_single)

                st.session_state["compiled_records"] = all_compiled
                st.success(f"🎉 アップロードされた全 {len(st.session_state.all_matches_data)} 試合分の成績を確定統合しました！下のボタンからダウンロードできます。")

        # 確定後のExcelダウンロードボタン
        if "compiled_records" in st.session_state:
            st.divider()
            excel_data = create_excel_from_compiled(st.session_state["compiled_records"])
            st.download_button(
                label=f"📥 全{len(st.session_state.all_matches_data)}試合分 選手名別シート付きExcelをダウンロード",
                data=excel_data,
                file_name="通算打撃成績一覧.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                use_container_width=True
            )

# ==========================================
# ② 選手名鑑＆アワード（全試合分を通算合算）
# ==========================================
with tab_kids:
    compiled_data = st.session_state.get("compiled_records")
    if not compiled_data:
        st.info("👈 まず「役員用」タブでスコアを確定させてください。")
    else:
        df = pd.DataFrame(compiled_data)
        players = [p for p in df["player_name"].dropna().unique().tolist() if p.strip() != ""]

        st.subheader("🎖️ チームタイトル・アワード（通算集計）")
        c1, c2, c3, c4 = st.columns(4)

        # 最多安打
        total_h = df["hits"] + df["doubles"] + df["triples"] + df["homeruns"]
        df["total_hits"] = total_h
        tb_leaders = df.groupby("player_name")["total_hits"].sum().sort_values(ascending=False)
        if not tb_leaders.empty and tb_leaders.iloc[0] > 0:
            c1.metric("最多安打（長打含む）", f"{tb_leaders.index[0]} 選手", f"{int(tb_leaders.iloc[0])} 本")

        # スラッガー賞（本塁打）
        hr_leaders = df.groupby("player_name")["homeruns"].sum().sort_values(ascending=False)
        if not hr_leaders.empty and hr_leaders.iloc[0] > 0:
            c2.metric("スラッガー賞（本塁打）", f"{hr_leaders.index[0]} 選手", f"{int(hr_leaders.iloc[0])} 本")

        # 打点王
        rbi_leaders = df.groupby("player_name")["rbi"].sum().sort_values(ascending=False)
        if not rbi_leaders.empty and rbi_leaders.iloc[0] > 0:
            c3.metric("クラッチヒッター賞（打点）", f"{rbi_leaders.index[0]} 選手", f"{int(rbi_leaders.iloc[0])} 打点")

        # 盗塁王
        sb_leaders = df.groupby("player_name")["stolen_bases"].sum().sort_values(ascending=False)
        if not sb_leaders.empty and sb_leaders.iloc[0] > 0:
            c4.metric("スピードスター賞（盗塁）", f"{sb_leaders.index[0]} 選手", f"{int(sb_leaders.iloc[0])} 個")

        st.divider()
        st.subheader("⚾️ デジタル選手名鑑（全試合通算）")
        selected_player = st.selectbox("選手を選択してください（名前で通算集計）", players)
        player_data = df[df["player_name"] == selected_player]

        # 複数試合で着用したすべての背番号を自動抽出して並べる
        used_numbers = [str(n).strip() for n in player_data["uniform_number"].dropna().unique() if str(n).strip() != ""]
        num_display = f"（着用背番号: #{', #'.join(used_numbers)}）" if used_numbers else ""

        ab = player_data["at_bats"].sum()
        h = player_data["total_hits"].sum()
        avg = (h / ab) if ab > 0 else 0.0
        hr = player_data["homeruns"].sum()
        rbi = player_data["rbi"].sum()
        sb = player_data["stolen_bases"].sum()
        matches_count = player_data["source_file"].nunique()

        st.markdown(f"### **{selected_player}** 選手の確定通算成績 {num_display}")
        st.caption(f"集計対象: 全 {matches_count} 試合出場")
        
        col1, col2, col3, col4, col5 = st.columns(5)
        col1.metric("通算打率", f".{int(avg * 1000):03d}" if avg > 0 else ".000")
        col2.metric("通算安打", f"{int(h)} 本")
        col3.metric("本塁打", f"{int(hr)} 本")
        col4.metric("通算打点", f"{int(rbi)} 点")
        col5.metric("通算盗塁", f"{int(sb)} 個")

        st.markdown("#### 🔥 各試合のベストハイライト")
        hl_list = player_data[player_data["highlight"].str.strip() != ""]["highlight"].tolist()
        if hl_list:
            for hl in hl_list:
                st.write(f"・{hl}")
        else:
            st.write("・全力プレーでチームに大きく貢献！")
