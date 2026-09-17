import streamlit as st

def apply_app_style():
    """
    アプリ全体のデザイン・余白・配色を管理する専用スタイル関数
    今後デザインを変えたいときは、このファイルの中身だけを編集すればOKです。
    """
    st.markdown("""
    <style>
    /* 1. スマホ表示時の上部・左右の余白調整 */
    .block-container {
        padding-top: 2rem !important;
        padding-bottom: 2rem !important;
        padding-left: 0.8rem !important;
        padding-right: 0.8rem !important;
    }

    /* 2. タブバー（横スクロール対応 & ボタン風デザイン） */
    .stTabs [data-baseweb="tab-list"] {
        gap: 8px;
        overflow-x: auto !important;
        white-space: nowrap !important;
        padding-bottom: 8px;
        -webkit-overflow-scrolling: touch;
    }
    .stTabs [data-baseweb="tab"] {
        padding: 6px 14px;
        border-radius: 12px;
        background-color: rgba(120, 120, 120, 0.12);
        font-size: 0.9rem;
    }

    /* 3. スマホ上部固定画像ビューワーの枠装飾 */
    .sticky-mobile-viewer {
        position: -webkit-sticky;
        position: sticky;
        top: 3.5rem;
        z-index: 99;
        background-color: rgba(25, 25, 25, 0.95);
        padding: 8px;
        border-radius: 10px;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.4);
        margin-bottom: 12px;
    }
    </style>
    """, unsafe_allow_html=True)
