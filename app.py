"""学童野球スコア集計アプリ v2.0 — Streamlit UI."""

from __future__ import annotations

import base64
import io
import json
import uuid
from datetime import datetime
from pathlib import Path

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components
from google import genai
from google.genai import types
from PIL import Image

from constants import (
    DEFAULT_GEMINI_MODELS,
    INNING_KEYS,
    RESULT_OPTIONS,
    empty_innings,
    normalize_result,
)
from data_utils import (
    aggregate_player_career,
    calculate_stats_from_grid,
    count_needs_review,
    create_excel_from_compiled,
    enhance_sharpness,
    normalize_player_record,
    rotate_image_bytes,
)
from prompts import DETAILS_PROMPT, build_roster_prompt, format_roster_lines

APP_DIR = Path(__file__).resolve().parent
ROSTER_PATH = APP_DIR / "team_roster.json"

st.set_page_config(
    page_title="学童野球スコア集計 v2",
    page_icon="⚾️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ----------------------------------------------------
# スタイル
# ----------------------------------------------------
st.markdown(
    """
<style>
.stApp { background: linear-gradient(165deg, #0c1a14 0%, #143226 45%, #0f1f17 100%) !important; color: #f0f4f1 !important; }
section[data-testid="stSidebar"] { background-color: #0a1710 !important; border-right: 2px solid #1f422e !important; }
.block-container { padding-top: 3.2rem !important; padding-bottom: 2rem !important; }
.stTabs [data-baseweb="tab-list"] {
  gap: 8px; overflow-x: auto !important; padding: 8px 4px 10px 4px !important;
  border-bottom: 2.5px solid #d4af37 !important; margin-bottom: 1rem !important;
}
.stTabs [data-baseweb="tab"] {
  height: auto !important; min-height: 40px !important; padding: 8px 14px !important;
  border-radius: 8px 8px 0 0 !important; background-color: #1b382b !important;
  color: #c2d6cb !important; font-weight: 600 !important; border: 1px solid #2d5a45 !important;
}
.stTabs [aria-selected="true"] {
  background-color: #991b1b !important; color: #ffffff !important;
  border-top: 2.5px solid #d4af37 !important; border-left: 2px solid #d4af37 !important;
  border-right: 2px solid #d4af37 !important; font-weight: bold !important;
}
h1, h2, h3, h4 { color: #ffffff !important; }
[data-testid="stFileUploader"] {
  background-color: #172d22 !important; border: 1px dashed #d4af37 !important;
  border-radius: 10px !important; padding: 10px !important;
}
div[data-testid="stForm"] {
  background-color: #ffffff !important; border: 1px solid #dcd6cd !important;
  border-left: 6px solid #991b1b !important; border-radius: 8px !important;
  padding: 14px 12px !important; box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
}
div[data-testid="stForm"] label, div[data-testid="stForm"] h5 { color: #111111 !important; font-weight: bold !important; }
div[data-baseweb="select"] input { pointer-events: none !important; caret-color: transparent !important; }
div[data-testid="stForm"] button {
  background-color: #991b1b !important; color: #ffffff !important;
  border: 2px solid #d4af37 !important; border-radius: 8px !important; font-weight: bold !important;
}
.inning-header {
  text-align: center; background-color: #1b382b; color: #ffffff !important;
  font-weight: bold; font-size: 0.8rem; padding: 4px 0; border-radius: 4px; margin-bottom: 4px;
  border-bottom: 2px solid #d4af37;
}
.inning-header.warn { background-color: #7a5c00 !important; border-bottom-color: #ffd700 !important; }
.diamond-icon { color: #ffd700 !important; margin-right: 3px; }
.sticky-mobile-viewer {
  position: -webkit-sticky; position: sticky; top: 3.5rem; z-index: 99;
  background-color: rgba(15, 31, 23, 0.95); padding: 8px; border-radius: 10px;
  box-shadow: 0 4px 15px rgba(0,0,0,0.6); border: 1px solid #d4af37; margin-bottom: 12px;
}
.review-banner {
  background: linear-gradient(90deg, #5c4a00, #8a7000); color: #fff8d6;
  border: 1px solid #ffd700; border-radius: 8px; padding: 10px 14px; margin: 8px 0 14px 0;
  font-weight: 600;
}
.award-card {
  background: #172d22; border: 1px solid #d4af37; border-radius: 12px;
  padding: 14px 12px; text-align: center; min-height: 110px;
}
.award-card .title { color: #d4af37; font-size: 0.85rem; margin-bottom: 6px; }
.award-card .name { color: #fff; font-size: 1.15rem; font-weight: 700; }
.award-card .stat { color: #c2d6cb; margin-top: 4px; }
.player-warn-tag {
  display: inline-block; background: #f5d76e; color: #3a2f00; font-weight: 700;
  font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; margin-left: 6px;
}
</style>
""",
    unsafe_allow_html=True,
)

# ----------------------------------------------------
# 名簿 I/O
# ----------------------------------------------------
DEFAULT_ROSTER = [
    {"uniform_number": "10,5", "player_name": "清山 煌晟", "note": ""},
    {"uniform_number": "0,7", "player_name": "金子 真怜", "note": ""},
    {"uniform_number": "2,15", "player_name": "青木 陸斗", "note": ""},
    {"uniform_number": "3,90", "player_name": "清川 安武", "note": ""},
    {"uniform_number": "4,1", "player_name": "橋本 淳治朗", "note": ""},
    {"uniform_number": "5,91", "player_name": "西田 圭佑", "note": ""},
    {"uniform_number": "6,6", "player_name": "與永 律希", "note": ""},
    {"uniform_number": "7,8", "player_name": "森山 惇都", "note": ""},
    {"uniform_number": "8,0", "player_name": "鬼崎 蒼大", "note": ""},
    {"uniform_number": "9,13", "player_name": "金本 輝希", "note": ""},
    {"uniform_number": "11,17", "player_name": "西田 直央", "note": ""},
    {"uniform_number": "12,27", "player_name": "津守 堅心", "note": ""},
    {"uniform_number": "13,14", "player_name": "石井 結賀", "note": ""},
    {"uniform_number": "15,21", "player_name": "豊島 颯太", "note": ""},
    {"uniform_number": "18,4", "player_name": "逢坂 凌功", "note": ""},
    {"uniform_number": "3", "player_name": "上村 吉", "note": ""},
    {"uniform_number": "99", "player_name": "清川 雅規", "note": ""},
    {"uniform_number": "19", "player_name": "西田 康晃", "note": ""},
    {"uniform_number": "75", "player_name": "松本 連", "note": ""},
    {"uniform_number": "51", "player_name": "田浦 柊亮", "note": ""},
    {"uniform_number": "77", "player_name": "植村 颯斗", "note": ""},
    {"uniform_number": "24", "player_name": "大瀬良 拓哉", "note": ""},
    {"uniform_number": "9", "player_name": "田中 朔人", "note": ""},
    {"uniform_number": "25", "player_name": "佐甲 大知", "note": ""},
    {"uniform_number": "10", "player_name": "鬼崎 蓮大", "note": ""},
    {"uniform_number": "11", "player_name": "豊田 将基", "note": ""},
    {"uniform_number": "2", "player_name": "橋本 吉之助", "note": ""},
    {"uniform_number": "55", "player_name": "岡田 鷹良", "note": ""},
    {"uniform_number": "18", "player_name": "田中 遥希", "note": ""},
]


def load_roster_from_disk() -> list[dict]:
    if not ROSTER_PATH.exists():
        ROSTER_PATH.write_text(
            json.dumps(DEFAULT_ROSTER, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return [dict(r) for r in DEFAULT_ROSTER]
    try:
        data = json.loads(ROSTER_PATH.read_text(encoding="utf-8"))
        if isinstance(data, list):
            cleaned = []
            for row in data:
                if not isinstance(row, dict):
                    continue
                cleaned.append(
                    {
                        "uniform_number": str(row.get("uniform_number", "") or ""),
                        "player_name": str(row.get("player_name", "") or ""),
                        "note": str(row.get("note", "") or ""),
                    }
                )
            return cleaned
    except Exception:
        pass
    return [dict(r) for r in DEFAULT_ROSTER]


def save_roster_to_disk(roster: list[dict]) -> None:
    cleaned = []
    for row in roster:
        name = str(row.get("player_name", "") or "").strip()
        if not name:
            continue
        cleaned.append(
            {
                "uniform_number": str(row.get("uniform_number", "") or "").strip(),
                "player_name": name,
                "note": str(row.get("note", "") or "").strip(),
            }
        )
    ROSTER_PATH.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2), encoding="utf-8")


# ----------------------------------------------------
# セッション初期化
# ----------------------------------------------------
if "all_matches_data" not in st.session_state:
    st.session_state.all_matches_data = {}
if "match_images_b64" not in st.session_state:
    st.session_state.match_images_b64 = {}
if "match_meta" not in st.session_state:
    st.session_state.match_meta = {}
if "match_rotation" not in st.session_state:
    st.session_state.match_rotation = {}
if "team_roster" not in st.session_state:
    st.session_state.team_roster = load_roster_from_disk()
if "compiled_records" not in st.session_state:
    st.session_state.compiled_records = None


def unique_match_key(filename: str) -> str:
    existing = st.session_state.all_matches_data
    if filename not in existing:
        return filename
    stamp = datetime.now().strftime("%H%M%S")
    base = f"{filename}__{stamp}"
    if base not in existing:
        return base
    return f"{filename}__{uuid.uuid4().hex[:6]}"


def normalize_match_players(players: list) -> list[dict]:
    return [normalize_player_record(p) for p in (players or [])]


def recompile_all_matches() -> list:
    all_compiled = []
    for m_file, p_list in st.session_state.all_matches_data.items():
        all_compiled.extend(calculate_stats_from_grid(p_list, match_file_name=m_file))
    st.session_state.compiled_records = all_compiled
    return all_compiled


def match_review_count(players: list) -> int:
    return sum(count_needs_review(p) for p in players or [])


# ----------------------------------------------------
# サイドバー
# ----------------------------------------------------
with st.sidebar:
    st.markdown("### ⚙️ 設定")
    api_key = None
    try:
        api_key = st.secrets.get("GEMINI_API_KEY")
    except Exception:
        api_key = None
    if not api_key:
        api_key = st.text_input("Gemini APIキー", type="password", help="Secrets 未設定時はここに入力")

    model_name = st.selectbox(
        "Gemini モデル",
        options=DEFAULT_GEMINI_MODELS,
        index=0,
        help="利用可能な Flash 系モデルを選択",
    )
    st.caption(f"名簿ファイル: `{ROSTER_PATH.name}`（{len(st.session_state.team_roster)} 名）")
    st.divider()
    st.caption("学童野球スコア集計 v2.0")

client = genai.Client(api_key=api_key) if api_key else None

st.title("⚾️ 学童野球スコア集計 v2.0")
st.caption("手書きスコアブック（早稲田式）を AI 読取 → 人が確認 → 通算成績・Excel へ")

tab_scan, tab_awards, tab_roster = st.tabs(
    ["📝 スコア読取＆修正", "🏆 選手名鑑＆アワード", "👥 チーム名簿管理"]
)

# ==========================================
# タブ1: スコア読取＆修正
# ==========================================
with tab_scan:
    st.subheader("スコア照合・打席盤面エディタ")
    st.caption("新規解析は既存試合へ**追加マージ**されます。要確認マスは黄色で強調します。")

    with st.expander("📂 作業バックアップ（JSON）の読込／保存", expanded=False):
        backup_file = st.file_uploader("バックアップ JSON", type=["json"], key="backup_uploader_v2")
        if backup_file is not None and st.button("このバックアップから復元", use_container_width=True):
            try:
                loaded = json.loads(backup_file.getvalue().decode("utf-8"))
                if "all_matches_data" in loaded:
                    st.session_state.all_matches_data = loaded["all_matches_data"]
                    st.session_state.match_images_b64 = loaded.get("match_images_b64", {})
                    st.session_state.match_meta = loaded.get("match_meta", {})
                    st.session_state.match_rotation = loaded.get("match_rotation", {})
                    st.session_state.compiled_records = None
                    st.success(f"{len(st.session_state.all_matches_data)} 試合を復元しました")
                    st.rerun()
                else:
                    st.error("形式が正しくありません（all_matches_data が必要）")
            except Exception as exc:
                st.error(f"復元エラー: {exc}")

        if st.session_state.all_matches_data:
            payload = {
                "all_matches_data": st.session_state.all_matches_data,
                "match_images_b64": st.session_state.match_images_b64,
                "match_meta": st.session_state.match_meta,
                "match_rotation": st.session_state.match_rotation,
                "saved_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "app_version": "2.0",
            }
            st.download_button(
                "💾 現在の作業を JSON ダウンロード",
                data=json.dumps(payload, ensure_ascii=False, indent=2),
                file_name=f"スコア作業バックアップ_{datetime.now().strftime('%Y%m%d_%H%M')}.json",
                mime="application/json",
                use_container_width=True,
            )

    st.divider()

    if not client:
        st.warning("サイドバーで Gemini APIキーを設定してください。")
    else:
        uploaded_files = st.file_uploader(
            "スコアブック写真（複数可）",
            type=["jpg", "jpeg", "png"],
            accept_multiple_files=True,
            key="score_uploader_v2",
        )
        if uploaded_files and st.button(
            f"AIで {len(uploaded_files)} 試合を解析してリストに追加",
            type="primary",
            use_container_width=True,
        ):
            progress = st.progress(0)
            status = st.empty()
            roster_prompt = build_roster_prompt(st.session_state.team_roster)
            added = 0

            for idx, f in enumerate(uploaded_files):
                f_name = f.name
                status.text(f"【{idx + 1}/{len(uploaded_files)}】{f_name} — 名簿抽出中…")
                raw_bytes = f.read()
                highres = enhance_sharpness(Image.open(io.BytesIO(raw_bytes)))

                try:
                    res_roster = client.models.generate_content(
                        model=model_name,
                        contents=[
                            types.Part.from_bytes(data=highres, mime_type="image/jpeg"),
                            "スコアブック左側の打順・背番号・選手名（先発・交代・代打二段書き含む）を漏れなく抽出してください。",
                        ],
                        config=types.GenerateContentConfig(
                            system_instruction=roster_prompt,
                            response_mime_type="application/json",
                            temperature=0.1,
                        ),
                    )
                    roster_data = res_roster.text or "[]"

                    status.text(f"【{idx + 1}/{len(uploaded_files)}】{f_name} — 打席判定中…")
                    res_details = client.models.generate_content(
                        model=model_name,
                        contents=[
                            types.Part.from_bytes(data=highres, mime_type="image/jpeg"),
                            f"確定選手名簿:\n{roster_data}\n\n上記選手枠に基づき、スコアブックの1回〜7回の全打席詳細、打点、盗塁を判定してください。",
                        ],
                        config=types.GenerateContentConfig(
                            system_instruction=DETAILS_PROMPT,
                            response_mime_type="application/json",
                            temperature=0.1,
                        ),
                    )
                    parsed = json.loads(res_details.text or "[]")
                    if not isinstance(parsed, list):
                        raise ValueError("AI応答が配列ではありません")
                    players = normalize_match_players(parsed)
                    key = unique_match_key(f_name)
                    st.session_state.all_matches_data[key] = players
                    st.session_state.match_images_b64[key] = base64.b64encode(raw_bytes).decode()
                    st.session_state.match_rotation[key] = 0
                    # 試合メタは先頭選手から推定
                    head = players[0] if players else {}
                    st.session_state.match_meta[key] = {
                        "match_date": head.get("match_date", "-"),
                        "opponent": head.get("opponent", "-"),
                        "source_name": f_name,
                    }
                    added += 1
                except Exception as exc:
                    st.error(f"{f_name} の解析エラー: {exc}")

                progress.progress((idx + 1) / len(uploaded_files))

            status.empty()
            st.session_state.compiled_records = None
            if added:
                st.success(f"{added} 試合をリストに追加しました（既存試合は保持）")
                st.rerun()

    # ---- 編集 UI ----
    if not st.session_state.all_matches_data:
        st.info("まだ試合データがありません。写真を解析するか、バックアップを復元してください。")
    else:
        st.divider()
        match_files = list(st.session_state.all_matches_data.keys())
        total_review = sum(match_review_count(st.session_state.all_matches_data[m]) for m in match_files)
        if total_review:
            st.markdown(
                f'<div class="review-banner">⚠️ 全試合合計 {total_review} マスが「要確認」です。黄色のマスを優先して修正してください。</div>',
                unsafe_allow_html=True,
            )

        top1, top2, top3 = st.columns([2.2, 1, 1])
        labels = []
        for m in match_files:
            rc = match_review_count(st.session_state.all_matches_data[m])
            meta = st.session_state.match_meta.get(m, {})
            opp = meta.get("opponent") or "-"
            tag = f" ⚠{rc}" if rc else ""
            labels.append(f"{m}（vs {opp}）{tag}")
        selected_label = top1.selectbox("確認・編集する試合", labels)
        selected_match = match_files[labels.index(selected_label)]
        is_mobile_sticky = top2.checkbox("スマホ固定プレビュー", value=False)
        if top3.button("🗑️ この試合を削除", use_container_width=True):
            st.session_state.all_matches_data.pop(selected_match, None)
            st.session_state.match_images_b64.pop(selected_match, None)
            st.session_state.match_meta.pop(selected_match, None)
            st.session_state.match_rotation.pop(selected_match, None)
            st.session_state.compiled_records = None
            st.warning(f"試合「{selected_match}」を削除しました")
            st.rerun()

        current_players = st.session_state.all_matches_data.get(selected_match, [])
        current_b64 = st.session_state.match_images_b64.get(selected_match, "")
        rotation = int(st.session_state.match_rotation.get(selected_match, 0))
        meta = st.session_state.match_meta.setdefault(
            selected_match,
            {"match_date": "-", "opponent": "-", "source_name": selected_match},
        )

        mcol1, mcol2, mcol3 = st.columns([1, 1, 1])
        meta["match_date"] = mcol1.text_input("試合日", value=str(meta.get("match_date", "-")))
        meta["opponent"] = mcol2.text_input("対戦相手", value=str(meta.get("opponent", "-")))
        if mcol3.button("試合情報を全選手に反映", use_container_width=True):
            for p in current_players:
                p["match_date"] = meta["match_date"]
                p["opponent"] = meta["opponent"]
            st.session_state.all_matches_data[selected_match] = current_players
            st.success("試合日・対戦相手を反映しました")
            st.rerun()

        if st.button("➕ この試合に選手を手動追加"):
            current_players.append(
                {
                    "match_date": meta.get("match_date", "-"),
                    "opponent": meta.get("opponent", "-"),
                    "batting_order": len(current_players) + 1,
                    "uniform_number": "",
                    "player_name": f"追加選手{len(current_players) + 1}",
                    "is_substitute": True,
                    "rbi": 0,
                    "stolen_bases": 0,
                    "innings": empty_innings(),
                    "highlight": "",
                }
            )
            st.session_state.all_matches_data[selected_match] = current_players
            st.rerun()

        col_img, col_grid = st.columns([1.1, 1.3])

        with col_img:
            st.markdown(f"#### 📷 原本: `{selected_match}`")
            zcol, rcol = st.columns(2)
            zoom_val = zcol.slider("拡大率", 100, 350, 150, 25, format="%d%%")
            new_rot = rcol.select_slider("回転", options=[0, 90, 180, 270], value=rotation)
            if new_rot != rotation:
                st.session_state.match_rotation[selected_match] = new_rot
                rotation = new_rot

            display_b64 = current_b64
            if current_b64 and rotation:
                try:
                    rotated = rotate_image_bytes(base64.b64decode(current_b64), rotation)
                    display_b64 = base64.b64encode(rotated).decode()
                except Exception:
                    display_b64 = current_b64

            box_height = 320 if is_mobile_sticky else 620
            sticky_class = "sticky-mobile-viewer" if is_mobile_sticky else ""
            viewer_html = f"""
            <div class="{sticky_class}" style="width:100%; height:{box_height}px; overflow:auto;
                 border:2px solid #555; border-radius:8px; background-color:#222; text-align:center;">
              <img src="data:image/jpeg;base64,{display_b64}"
                   style="width:{zoom_val}%; max-width:none; transition:width 0.15s ease-in-out; cursor:grab;" />
            </div>
            """
            components.html(viewer_html, height=box_height + 20)

        with col_grid:
            st.markdown("#### 🎯 打席盤面エディタ")
            match_rc = match_review_count(current_players)
            if match_rc:
                st.markdown(
                    f'<div class="review-banner">この試合の要確認: {match_rc} マス</div>',
                    unsafe_allow_html=True,
                )

            tab_labels = []
            for player in current_players:
                u_num = str(player.get("uniform_number", "")).strip()
                num_str = f"#{u_num} " if u_num else ""
                p_name = str(player.get("player_name", "選手")).strip()
                sub_tag = "(代)" if player.get("is_substitute") else ""
                rc = count_needs_review(player)
                warn = f"⚠{rc}" if rc else ""
                tab_labels.append(f"{num_str}{p_name}{sub_tag}{warn}")

            if not tab_labels:
                st.info("選手がいません。手動追加するか再解析してください。")
            else:
                player_tabs = st.tabs(tab_labels)
                for idx, (p_tab, player) in enumerate(zip(player_tabs, current_players)):
                    with p_tab:
                        is_sub = bool(player.get("is_substitute", False))
                        order_val = int(player.get("batting_order", idx + 1) or idx + 1)
                        u_init = str(player.get("uniform_number", "")).strip()
                        n_init = str(player.get("player_name", "")).strip()
                        rc = count_needs_review(player)
                        if rc:
                            st.markdown(
                                f'<span class="player-warn-tag">要確認 {rc} マス</span>',
                                unsafe_allow_html=True,
                            )

                        with st.form(key=f"form_{selected_match}_{idx}"):
                            st.markdown(
                                f"##### 【{order_val}番】 #{u_init or '-'} {n_init} "
                                f"{'（交代・代打）' if is_sub else '（先発）'}"
                            )
                            c1, c2, c3 = st.columns([1, 2, 3])
                            u_num = c1.text_input("背番号", value=u_init)
                            p_name = c2.text_input("選手名", value=n_init)
                            hl = c3.text_input("ハイライト", value=str(player.get("highlight", "")))
                            s1, s2, s3 = st.columns(3)
                            is_sub_edit = s1.checkbox("交代・代打", value=is_sub)
                            rbi_val = s2.number_input(
                                "打点",
                                min_value=0,
                                max_value=30,
                                value=int(player.get("rbi", 0) or 0),
                                step=1,
                            )
                            sb_val = s3.number_input(
                                "盗塁",
                                min_value=0,
                                max_value=30,
                                value=int(player.get("stolen_bases", 0) or 0),
                                step=1,
                            )

                            st.markdown("**各回の打席（◇）**")
                            inn_cols = st.columns(7)
                            new_innings = {}
                            for i_idx, inn_str in enumerate(INNING_KEYS):
                                with inn_cols[i_idx]:
                                    cur_val = normalize_result(
                                        (player.get("innings") or {}).get(inn_str, "なし")
                                    )
                                    warn_cls = " warn" if cur_val == "要確認" else ""
                                    st.markdown(
                                        f"<div class='inning-header{warn_cls}'>"
                                        f"<span class='diamond-icon'>◇</span>{inn_str}回</div>",
                                        unsafe_allow_html=True,
                                    )
                                    default_idx = (
                                        RESULT_OPTIONS.index(cur_val)
                                        if cur_val in RESULT_OPTIONS
                                        else RESULT_OPTIONS.index("要確認")
                                    )
                                    sel = st.selectbox(
                                        f"{inn_str}回",
                                        RESULT_OPTIONS,
                                        index=default_idx,
                                        key=f"inn_{selected_match}_{idx}_{inn_str}",
                                        label_visibility="collapsed",
                                    )
                                    new_innings[inn_str] = normalize_result(sel)

                            submitted = st.form_submit_button(
                                "💾 この選手を保存", use_container_width=True
                            )
                            if submitted:
                                st.session_state.all_matches_data[selected_match][idx] = {
                                    "match_date": meta.get("match_date", "-"),
                                    "opponent": meta.get("opponent", "-"),
                                    "batting_order": order_val,
                                    "uniform_number": u_num,
                                    "player_name": p_name,
                                    "is_substitute": is_sub_edit,
                                    "rbi": int(rbi_val),
                                    "stolen_bases": int(sb_val),
                                    "innings": new_innings,
                                    "highlight": hl,
                                }
                                st.session_state.compiled_records = None
                                st.success(f"{p_name} を保存しました")
                                st.rerun()

                        if st.button(
                            f"🗑️ 選手枠を削除（{n_init or '追加選手'}）",
                            key=f"del_{selected_match}_{idx}",
                        ):
                            st.session_state.all_matches_data[selected_match].pop(idx)
                            st.session_state.compiled_records = None
                            st.rerun()

        st.write("")
        if st.button("📊 全試合を再集計して確定", type="primary", use_container_width=True):
            compiled = recompile_all_matches()
            st.success(f"{len(st.session_state.all_matches_data)} 試合 / {len(compiled)} 行を確定しました")

# ==========================================
# タブ2: 選手名鑑＆アワード
# ==========================================
with tab_awards:
    if st.session_state.compiled_records is None and st.session_state.all_matches_data:
        st.info("まだ確定集計がありません。「スコア読取＆修正」で『全試合を再集計して確定』を押してください。")
        if st.button("いまある試合データから集計する", type="primary"):
            recompile_all_matches()
            st.rerun()
    elif not st.session_state.compiled_records:
        st.info("先にスコアを解析・確定してください。")
    else:
        compiled = st.session_state.compiled_records
        career = aggregate_player_career(compiled)

        st.subheader("🎖️ チームタイトル")
        if career.empty:
            st.warning("集計できる選手がいません。")
        else:
            def _pick(df, col, min_ab=0):
                sub = df[df["_ab"] >= min_ab] if min_ab else df
                sub = sub[sub[col] > (0 if col != "_avg_raw" else -1)]
                if sub.empty:
                    return None
                if col == "_avg_raw":
                    row = sub.sort_values(col, ascending=False).iloc[0]
                    return row["選手名"], row["打率"], int(row["_ab"])
                row = sub.sort_values(col, ascending=False).iloc[0]
                return row["選手名"], int(row[col]), None

            awards = [
                ("首位打者", _pick(career, "_avg_raw", min_ab=5), "打率"),
                ("最多安打", _pick(career, "_hits"), "本"),
                ("本塁打王", _pick(career, "_hr"), "本"),
                ("打点王", _pick(career, "_rbi"), "打点"),
                ("盗塁王", _pick(career, "_sb"), "個"),
            ]
            cols = st.columns(5)
            for col, (title, picked, unit) in zip(cols, awards):
                with col:
                    if not picked:
                        st.markdown(
                            f'<div class="award-card"><div class="title">{title}</div>'
                            f'<div class="name">—</div><div class="stat">該当なし</div></div>',
                            unsafe_allow_html=True,
                        )
                    else:
                        name, val, extra = picked
                        if title == "首位打者":
                            stat = f"{val}（{extra}打数）"
                        else:
                            stat = f"{val} {unit}"
                        st.markdown(
                            f'<div class="award-card"><div class="title">{title}</div>'
                            f'<div class="name">{name}</div><div class="stat">{stat}</div></div>',
                            unsafe_allow_html=True,
                        )

        st.divider()
        st.subheader("⚾️ デジタル選手名鑑（通算）")
        show_cols = [
            c
            for c in [
                "選手名",
                "背番号",
                "試合数",
                "打席",
                "打数",
                "単打",
                "二塁打",
                "三塁打",
                "本塁打",
                "総安打",
                "打点",
                "盗塁",
                "四死球",
                "三振",
                "打率",
                "出塁率",
            ]
            if c in career.columns
        ]
        st.dataframe(career[show_cols], use_container_width=True, hide_index=True)

        players = career["選手名"].tolist() if not career.empty else []
        if players:
            selected_player = st.selectbox("選手詳細", players)
            prow = career[career["選手名"] == selected_player].iloc[0]
            c1, c2, c3, c4, c5, c6 = st.columns(6)
            c1.metric("打率", prow["打率"])
            c2.metric("出塁率", prow["出塁率"])
            c3.metric("総安打", int(prow["総安打"]))
            c4.metric("本塁打", int(prow["本塁打"]))
            c5.metric("打点", int(prow["打点"]))
            c6.metric("盗塁", int(prow["盗塁"]))

            df_all = pd.DataFrame(compiled)
            hl_list = (
                df_all[
                    (df_all["player_name"] == selected_player)
                    & (df_all["highlight"].astype(str).str.strip() != "")
                ]["highlight"]
                .tolist()
            )
            st.markdown("#### ハイライト")
            if hl_list:
                for h in hl_list:
                    st.write(f"・{h}")
            else:
                st.write("・全力プレーでチームに貢献！")

        st.divider()
        excel_bytes = create_excel_from_compiled(compiled)
        st.download_button(
            f"📥 Excelダウンロード（{len(st.session_state.all_matches_data)} 試合）",
            data=excel_bytes,
            file_name="チーム通算打撃成績_v2.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            use_container_width=True,
        )

# ==========================================
# タブ3: チーム名簿管理
# ==========================================
with tab_roster:
    st.subheader("👥 チーム名簿の編集")
    st.caption("背番号・選手名・備考を編集し、保存すると AI 読取時の照合名簿に反映されます。")

    editor_df = pd.DataFrame(st.session_state.team_roster)
    if editor_df.empty:
        editor_df = pd.DataFrame(columns=["uniform_number", "player_name", "note"])

    edited = st.data_editor(
        editor_df,
        num_rows="dynamic",
        use_container_width=True,
        column_config={
            "uniform_number": st.column_config.TextColumn("背番号", help="複数はカンマ区切り（例: 10,5）", required=False),
            "player_name": st.column_config.TextColumn("選手名", required=True),
            "note": st.column_config.TextColumn("備考（ふりがな等）"),
        },
        key="roster_editor_v2",
    )

    b1, b2, b3 = st.columns(3)
    if b1.button("💾 名簿を保存", type="primary", use_container_width=True):
        rows = edited.fillna("").to_dict(orient="records")
        st.session_state.team_roster = [
            {
                "uniform_number": str(r.get("uniform_number", "")),
                "player_name": str(r.get("player_name", "")),
                "note": str(r.get("note", "")),
            }
            for r in rows
            if str(r.get("player_name", "")).strip()
        ]
        save_roster_to_disk(st.session_state.team_roster)
        st.success(f"{len(st.session_state.team_roster)} 名の名簿を {ROSTER_PATH.name} に保存しました")

    if b2.button("↩️ ディスクから再読込", use_container_width=True):
        st.session_state.team_roster = load_roster_from_disk()
        st.rerun()

    if b3.button("初期名簿にリセット", use_container_width=True):
        st.session_state.team_roster = [dict(r) for r in DEFAULT_ROSTER]
        save_roster_to_disk(st.session_state.team_roster)
        st.warning("初期名簿に戻して保存しました")
        st.rerun()

    with st.expander("AIに渡す名簿プレビュー"):
        st.code(format_roster_lines(st.session_state.team_roster))
