# 精算アプリ

友達と割り勘を管理するモバイル向け Web アプリ。アカウント登録なしで使えて、
グループは招待リンクを受け取った人だけがアクセスできます。

## 機能

- グループ作成・名前変更・削除（作成者のみ）
- **招待リンクによる参加** — リンクを持たない人にはグループの中身が一切見えない
- メンバーの追加・削除（削除時は消えるデータの内訳を警告）
- 支払いの記録・編集・削除（均等割り / 個別金額指定）
- メンバーごとの精算済み / 未精算ステータス切り替え
- 最小回数の送金で済む精算方法を自動計算
- 3 秒間隔のポーリングで他の人の更新を自動反映
- 管理者モード（全グループの閲覧・管理）

## アクセス制御の仕組み

ログインもパスワードもありません。代わりに、初回アクセス時にサーバーが
ランダムな値を **httpOnly Cookie** として発行し、それが端末の身元になります。

| 役割 | 権限 |
|---|---|
| 管理者 | すべてのグループを閲覧・編集・削除 |
| 作成者 (owner) | そのグループの削除・名前変更・支払い編集 |
| 参加者 (member) | そのグループの支払い追加・編集・精算チェック |
| それ以外 | 403。存在の有無すら分からない |

判定は**すべてサーバー側**（`lib/session.ts` の `authorizeGroup`）で行い、
全 API ルートの先頭で呼び出しています。

Cookie に入る値そのものは保存せず、SHA-256 ハッシュだけを `app_users` に置くため、
データベースが漏れてもセッションの偽装はできません。

### 制約

- Cookie を消す / 端末を変えるとアクセス権を失います。招待リンクを開き直せば復帰できます。
- 招待リンクを転送された人も参加できます。ログインなしの構成では原理的に防げません。

## 技術構成

- Next.js 16（App Router） / TypeScript
- Tailwind CSS
- Neon Postgres（`@neondatabase/serverless`）
- SWR（ポーリングによる自動更新）

## セットアップ

```bash
npm install
cp .env.local.example .env.local   # DATABASE_URL と ADMIN_KEY を設定
npm run dev
```

テーブルは初回アクセス時に自動作成されます（`lib/db.ts` の `ensureSchema`）。

## テスト

```bash
npm run test:unit    # 精算計算と端数処理（DB 不要・1秒未満）
npm run test:api     # 権限・CRUD・カスケード削除
npm run test:e2e     # ブラウザ操作（Playwright / WebKit）
npm test             # 上記すべて
npm run test:health  # 本番への読み取り専用の死活監視
```

| 層 | 守る対象 | 実行時間 |
|---|---|---|
| 単体 | `computeBalances` / `splitEqually` | 1 秒未満 |
| API 統合 | 権限境界、精算、カスケード削除 | 約 1 分 |
| E2E | 画面が実際に動くか | 約 45 秒 |

**API と E2E は本番とは別の Neon プロジェクト**（`TEST_DATABASE_URL`）を使います。
`scripts/with-server.mjs` がこれを `DATABASE_URL` に差し替えてサーバーを起動するため、
テストが本番データに触れることはありません。

E2E 層は他の層では見つけられない不具合を担当します。削除ボタンはかつて
`window.confirm()` に依存しており、アプリ内ブラウザがダイアログを抑制すると
無反応になっていました。API テストでは検出できません。

### 自動実行

- **`.github/workflows/ci.yml`** — push / PR のたびに全テスト
- **`.github/workflows/health.yml`** — 毎週月曜 9:00 JST に本番の死活監視

CI には GitHub のシークレットとして `TEST_DATABASE_URL` と `ADMIN_KEY` が必要です。

## デプロイ

Vercel にデプロイし、Marketplace から Neon を追加すると `DATABASE_URL` が自動で設定されます。
`ADMIN_KEY` は Vercel の環境変数に手動で追加してください。
