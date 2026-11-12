# SCOREBOOK AI — 学童野球スコアブック読取

紙のスコアブック（早稲田式）をスマホで撮影し、Gemini で AI 解析・成績管理する Web アプリです。  
**Next.js (App Router) + TypeScript + Tailwind CSS** で構築しています（将来の Capacitor / iOS 化を想定したモバイルファースト設計）。

## セットアップ

```bash
npm install
cp .env.local.example .env.local
# .env.local に GEMINI_API_KEY=... を設定（または画面右上の設定から入力）
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。

## 主な機能

- Canvas 前処理（鮮鋭化カラー + 赤色抽出）を Gemini へ同時送信
- 2段階解析（名簿抽出 → 1〜7回の打席・打点・盗塁）
- 打席盤面のタップ修正（「要確認」は黄色ハイライト）
- ホーム / AI読取 / 選手成績・称号 / 試合履歴・Excel出力
- localStorage 保存 + JSON バックアップ / 復元
- LINE共有用ヒーローカード生成
- `noindex, nofollow` と AI 送信同意モーダル

## 技術メモ

- API: `POST /api/analyze-score`（`@google/genai` / `gemini-3.8-flash`）
- Excel: `xlsx` ライブラリ
- データ: 端末内 `localStorage`（キー `baseball-scorebook-v1`）
