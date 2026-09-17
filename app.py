import streamlit as st
import streamlit.components.v1 as components
import pandas as pd
from data_utils import RESULT_OPTIONS, create_excel_from_compiled, calculate_stats_from_grid

# ==========================================
# 早稲田式スコアブック用紙風 CSSスタイル（強制適用版）
# ==========================================
def apply_custom_css():
    st.markdown("""
    <style>
    /* 1. スマホ上部の巨大な空白ヘッダーを完全消去 */
    header[data-testid="stHeader"] {
        display: none !important;
        height: 0px !important;
    }
    .main .block-container {
        padding-top: 1rem !important;
        padding-bottom: 2rem !important;
        padding-left: 0.5rem !important;
        padding-right: 0.5rem !important;
    }

    /* 2. 画面全体の背景をスコア用紙調（クリーム色＋方眼）に上書き */
    .stApp {
        background-color: #f7f4ea !important;
        background-image: 
            linear-gradient(#e5dfd0 1px, transparent 1px),
            linear-gradient(90deg, #e5dfd0 1px, transparent 1px) !important;
        background-size: 16px 16px !important;
        color: #222222 !important;
    }

    /* 3. タブバー（深緑の球場フェンス・黒板風） */
    .stTabs [data-baseweb="tab-list"] {
        background-color: #1e3a2b !important;
        padding: 6px 8px !important;
        border-radius: 8px !important;
        gap: 6px !important;
        overflow-x: auto !important;
    }
    .stTabs [data-baseweb="tab"] {
        background-color: #2d523e !important;
        color: #d1e3d7 !important;
        border-radius: 6px !important;
        font-weight: bold !important;
        border: 1px solid #14281e !important;
        padding: 6px 12px !important;
    }
    .stTabs [aria-selected="true"] {
        background-color: #c93a3a !important; /* 選択中は赤色ワッペン */
        color: #ffffff !important;
        border: 1px solid #8c2020 !important;
    }

    /* 4. 入力フォーム・選手カード枠（スコアブック用紙ブロック） */
    div[data-testid="stForm"] {
        background-color: #ffffff !important;
        border: 2px solid #5a4a42 !important;
        border-radius: 8px !important;
        padding: 12px 10px !important;
        box-shadow: 2px 3px 6px rgba(0,0,0,0.12) !important;
    }

    /* 5. ラベルや文字の色を黒/濃茶に固定（ダークモード干渉防止） */
    label, p, span, div {
        color: #1a1a1a !important;
    }

    /* 6. イニングヘッダー（◇ ダイヤモンド） */
    .inning-pill {
        text-align: center;
        background-color: #1e3a2b;
        color: #ffffff !important;
        font-weight: bold;
        font-size: 0.75rem;
        padding: 3px 0;
        border-radius: 4px;
        margin-bottom: 2px;
        border: 1px solid #10241a;
    }
    .diamond-icon {
        color: #f1c40f !important;
        margin-right: 2px;
    }
    </style>
    """, unsafe_allow_html=True)


