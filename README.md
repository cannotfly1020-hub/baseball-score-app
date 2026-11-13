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

- Canvas 前処理（高コントラスト原本 + 赤強調 + 上下2分割を JSON/Base64 で合計900KB以内）
- 3段解析（名簿抽出 → 上半分1–5番 → 下半分6–9番）
- 打席盤面のタップ修正（「要確認」は黄色ハイライト）
- ホーム / AI読取 / 選手成績・称号 / 試合履歴・Excel出力
- localStorage 保存 + JSON バックアップ / 復元
- LINE共有用ヒーローカード生成
- `noindex, nofollow` と AI 送信同意モーダル

## 技術メモ

- API: `GET/POST /api/analyze-score`（`application/json` Base64、`models.list` 動的フォールバック、上下グループ高精度読取）
- Excel: `xlsx` ライブラリ
- データ: 端末内 `localStorage`（キー `baseball-scorebook-v1`）
