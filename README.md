# CareLink

医療・福祉・美容 特化型 採用×集客プラットフォーム

## セットアップ

```bash
# 依存関係のインストール
npm install

# 環境変数の設定
cp .env.example .env.local
# .env.local にSupabaseのURL・キーを設定

# 開発サーバーの起動
npm run dev
```

http://localhost:3000 でアクセス

## ローカル DB（Supabase migration）

`supabase/migrations/*.sql` をローカルへ新規適用（fresh-apply）する場合は **Supabase CLI 2.104.0 以上**を使うこと。

```bash
supabase --version   # 2.104.0 以上であること
supabase start       # または: supabase db reset --local
```

> ⚠️ **CLI 2.75.0 以下では fresh-apply が失敗する**（既知の CLI バグ）。
> 2.75.0 系のマイグレーション文分割器は「引数リスト付き `CREATE FUNCTION` の直後に別の文が続くファイル」を1チャンクにまとめてしまい、
> `42601: cannot insert multiple commands into a prepared statement` で停止する（例: `20260420000003_booking_insert_rls.sql`）。
> このバグは 2.104.0 で修正済み。CI（`.github/workflows/ci.yml`）も `supabase/setup-cli@v1` を `version: 2.104.0` にピン留めしている。
> 古い CLI を使っている場合は `brew upgrade supabase` で更新する。

## 技術スタック

- Next.js 14（App Router）
- TypeScript
- Tailwind CSS
- react-hook-form + zod
- Supabase

## ページ構成

| パス | 説明 |
|------|------|
| `/` | トップページ |
| `/salon` | 施設向け集客LP |
| `/jobs` | 求職者向け転職LP |
| `/privacy` | プライバシーポリシー |
| `/terms` | 利用規約 |
| `/contact` | お問い合わせ |

## デプロイ

Vercelにインポートし、環境変数を設定してデプロイ。