# ==========================================
# ① 役員用画面の描画（スコアブック風エディタ）
# ==========================================
def render_admin_view():
    st.markdown("## ⚾️ 早稲田式 スコア照合盤面")

    if not st.session_state.get("all_matches_data"):
        return

    match_files = list(st.session_state.all_matches_data.keys())
    
    top_c1, top_c2 = st.columns([2, 1])
    selected_match_file = top_c1.selectbox("📁 確認する試合を選択", match_files)
    is_mobile_sticky = top_c2.checkbox("📱 原本画像を上部に固定", value=False)

    current_players = st.session_state.all_matches_data.get(selected_match_file, [])
    current_b64 = st.session_state.match_images_b64.get(selected_match_file, "")

    if st.button("➕ 選手を手動追加"):
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

    # 原本画像ビューワー
    with st.expander("📷 原本スコアブック画像を確認する", expanded=True):
        zoom_val = st.slider("🔍 画像拡大率", min_value=100, max_value=300, value=130, step=20, format="%d%%")
        box_height = 280 if is_mobile_sticky else 450
        viewer_html = f"""
        <div style="width:100%; height:{box_height}px; overflow:auto; border:2px solid #5a4a42; border-radius:6px; background-color:#111; text-align:center;">
            <img src="data:image/jpeg;base64,{current_b64}" style="width:{zoom_val}%; max-width:none;" />
        </div>
        """
        components.html(viewer_html, height=box_height + 15)

    # 選手タブエディタ
    tab_labels = []
    for idx, player in enumerate(current_players):
        u_num = str(player.get("uniform_number", "")).strip()
        num_str = f"#{u_num} " if u_num else ""
        p_name = str(player.get("player_name", "選手")).strip()
        sub_tag = "(代)" if player.get("is_substitute") else ""
        tab_labels.append(f"{num_str}{p_name}{sub_tag}")

    player_tabs = st.tabs(tab_labels)

    for idx, (p_tab, player) in enumerate(zip(player_tabs, current_players)):
        with p_tab:
            is_sub = player.get("is_substitute", False)
            order_val = player.get("batting_order", idx + 1)
            u_num_init = str(player.get("uniform_number", "")).strip()
            p_name_init = str(player.get("player_name", "未登録")).strip()

            with st.form(key=f"form_player_{selected_match_file}_{idx}"):
                st.markdown(f"**【{order_val}番】 背番号: #{u_num_init or '-'} {p_name_init} {'（交代）' if is_sub else '（先発）'}**")
                
                p_cols = st.columns([1, 2, 3])
                u_num = p_cols[0].text_input("背番号", value=u_num_init, key=f"{selected_match_file}_num_{idx}")
                p_name = p_cols[1].text_input("選手名", value=p_name_init, key=f"{selected_match_file}_name_{idx}")
                hl = p_cols[2].text_input("ハイライト", value=str(player.get("highlight", "")), key=f"{selected_match_file}_hl_{idx}")

                stat_c1, stat_c2 = st.columns(2)
                rbi_val = stat_c1.number_input("打点 (RBI)", min_value=0, max_value=20, value=int(player.get("rbi", 0)), step=1, key=f"{selected_match_file}_rbi_{idx}")
                sb_val = stat_c2.number_input("盗塁 (SB)", min_value=0, max_value=20, value=int(player.get("stolen_bases", 0)), step=1, key=f"{selected_match_file}_sb_{idx}")

                st.markdown("<hr style='margin: 8px 0; border: none; border-top: 1px dashed #5a4a42;'>", unsafe_allow_html=True)
                st.markdown("<div style='font-size:0.8rem; font-weight:bold; color:#1a1a1a; margin-bottom:4px;'>【各回の打席結果（◇ダイヤモンド）】</div>", unsafe_allow_html=True)

                inn_cols = st.columns(7)
                new_innings = {}
                for i_idx, inn_str in enumerate(["1", "2", "3", "4", "5", "6", "7"]):
                    with inn_cols[i_idx]:
                        st.markdown(f"<div class='inning-pill'><span class='diamond-icon'>◇</span>{inn_str}回</div>", unsafe_allow_html=True)
                        cur_val = player.get("innings", {}).get(inn_str, "なし")
                        default_idx = RESULT_OPTIONS.index(cur_val) if cur_val in RESULT_OPTIONS else 0
                        sel = st.selectbox(
                            f"{inn_str}回",
                            RESULT_OPTIONS,
                            index=default_idx,
                            key=f"{selected_match_file}_inn_{idx}_{inn_str}",
                            label_visibility="collapsed"
                        )
                        new_innings[inn_str] = sel

                st.write("")
                submitted = st.form_submit_button("💾 スコアブックに保存", use_container_width=True)
                if submitted:
                    st.session_state.all_matches_data[selected_match_file][idx] = {
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
                    }
                    st.success(f"{p_name} 選手のスコアを保存しました！")
                    st.rerun()

    st.write("")
    if st.button("📊 全試合の成績を確定統合してExcelを作成", type="primary", use_container_width=True):
        all_compiled = []
        for m_file, p_list in st.session_state.all_matches_data.items():
            compiled_single = calculate_stats_from_grid(p_list, match_file_name=m_file)
            all_compiled.extend(compiled_single)

        st.session_state["compiled_records"] = all_compiled
        st.success(f"🎉 成績を確定統合しました！")

    if "compiled_records" in st.session_state:
        st.divider()
        excel_data = create_excel_from_compiled(st.session_state["compiled_records"])
        st.download_button(
            label="📥 選手別シート付きExcelをダウンロード",
            data=excel_data,
            file_name="チーム通算打撃成績一覧.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            use_container_width=True
        )


