import io
import json
import base64
from google import genai
from google.genai import types
import streamlit as st
from PIL import Image

# 分離したファイルから読み込み
from prompts import ROSTER_PROMPT, DETAILS_PROMPT
from data_utils import enhance_sharpness
from ui_views import apply_custom_css, render_admin_view, render_roster_view

st.set_page_config(
    page_title="学童野球スコア集計＆デジタル選手名鑑",
    page_icon="⚾️",
    layout="wide",
)

# レスポンシブCSSの適用
apply_custom_css()

# セッション状態の初期化
if "all_matches_data" not in st.session_state:
    st.session_state.all_matches_data = {}
if "match_images_b64" not in st.session_state:
    st.session_state.match_images_b64 = {}

# APIキー設定
api_key = st.secrets.get("GEMINI_API_KEY")
if not api_key:
    api_key = st.sidebar.text_input("管理者APIキー (Gemini)", type="password")

client = genai.Client(api_key=api_key) if api_key else None

# タブ構成
tab_admin, tab_kids = st.tabs(
    ["📝 役員用（複数試合一括解析＆ポチポチ確定）", "🏆 選手名鑑＆アワード"]
)

# ==========================================
# ① 役員用タブ（アップロード & AI解析 & 編集UI）
# ==========================================
with tab_admin:
    if not client:
        st.warning("Gemini APIキーを設定してください（Secrets または サイドバー）。")
        st.stop()

    uploaded_files = st.file_uploader(
        "スコアブック写真を選択（複数ファイル選択可）",
        type=["jpg", "jpeg", "png"],
        accept_multiple_files=True
    )

    if uploaded_files:
        if st.button(f"AIで全{len(uploaded_files)}試合を高精度一括解析する", type="primary"):
            progress_bar = st.progress(0)
            status_text = st.empty()
            
            new_all_matches = {}
            new_images_b64 = {}

            for idx, f in enumerate(uploaded_files):
                f_name = f.name
                status_text.text(f"【{idx+1}/{len(uploaded_files)}】{f_name} の高解像度鮮鋭化＆選手名簿を確定中...")
                raw_bytes = f.read()
                new_images_b64[f_name] = base64.b64encode(raw_bytes).decode()
                
                # 画像の鮮鋭化（高画質原本の生成）
                pil_img = Image.open(io.BytesIO(raw_bytes))
                highres_bytes = enhance_sharpness(pil_img)

                try:
                    # Step 1: 選手名簿の確定
                    res_roster = client.models.generate_content(
                        model="gemini-3.6-flash",
                        contents=[
                            types.Part.from_bytes(data=highres_bytes, mime_type="image/jpeg"),
                            "スコアブック左側の打順・背番号・選手名（先発・交代・代打二段書き含む）を漏れなく抽出してください。"
                        ],
                        config=types.GenerateContentConfig(
                            system_instruction=ROSTER_PROMPT,
                            response_mime_type="application/json",
                            temperature=0.1
                        )
                    )
                    roster_data = res_roster.text

                    # Step 2: 打席判定
                    status_text.text(f"【{idx+1}/{len(uploaded_files)}】{f_name} の全イニング打席を精査中...")
                    res_details = client.models.generate_content(
                        model="gemini-3.6-flash",
                        contents=[
                            types.Part.from_bytes(data=highres_bytes, mime_type="image/jpeg"),
                            f"確定選手名簿:\n{roster_data}\n\n上記選手枠に基づき、スコアブックの1回〜7回の全打席詳細、打点、盗塁を判定してください。"
                        ],
                        config=types.GenerateContentConfig(
                            system_instruction=DETAILS_PROMPT,
                            response_mime_type="application/json",
                            temperature=0.1
                        )
                    )
                    parsed = json.loads(res_details.text)
                    new_all_matches[f_name] = parsed

                except Exception as e:
                    st.error(f"{f_name} の解析エラー: {e}")

                progress_bar.progress((idx + 1) / len(uploaded_files))

            status_text.empty()
            if new_all_matches:
                st.session_state.all_matches_data = new_all_matches
                st.session_state.match_images_b64 = new_images_b64
                st.success(f"🎉 全 {len(new_all_matches)} 試合分の解析が完了しました！")

    # 画面描画（ui_views.pyから呼び出し）
    render_admin_view()

# ==========================================
# ② 選手名鑑＆アワードタブ
# ==========================================
with tab_kids:
    render_roster_view()
