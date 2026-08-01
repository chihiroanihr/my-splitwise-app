# 精算アプリ

友達と割り勘を管理するモバイル向け Web アプリ。ログイン不要で、グループの URL を共有するだけで誰でも閲覧・編集できます。

## 機能

- グループ作成・名前変更・削除（URL 共有で参加）
- メンバーの追加・削除
- 支払いの記録（立替者・金額・対象メンバー）
- 均等割り / 個別金額指定の 2 モード
- 支払いの編集・削除
- メンバーごとの精算済み / 未精算ステータス切り替え
- 最小回数の送金で済む精算方法を自動計算
- 3 秒間隔のポーリングで他の人の更新を自動反映

## 技術構成

- Next.js 16（App Router） / TypeScript
- Tailwind CSS
- Neon Postgres（`@neondatabase/serverless`）
- SWR（ポーリングによる自動更新）

## セットアップ

```bash
npm install
cp .env.local.example .env.local   # DATABASE_URL を設定
npm run dev
```

テーブルは初回アクセス時に自動作成されます（`lib/db.ts` の `ensureSchema`）。

## デプロイ

Vercel にデプロイし、Marketplace から Neon を追加すると `DATABASE_URL` が自動で設定されます。
