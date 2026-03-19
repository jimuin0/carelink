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
