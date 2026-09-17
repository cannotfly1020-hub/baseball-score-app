import streamlit as st
import streamlit.components.v1 as components
import pandas as pd
from data_utils import RESULT_OPTIONS, create_excel_from_compiled, calculate_stats_from_grid

# ==========================================
# 早稲田式スコアブック用紙風 CSSスタイル（余白ゼロ＆完全スマホ最適化）
# ==========================================
def apply_custom_css():
    st.markdown("""
    <style>
    /* 1. スマホ上部の巨大な無駄余白を極限までカット */
    header[data-testid="stHeader"] {
        display: none !important;
    }
    .main .block-container {
        padding-top: 0.5rem !important;
        padding-bottom: 2rem !important;
        padding-left: 0.5rem !important;
        padding-right: 0.5rem !important;
    }

    /* 2. タブバーを野球ユニフォーム風に */
    .stTabs [data-baseweb="tab-list"] {
        gap: 4px;
        overflow-x: auto !important;
        white-space: nowrap !important;
        padding-bottom: 4px;
        -webkit-overflow-scrolling: touch;
        border-bottom: 2px solid #2e4a3d !important;
    }
    .stTabs [data-baseweb="tab"] {
        padding: 5px 10px !important;
        border-radius: 6px 6px 0 0 !important;
        background-color: #2e4a3d !important;
        color: #ffffff !important;
        font-weight: bold !important;
        font-size: 0.85rem !important;
    }

    /* 3. スコアブック用紙カード（強制クリーム色＋方眼罫線） */
    .scorebook-card {
        background-color: #fdfaf2 !important;
        background-image: 
            linear-gradient(#e6e0d3 1px, transparent 1px),
            linear-gradient(90deg, #e6e0d3 1px, transparent 1px) !important;
        background-size: 14px 14px !important;
        border: 2px solid #5a4a42 !important;
        border-radius: 8px !important;
        padding: 10px 8px !important;
        margin: 10px 0 !important;
        color: #1a1a1a !important;
    }

    /* 選手欄ヘッダー */
    .scorebook-header {
        display: flex;
        align-items: center;
        gap: 8px;
        background-color: #ede7d8;
        border-bottom: 2px solid #5a4a42;
        padding: 4px 8px;
        border-radius: 4px;
        margin-bottom: 8px;
    }
    .uniform-badge {
        background-color: #c93a3a;
        color: #ffffff !important;
        font-weight: 900;
        font-size: 0.95rem;
        padding: 2px 6px;
        border-radius: 4px;
    }
    .player-title {
        font-size: 0.95rem;
        font-weight: bold;
        color: #1a1a1a !important;
    }

    /* イニング列ヘッダー（◇ ダイヤモンド） */
    .inning-header {
        text-align: center;
        background-color: #2e4a3d;
        color: #ffffff !important;
        font-weight: bold;
        font-size: 0.75rem;
        padding: 2px 0;
        border-radius: 3px;
        margin-bottom: 2px;
    }
    .diamond-icon {
        color: #f5c542;
        margin-right: 2px;
    }
    </style>
    """, unsafe_allow_html=True)


# ==========================================
# ① 役員用画面の描画（スコアブック風エディタ）
# ==========================================
def render_admin_view():
    st.markdown("### ⚾️ 早稲田式 スコア照合盤面")

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

            # スコアブック用紙カード
            st.markdown(f"""
            <div class="scorebook-card">
                <div class="scorebook-header">
                    <span class="uniform-badge">#{u_num_init or '-'}</span>
                    <span class="player-title">{order_val}番: {p_name_init} {'（交代・代打）' if is_sub else '（先発）'}</span>
                </div>
            """, unsafe_allow_html=True)

            with st.form(key=f"form_player_{selected_match_file}_{idx}"):
                p_cols = st.columns([1, 2, 3])
                u_num = p_cols[0].text_input("背番号", value=u_num_init, key=f"{selected_match_file}_num_{idx}")
                p_name = p_cols[1].text_input("選手名", value=p_name_init, key=f"{selected_match_file}_name_{idx}")
                hl = p_cols[2].text_input("ハイライト", value=str(player.get("highlight", "")), key=f"{selected_match_file}_hl_{idx}")

                stat_c1, stat_c2 = st.columns(2)
                rbi_val = stat_c1.number_input("打点 (RBI)", min_value=0, max_value=20, value=int(player.get("rbi", 0)), step=1, key=f"{selected_match_file}_rbi_{idx}")
                sb_val = stat_c2.number_input("盗塁 (SB)", min_value=0, max_value=20, value=int(player.get("stolen_bases", 0)), step=1, key=f"{selected_match_file}_sb_{idx}")

                st.markdown("<div style='font-size:0.8rem; font-weight:bold; color:#5a4a42; margin: 4px 0;'>【各回の打席結果（◇ダイヤモンド）】</div>", unsafe_allow_html=True)

                inn_cols = st.columns(7)
                new_innings = {}
                for i_idx, inn_str in enumerate(["1", "2", "3", "4", "5", "6", "7"]):
                    with inn_cols[i_idx]:
                        st.markdown(f"<div class='inning-header'><span class='diamond-icon'>◇</span>{inn_str}回</div>", unsafe_allow_html=True)
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
                submitted = st.form_submit_button("💾 スコアに保存", use_container_width=True)
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

            st.markdown("</div>", unsafe_allow_html=True)

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
