> 新Mac・別アカウントでの再開は **[RESUME.md](RESUME.md)** から開始してください。

# CareLink

医療・福祉・美容 施設向けの予約管理・集客・採用を統合したマルチテナント SaaS（施設オーナーが予約枠・メニュー・スタッフ・クーポンを管理し、来院者が検索・予約・問診・口コミを行う）

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

- Next.js 16（App Router・16.3.0 以上を強制。実際の版は package-lock.json）
- TypeScript
- Tailwind CSS
- react-hook-form + zod
- Supabase（Postgres・Auth・Storage・RLS）

詳しい構成・運用上の注意は [CLAUDE.md](CLAUDE.md) を参照。

## ページ構成

| パス | 説明 |
|------|------|
| `/` | トップページ（来院者向け） |
| `/search` | 施設検索 |
| `/facility/[slug]` | 施設詳細・予約 |
| `/mypage` | 予約者マイページ（要ログイン） |
| `/register` | 店舗向けの掲載案内・申込（店舗向けの入口はここ 1 本。旧 `/salon` は 308 転送） |
| `/admin` | 施設オーナー管理画面（要ログイン・owner/admin のみ） |
| `/privacy` | プライバシーポリシー |
| `/terms` | 利用規約 |
| `/contact` | お問い合わせ |

## デプロイ

Vercelにインポートし、環境変数を設定してデプロイ。

## admin向け予定定義

`schedules.json` は `src/lib/cron-jobs.data.json` と `render.yaml` から生成する読み取り用の一覧です。
ジョブの追加・変更後は `node scripts/export-admin-schedules.mjs` を実行してください。
CIが `--check` で更新漏れを検知します。UTCからJSTへの変換では日付・曜日の繰り上がりも反映します。
このファイルは既存Cronの予定と実行先を表示するためのもので、新しいCronやメッセージ送信を作りません。
