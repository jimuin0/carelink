# CareLink

## プロジェクト概要
医療・福祉・美容 特化型 採用×集客プラットフォームのLP・関連ページ一式。

## 技術スタック
- Next.js 14（App Router）
- TypeScript
- Tailwind CSS
- react-hook-form + zod（バリデーション）
- Supabase（@supabase/supabase-js）
- Vercel デプロイ

## ディレクトリ構成
```
src/
├── app/
│   ├── layout.tsx          # ルートレイアウト（Header/Footer/GA4/Clarity）
│   ├── page.tsx            # トップページ
│   ├── loading.tsx         # ローディング
│   ├── error.tsx           # エラー
│   ├── not-found.tsx       # 404
│   ├── sitemap.ts          # sitemap.xml
│   ├── robots.ts           # robots.txt
│   ├── salon/
│   │   ├── layout.tsx      # メタデータ
│   │   └── page.tsx        # 集客掲載LP（3ステップフォーム）
│   ├── jobs/
│   │   ├── layout.tsx      # メタデータ
│   │   └── page.tsx        # 求職者登録LP（3ステップフォーム）
│   ├── privacy/page.tsx    # プライバシーポリシー
│   ├── terms/page.tsx      # 利用規約
│   └── contact/page.tsx    # お問い合わせ
├── components/
│   ├── Header.tsx          # グローバルヘッダー
│   ├── Footer.tsx          # グローバルフッター
│   ├── FAQ.tsx             # アコーディオンFAQ
│   ├── Toast.tsx           # 通知トースト
│   ├── Spinner.tsx         # ローディングスピナー
│   ├── StepIndicator.tsx   # フォームステップ表示
│   └── PhotoUpload.tsx     # 写真アップロード（プレビュー付き）
├── lib/
│   ├── supabase.ts         # Supabaseクライアント
│   └── validations.ts      # zodスキーマ・定数
└── types/
    └── index.ts            # 型定義
```

## 環境変数
| 変数名 | 説明 |
|--------|------|
| NEXT_PUBLIC_SUPABASE_URL | Supabase Project URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase anon key |
| NEXT_PUBLIC_GA_ID | Google Analytics 4 測定ID（空なら無効） |
| NEXT_PUBLIC_CLARITY_ID | Microsoft Clarity プロジェクトID（空なら無効） |

## Supabaseテーブル設計

### salons
施設・サロンの掲載登録データ。
主要カラム: facility_name, business_type, representative_name, contact_name, email, phone, photo_url, status

### job_seekers
求職者の登録データ。
主要カラム: full_name, furigana, phone, email, job_type, certifications(TEXT[]), desired_employment_type(TEXT[]), photo_url, status

### contacts
お問い合わせデータ。
カラム: name, email, inquiry_type, message

### Storage
バケット: carelink-uploads（public）
パス: salons/[uuid]/photo.[ext], job_seekers/[uuid]/photo.[ext]

## デプロイ手順
1. GitHubリポジトリにpush
2. Vercelにインポート → 環境変数を設定
3. デプロイ完了

## 開発コマンド
```bash
npm run dev   # 開発サーバー起動
npm run build # ビルド
npm run lint  # ESLint
```

## テスト品質スタック 現在地

| レベル | 内容 | 状態 | 備考 |
|--------|------|------|------|
| L1 | ESLint / tsc | ✅ | エラー 0（2026-06-01 確認） |
| L2 | Jest ユニットテスト | ✅ | 4633 テスト全通過、194 スイート（2026-06-02） |
| L3 | Jest ブランチカバレッジ 100% | ✅ | 全体 100%（5890/5890 branches, 2026-06-02 実測）。前回 96.82% の未カバー187分岐（photos/blog-authors/reviews/staff/availability/notify 等）を全テスト追加で解消 |
| L4 | Stryker ミューテーション | ✅ | 全11ファイル survived=0。Stryker 実行環境を修復（middleware-auth の jest-env mixin 統一・SITE_URL 確定化）。db-fallback.ts 追加＋seo-snippets の真の生存7件（前回 timeout で隠蔽）を撃破。2026-06-02 |
| L5 | fast-check プロパティベース | ✅ | 31テスト全通過（db-fallback の isMissingColumnError/omitKeys プロパティ5件追加、2026-06-01） |
| L6 | npm audit / 認証テスト | ✅ | critical=0・high=0（moderate 5）、menu-remarks の認証/IDOR テスト追加（2026-06-01） |
| L7 | 構造化ログ + Slack + 外形監視 | ✅ | 2026-05-25 達成（A〜D 全基準） |