# ==========================================
# ② 選手名鑑＆アワード画面の描画
# ==========================================
def render_roster_view():
    compiled_data = st.session_state.get("compiled_records")
    if not compiled_data:
        st.info("👈 まず「役員用」タブでスコアを確定させてください。")
        return

    df = pd.DataFrame(compiled_data)
    players = [p for p in df["player_name"].dropna().unique().tolist() if p.strip() != ""]

    st.subheader("🎖️ チームタイトル・アワード")
    c1, c2, c3, c4 = st.columns(4)

    total_h = df["hits"] + df["doubles"] + df["triples"] + df["homeruns"]
    df["total_hits"] = total_h
    tb_leaders = df.groupby("player_name")["total_hits"].sum().sort_values(ascending=False)
    if not tb_leaders.empty and tb_leaders.iloc[0] > 0:
        c1.metric("最多安打", f"{tb_leaders.index[0]} 選手", f"{int(tb_leaders.iloc[0])} 本")

    hr_leaders = df.groupby("player_name")["homeruns"].sum().sort_values(ascending=False)
    if not hr_leaders.empty and hr_leaders.iloc[0] > 0:
        c2.metric("本塁打王", f"{hr_leaders.index[0]} 選手", f"{int(hr_leaders.iloc[0])} 本")

    rbi_leaders = df.groupby("player_name")["rbi"].sum().sort_values(ascending=False)
    if not rbi_leaders.empty and rbi_leaders.iloc[0] > 0:
        c3.metric("打点王", f"{rbi_leaders.index[0]} 選手", f"{int(rbi_leaders.iloc[0])} 打点")

    sb_leaders = df.groupby("player_name")["stolen_bases"].sum().sort_values(ascending=False)
    if not sb_leaders.empty and sb_leaders.iloc[0] > 0:
        c4.metric("盗塁王", f"{sb_leaders.index[0]} 選手", f"{int(sb_leaders.iloc[0])} 個")

    st.divider()
    st.subheader("⚾️ デジタル選手名鑑")
    selected_player = st.selectbox("選手を選択", players)
    player_data = df[df["player_name"] == selected_player]

    used_numbers = [str(n).strip() for n in player_data["uniform_number"].dropna().unique() if str(n).strip() != ""]
    num_display = f"（#{', #'.join(used_numbers)}）" if used_numbers else ""

    ab = player_data["at_bats"].sum()
    h = player_data["total_hits"].sum()
    avg = (h / ab) if ab > 0 else 0.0
    hr = player_data["homeruns"].sum()
    rbi = player_data["rbi"].sum()
    sb = player_data["stolen_bases"].sum()

    st.markdown(f"### **{selected_player}** 選手 {num_display}")
    
    col1, col2, col3, col4, col5 = st.columns(5)
    col1.metric("打率", f".{int(avg * 1000):03d}" if avg > 0 else ".000")
    col2.metric("安打", f"{int(h)} 本")
    col3.metric("本塁打", f"{int(hr)} 本")
    col4.metric("打点", f"{int(rbi)} 点")
    col5.metric("盗塁", f"{int(sb)} 個")

    st.markdown("#### 🔥 ハイライト")
    hl_list = player_data[player_data["highlight"].str.strip() != ""]["highlight"].tolist()
    if hl_list:
        for hl in hl_list:
            st.write(f"・{hl}")
