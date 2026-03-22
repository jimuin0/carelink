# CareLink マニュアル v2.0

**最終更新**: 2026年3月22日
**バージョン**: 2.0
**作成者**: Claude + 神原 良祐
**プロジェクト**: ~/Projects/carelink/

> 医療・福祉・美容業界に特化した採用×集客プラットフォーム。
> - **LP（ランディングページ）**: 施設掲載登録・求職者登録・お問い合わせ
> - **検索サイト**: 施設検索・施設詳細・口コミ・お問い合わせフォーム

---

## 目次

1. [システム概要](#1-システム概要)
2. [アーキテクチャ](#2-アーキテクチャ)
3. [ディレクトリ構成](#3-ディレクトリ構成)
4. [環境変数・セットアップ](#4-環境変数セットアップ)
5. [デプロイ（Vercel）](#5-デプロイvercel)
6. [DB設計（Supabase）](#6-db設計supabase)
7. [業務フロー（全体像）](#7-業務フロー全体像)
8. [ページ構成](#8-ページ構成)
9. [フォーム・バリデーション](#9-フォームバリデーション)
10. [API Route](#10-api-route)
11. [コンポーネント設計](#11-コンポーネント設計)
12. [SEO・構造化データ](#12-seo構造化データ)
13. [セキュリティ](#13-セキュリティ)
14. [アクセシビリティ](#14-アクセシビリティ)
15. [アナリティクス](#15-アナリティクス)
16. [デザインシステム](#16-デザインシステム)
17. [法的対応](#17-法的対応)
18. [運用手順](#18-運用手順)
19. [トラブルシューティング](#19-トラブルシューティング)
20. [テスト](#20-テスト)
21. [既知の制限事項・今後の開発予定](#21-既知の制限事項今後の開発予定)

---

## 1. システム概要

### 1.1 サービス概要

| 項目 | 値 |
|------|-----|
| サービス名 | CareLink |
| 運営 | 神原良祐（HALグループ） |
| 所在地 | 大阪府堺市 |
| 用途 | 施設集客 + 求職者転職支援（情報掲載型）+ 施設検索 |
| 料金 | 完全無料（施設掲載・求職者登録とも） |

### 1.2 サイト構成（2つのサイトが同居）

| サイト | パス | 用途 | ヘッダー/フッター |
|--------|------|------|-------------------|
| LP（ランディングページ） | `/`, `/salon`, `/jobs`, `/contact`, `/privacy`, `/terms` | 施設登録・求職者登録・お問い合わせ | Header + Footer |
| 検索サイト | `/search`, `/facility/[slug]` | 施設検索・詳細・口コミ・問い合わせ | SearchHeader + SearchFooter |

> `LayoutSwitch` コンポーネントが `usePathname()` でパスを判別し、LP用/検索用のヘッダー・フッターを自動切替する。

### 1.3 対象業種

- 美容サロン・アイラッシュ
- 鍼灸院
- 整骨院
- 介護施設・デイサービス
- 病院・クリニック

> LP登録フォームでは「その他」選択可。検索サイトでは上記5業種のみ。

### 1.4 技術スタック

| 技術 | 用途 | バージョン |
|------|------|-----------|
| Node.js | ランタイム | 20.x |
| Next.js | フレームワーク（App Router） | 14.2.35 |
| React | UI | 18 |
| TypeScript | 言語 | 5 |
| Tailwind CSS | スタイリング | 3.4.1 |
| Supabase | DB（PostgreSQL）+ Storage | SDK 2.99.2 |
| Zod | バリデーション | 4.3.6 |
| React Hook Form | フォーム管理 | 7.71.2 |
| Vercel | ホスティング・CDN | - |
| Vercel Analytics | アクセス解析 | 2.0.1 |
| Vercel Speed Insights | パフォーマンス | 2.0.0 |
| Noto Sans JP | 日本語フォント | Google Fonts |

### 1.5 本番URL

| 画面 | URL | 備考 |
|------|-----|------|
| 本番（Vercel） | https://carelink-ruddy-psi.vercel.app | カスタムドメイン未設定 |
| 予定ドメイン | https://carelink.jp | 取得・設定後 |
| GitHub | jimuin0/carelink | プライベート |
| Supabase Dashboard | https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe | テーブル・Storage管理 |

### 1.6 アクセス情報

| サービス | アクセス方法 | 管理者 |
|---------|------------|--------|
| GitHub リポジトリ | `jimuin0` アカウントに招待 | 神原良祐 |
| Vercel プロジェクト | `team_FxqzqrTMTrJeIfpVf2vYfqkX` チームに招待 | 神原良祐 |
| Supabase プロジェクト | Dashboard でチームメンバー追加 | 神原良祐 |
| Slack ワークスペース | ワークスペースに招待 | 神原良祐 |

**Supabase プロジェクトURL**: `https://xzafxiupbflvgbarrihe.supabase.co`

### 1.7 現在の外部サービス設定状況（2026-03-22時点）

| サービス | 状態 | 備考 |
|---------|:----:|------|
| Supabase DB（LP: 3テーブル） | ✅ 設定済み | salons / job_seekers / contacts + RLS |
| Supabase DB（検索: 5テーブル） | ✅ 設定済み | facility_profiles / menus / photos / reviews / inquiries + RLS + トリガー |
| Supabase Storage | ✅ 設定済み | carelink-uploads バケット |
| Vercel デプロイ | ✅ 稼働中 | GitHub連携で自動デプロイ（push→自動ビルド） |
| Slack Incoming Webhook | ❌ 未設定 | Webhook URL作成 + Vercel環境変数設定が必要 |
| Google Analytics 4 | ❌ 未設定 | プロパティ作成 + 測定ID設定が必要 |
| Microsoft Clarity | ❌ 未設定 | プロジェクト作成 + ID設定が必要 |
| カスタムドメイン | ❌ 未設定 | ドメイン取得 + DNS設定が必要 |

---

## 2. アーキテクチャ

### 2.1 全体構成

```
ユーザー（ブラウザ）
    |
    | LP: 施設登録 / 求職者登録 / お問い合わせ
    | 検索: 施設検索 / 施設詳細 / 口コミ投稿 / お問い合わせ
    v
Vercel (Next.js App Router)
    |
    |-- [LP側]
    |   |-- src/app/page.tsx              … トップページ（LP）
    |   |-- src/app/salon/page.tsx        … 施設掲載登録（3ステップフォーム）
    |   |-- src/app/jobs/page.tsx         … 求職者登録（3ステップフォーム）
    |   |-- src/app/contact/page.tsx      … お問い合わせフォーム
    |   |-- src/app/api/notify/route.ts   … Slack通知 API Route
    |
    |-- [検索側]
    |   |-- src/app/search/page.tsx            … 施設検索（force-dynamic）
    |   |-- src/app/facility/[slug]/page.tsx   … 施設詳細（ISR: 1時間）
    |   |-- src/lib/facilities.ts              … DBクエリ（サーバーサイド）
    |   |-- src/lib/supabase-server.ts         … サーバー用Supabaseクライアント
    |
    |  LP側フォーム送信の処理フロー:
    |  ├─ 1. Zodバリデーション（クライアント側）
    |  ├─ 2. 確認ダイアログ表示
    |  ├─ 3. Supabase INSERT（クライアント側・anon key使用）
    |  ├─ 4. 写真アップロード（施設のみ・Supabase Storage）
    |  ├─ 5. POST /api/notify（サーバー側 → Slack通知）
    |  └─ 6. 完了画面表示
    |
    |  検索側口コミ/問い合わせの処理フロー:
    |  ├─ 1. Zodバリデーション（クライアント側）
    |  ├─ 2. 確認ダイアログ表示
    |  ├─ 3. Supabase INSERT（クライアント側・anon key使用）
    |  ├─ 4. POST /api/notify（Slack通知・fire-and-forget）
    |  └─ 5. トースト表示
    v
Supabase (PostgreSQL + Storage)
    |-- [LP側テーブル]
    |   |-- salons                    … 施設登録データ
    |   |-- job_seekers               … 求職者登録データ
    |   |-- contacts                  … お問い合わせデータ
    |   |-- carelink-uploads バケット  … 施設写真（Public read）
    |
    |-- [検索側テーブル]
    |   |-- facility_profiles         … 施設公開データ（検索・詳細表示）
    |   |-- facility_menus            … メニュー（カテゴリ・価格・時間）
    |   |-- facility_photos           … 写真（ソート順付き）
    |   |-- facility_reviews          … 口コミ（星評価 + コメント）
    |   |-- facility_inquiries        … 施設宛お問い合わせ
    |
    |-- [トリガー]
    |   |-- update_facility_rating()  … reviews INSERT/UPDATE/DELETE時にrating_avg/countを自動再計算

外部サービス:
    |-- Slack Incoming Webhook   … フォーム送信通知（管理者へ）
    |-- Google Analytics 4      … アクセス解析
    |-- Microsoft Clarity       … ヒートマップ・セッション録画
    |-- Vercel Analytics         … Web Vitals
```

### 2.2 重要な設計ポイント

- **管理画面なし**: 登録データの確認・管理はSupabase Dashboardで直接行う
- **クライアント側INSERT**: Supabase anon keyでクライアントから直接DBに書き込む（RLSでINSERTのみ許可）
- **通知は補助機能**: Slack通知失敗でもフォーム送信は成功扱い（DB保存が優先）
- **LP側は全Static**: ビルド時に静的HTML生成（CDN配信）
- **検索側はSSR/ISR**: search は `force-dynamic`（毎回DB取得）、facility は ISR（1時間キャッシュ）
- **LayoutSwitch**: `usePathname()` で LP用/検索用のヘッダー・フッターを自動切替
- **Supabaseクライアント2種**: クライアント用 (`supabase.ts`) とサーバー用 (`supabase-server.ts`)

---

## 3. ディレクトリ構成

```
~/Projects/carelink/
├── docs/
│   └── MANUAL.md                     … このマニュアル
├── supabase/
│   └── migrations/
│       └── 20260322_reviews_inquiries.sql  … 口コミ・問い合わせテーブル
├── public/
│   ├── favicon.svg                   … ファビコン
│   ├── apple-touch-icon.png          … Apple Touch Icon
│   └── og-image.png                  … OGP画像（1200x630）
├── src/
│   ├── app/
│   │   ├── layout.tsx                … ルートレイアウト（メタデータ・構造化データ・GA4・Clarity）
│   │   ├── page.tsx                  … トップページ（LP）
│   │   ├── loading.tsx               … ルートスケルトンUI
│   │   ├── error.tsx                 … ルートエラーページ
│   │   ├── not-found.tsx             … ルート404ページ（robots noindex）
│   │   ├── globals.css               … グローバルCSS（Tailwindコンポーネント定義）
│   │   ├── robots.ts                 … robots.txt生成
│   │   ├── sitemap.ts                … 動的sitemap.xml生成（DB連携）
│   │   │
│   │   ├── search/                   … 【検索サイト】施設検索
│   │   │   ├── page.tsx              … 検索結果ページ（force-dynamic）
│   │   │   ├── layout.tsx            … メタデータ
│   │   │   ├── loading.tsx           … 検索スケルトンUI
│   │   │   └── error.tsx             … 検索エラーページ
│   │   │
│   │   ├── facility/                 … 【検索サイト】施設詳細
│   │   │   └── [slug]/
│   │   │       ├── page.tsx          … 施設詳細ページ（ISR: 1時間）
│   │   │       ├── loading.tsx       … 詳細スケルトンUI
│   │   │       ├── not-found.tsx     … 施設404ページ（robots noindex）
│   │   │       └── error.tsx         … 施設エラーページ
│   │   │
│   │   ├── salon/                    … 【LP】施設掲載登録
│   │   │   ├── page.tsx              … 3ステップフォーム
│   │   │   └── layout.tsx            … メタデータ・パンくず構造化データ
│   │   ├── jobs/                     … 【LP】求職者登録
│   │   │   ├── page.tsx              … 3ステップフォーム
│   │   │   └── layout.tsx            … メタデータ・パンくず構造化データ
│   │   ├── contact/                  … 【LP】お問い合わせ
│   │   │   ├── page.tsx
│   │   │   └── layout.tsx
│   │   ├── privacy/
│   │   │   └── page.tsx              … プライバシーポリシー
│   │   ├── terms/
│   │   │   └── page.tsx              … 利用規約
│   │   └── api/
│   │       └── notify/
│   │           └── route.ts          … Slack通知API（Zod検証・レート制限付き）
│   │
│   ├── components/
│   │   ├── LayoutSwitch.tsx          … LP/検索のヘッダー・フッター自動切替
│   │   ├── ConfirmDialog.tsx         … 確認ダイアログ（フォーカストラップ付き）
│   │   ├── Toast.tsx                 … トースト通知（role="alert"）
│   │   ├── Header.tsx                … LP用ヘッダー
│   │   ├── Footer.tsx                … LP用フッター
│   │   ├── FadeIn.tsx                … スクロールフェードインアニメーション
│   │   ├── FAQ.tsx                   … FAQアコーディオン
│   │   ├── StepIndicator.tsx         … フォームステップインジケーター
│   │   ├── PhotoUpload.tsx           … 写真アップロード（プレビュー付き）
│   │   ├── Spinner.tsx               … ローディングスピナー
│   │   │
│   │   ├── search/                   … 【検索サイト用コンポーネント】
│   │   │   ├── SearchHeader.tsx      … 検索用スティッキーヘッダー（業種ナビ）
│   │   │   ├── SearchFooter.tsx      … 検索用ダークフッター
│   │   │   ├── SearchBar.tsx         … 検索フォーム（キーワード/業種/エリア）
│   │   │   ├── FacilityCard.tsx      … 施設カード（画像/評価/所在地）
│   │   │   └── Pagination.tsx        … ページネーション（省略記号付き）
│   │   │
│   │   └── facility/                 … 【施設詳細用コンポーネント】
│   │       ├── PhotoGallery.tsx      … 写真ギャラリー（メイン+サムネイル）
│   │       ├── FacilityHeader.tsx    … 施設名・業種バッジ・評価表示
│   │       ├── TabNavigation.tsx     … スティッキータブ（Top/Menu/口コミ/Access）
│   │       ├── MenuList.tsx          … カテゴリ別メニュー一覧
│   │       ├── AccessInfo.tsx        … アクセス・営業時間・Google Map
│   │       ├── ReviewTab.tsx         … 口コミタブ（一覧+評価グラフ+投稿フォーム）
│   │       ├── ReviewList.tsx        … 口コミカード一覧
│   │       ├── ReviewForm.tsx        … 口コミ投稿フォーム
│   │       ├── InquiryForm.tsx       … 施設お問い合わせフォーム
│   │       ├── StarRating.tsx        … 星評価コンポーネント（入力/表示兼用）
│   │       └── StickyBookingBar.tsx  … 固定下部バー（電話/お問い合わせ）
│   │
│   ├── lib/
│   │   ├── supabase.ts              … クライアント用Supabaseインスタンス
│   │   ├── supabase-server.ts       … サーバー用Supabaseクライアント
│   │   ├── facilities.ts            … 施設DBクエリ（検索/詳細/メニュー/写真/口コミ）
│   │   ├── constants.ts             … 都道府県・業種・特徴・曜日定数
│   │   └── validations.ts           … LP用Zodスキーマ・バリデーション
│   │
│   └── types/
│       └── index.ts                 … 全型定義
│
├── .env.example                     … 環境変数テンプレート
├── next.config.mjs                  … Next.js設定（セキュリティヘッダー・画像最適化）
├── tailwind.config.ts               … Tailwind設定
├── tsconfig.json                    … TypeScript設定
├── postcss.config.mjs               … PostCSS設定
├── package.json                     … 依存関係
└── .eslintrc.json                   … ESLint設定
```

---

## 4. 環境変数・セットアップ

### 4.1 環境変数一覧

| 変数 | 用途 | 必須 | スコープ | 設定場所 |
|------|------|:----:|---------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | ✅ | クライアント | Vercel + .env.local |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | ✅ | クライアント | Vercel + .env.local |
| `NEXT_PUBLIC_BASE_URL` | 本番URL（metadataBase・sitemap・canonical用） | - | クライアント | Vercel + .env.local |
| `NEXT_PUBLIC_GA_ID` | Google Analytics 4 測定ID | - | クライアント | Vercel のみ |
| `NEXT_PUBLIC_CLARITY_ID` | Microsoft Clarity プロジェクトID | - | クライアント | Vercel のみ |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL | - | サーバーのみ | Vercel + .env.local |

> **NEXT_PUBLIC_** プレフィックス付き: クライアントJSバンドルに含まれる（公開される）
> **プレフィックスなし** (`SLACK_WEBHOOK_URL`): サーバー側のAPI Route内でのみアクセス可能

### 4.2 ローカルセットアップ

```bash
# 1. リポジトリクローン
git clone https://github.com/jimuin0/carelink.git
cd carelink

# 2. Node.jsバージョン確認（v20推奨）
node -v  # v20.x

# 3. 依存関係インストール
npm install

# 4. 環境変数設定
cp .env.example .env.local
# .env.local を編集して実際の値を設定

# 5. 開発サーバー起動
npm run dev
# → http://localhost:3000
```

### 4.3 .env.example

```env
# Supabase（必須）
NEXT_PUBLIC_SUPABASE_URL=https://xzafxiupbflvgbarrihe.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here

# 本番URL（省略時: https://carelink-ruddy-psi.vercel.app）
NEXT_PUBLIC_BASE_URL=http://localhost:3000

# Slack通知（省略時: 通知なし・500レスポンス）
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/REDACTED

# アナリティクス（省略時: 読み込みスキップ）
# NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX
# NEXT_PUBLIC_CLARITY_ID=xxxxxxxxxx
```

---

## 5. デプロイ（Vercel）

### 5.1 デプロイ方法

**GitHub連携で自動デプロイ**が設定済み。`git push origin main` するだけで自動的にビルド・デプロイされる。

```bash
# 通常の開発フロー（pushで自動デプロイ）
git add <変更ファイル>
git commit -m "変更内容"
git push origin main
# → Vercelが自動検知してビルド・デプロイ
```

> 手動デプロイが必要な場合: `npx vercel --prod`

### 5.2 Vercel設定

| 設定 | 値 |
|------|-----|
| プロジェクト名 | `carelink` |
| プロジェクトID | `prj_bckwxIcEfm4bcQ3k4dVdPmWez3aB` |
| 組織ID | `team_FxqzqrTMTrJeIfpVf2vYfqkX` |
| GitHub連携 | `jimuin0/carelink` → main ブランチ自動デプロイ |
| フレームワーク | Next.js（自動検出） |
| ビルドコマンド | `next build`（デフォルト） |
| 出力ディレクトリ | `.next`（デフォルト） |

### 5.3 Vercel環境変数の設定

```bash
# Vercel CLI で環境変数を追加（対話式で値を入力）
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SLACK_WEBHOOK_URL
vercel env add NEXT_PUBLIC_BASE_URL
vercel env add NEXT_PUBLIC_GA_ID
vercel env add NEXT_PUBLIC_CLARITY_ID
```

### 5.4 カスタムドメイン設定（未実施）

```bash
# ドメイン取得後
vercel domains add carelink.jp
# DNS設定: CNAME → cname.vercel-dns.com

# 設定後、環境変数も更新
# NEXT_PUBLIC_BASE_URL=https://carelink.jp
```

---

## 6. DB設計（Supabase）

### 6.1 テーブル一覧

| テーブル | 用途 | サイト |
|---------|------|--------|
| `salons` | 施設掲載登録データ | LP |
| `job_seekers` | 求職者登録データ | LP |
| `contacts` | LP問い合わせデータ | LP |
| `facility_profiles` | 施設公開プロフィール（検索・詳細表示） | 検索 |
| `facility_menus` | 施設メニュー（カテゴリ・価格・時間） | 検索 |
| `facility_photos` | 施設写真（ソート順付き） | 検索 |
| `facility_reviews` | 口コミ（星評価+コメント） | 検索 |
| `facility_inquiries` | 施設宛お問い合わせ | 検索 |

### 6.2 LP側テーブル（DDL）

#### salons テーブル

```sql
CREATE TABLE salons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  facility_name TEXT NOT NULL,
  business_type TEXT NOT NULL,
  representative_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  postal_code TEXT,
  address TEXT,
  business_hours TEXT,
  regular_holiday TEXT,
  seat_count INTEGER,
  staff_count INTEGER,
  pr_text TEXT,
  photo_url TEXT,
  desired_start_date TEXT
);

ALTER TABLE salons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anonymous insert" ON salons FOR INSERT WITH CHECK (true);
```

#### job_seekers テーブル

```sql
CREATE TABLE job_seekers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  full_name TEXT NOT NULL,
  furigana TEXT NOT NULL,
  birth_date TEXT,
  gender TEXT,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  postal_code TEXT,
  address TEXT,
  job_type TEXT NOT NULL,
  certifications TEXT[],
  experience_years TEXT,
  education TEXT,
  previous_job TEXT,
  desired_employment_type TEXT[],
  desired_location TEXT,
  desired_salary TEXT,
  self_pr TEXT
);

ALTER TABLE job_seekers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anonymous insert" ON job_seekers FOR INSERT WITH CHECK (true);
```

#### contacts テーブル

```sql
CREATE TABLE contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  inquiry_type TEXT NOT NULL,
  message TEXT NOT NULL
);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anonymous insert" ON contacts FOR INSERT WITH CHECK (true);
```

### 6.3 検索側テーブル（DDL）

#### facility_profiles テーブル

```sql
CREATE TABLE facility_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  business_type TEXT NOT NULL,
  catch_copy TEXT,
  description TEXT,
  prefecture TEXT,
  city TEXT,
  address TEXT,
  building TEXT,
  phone TEXT,
  website_url TEXT,
  access_info TEXT,
  business_hours JSONB,          -- {"mon": {"open":"10:00","close":"19:00"}, "tue": null, ...}
  regular_holiday TEXT,
  features TEXT[],                -- ["駐車場あり", "個室あり", "WiFi完備", ...]
  seat_count INTEGER,
  staff_count INTEGER,
  has_parking BOOLEAN DEFAULT false,
  accepts_credit_card BOOLEAN DEFAULT false,
  main_photo_url TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  rating_avg NUMERIC(2,1) DEFAULT 0,   -- トリガーで自動計算
  rating_count INTEGER DEFAULT 0,       -- トリガーで自動計算
  status TEXT DEFAULT 'published' CHECK (status IN ('draft','published','suspended')),
  CONSTRAINT valid_rating CHECK (rating_avg >= 0 AND rating_avg <= 5)
);

ALTER TABLE facility_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON facility_profiles FOR SELECT USING (status = 'published');
```

#### facility_menus テーブル

```sql
CREATE TABLE facility_menus (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  facility_id UUID REFERENCES facility_profiles(id) ON DELETE CASCADE NOT NULL,
  category TEXT,
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER,
  price_note TEXT,              -- "要相談" など自由テキスト
  duration_minutes INTEGER,
  is_featured BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE facility_menus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON facility_menus FOR SELECT USING (true);
```

#### facility_photos テーブル

```sql
CREATE TABLE facility_photos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  facility_id UUID REFERENCES facility_profiles(id) ON DELETE CASCADE NOT NULL,
  url TEXT NOT NULL,
  alt_text TEXT,
  photo_type TEXT DEFAULT 'interior',  -- interior / exterior / menu / staff / other
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE facility_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read" ON facility_photos FOR SELECT USING (true);
```

#### facility_reviews テーブル

```sql
CREATE TABLE facility_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  facility_id UUID REFERENCES facility_profiles(id) ON DELETE CASCADE NOT NULL,
  reviewer_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  status TEXT DEFAULT 'published' CHECK (status IN ('published','hidden')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE facility_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read published" ON facility_reviews FOR SELECT USING (status = 'published');
CREATE POLICY "Allow anonymous insert" ON facility_reviews FOR INSERT WITH CHECK (true);
```

#### facility_inquiries テーブル

```sql
CREATE TABLE facility_inquiries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  facility_id UUID REFERENCES facility_profiles(id) ON DELETE CASCADE NOT NULL,
  facility_name TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE facility_inquiries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anonymous insert" ON facility_inquiries FOR INSERT WITH CHECK (true);
```

### 6.4 トリガー（口コミ→評価自動更新）

```sql
CREATE OR REPLACE FUNCTION update_facility_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE facility_profiles SET
    rating_avg = COALESCE(
      (SELECT ROUND(AVG(rating)::numeric, 1) FROM facility_reviews
       WHERE facility_id = COALESCE(NEW.facility_id, OLD.facility_id)
       AND status = 'published'), 0),
    rating_count = COALESCE(
      (SELECT COUNT(*) FROM facility_reviews
       WHERE facility_id = COALESCE(NEW.facility_id, OLD.facility_id)
       AND status = 'published'), 0),
    updated_at = NOW()
  WHERE id = COALESCE(NEW.facility_id, OLD.facility_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_facility_rating
AFTER INSERT OR UPDATE OR DELETE ON facility_reviews
FOR EACH ROW EXECUTE FUNCTION update_facility_rating();
```

> 口コミのINSERT/UPDATE/DELETE時に `facility_profiles.rating_avg` と `rating_count` を自動再計算。

### 6.5 RLS（Row Level Security）まとめ

| テーブル | anon SELECT | anon INSERT | 条件 |
|---------|:----------:|:----------:|------|
| salons | ❌ | ✅ | LP登録のみ |
| job_seekers | ❌ | ✅ | LP登録のみ |
| contacts | ❌ | ✅ | LP問い合わせのみ |
| facility_profiles | ✅ | ❌ | status='published'のみ読み取り可 |
| facility_menus | ✅ | ❌ | 全件読み取り可 |
| facility_photos | ✅ | ❌ | 全件読み取り可 |
| facility_reviews | ✅ | ✅ | SELECT: status='published'のみ / INSERT: 誰でも投稿可 |
| facility_inquiries | ❌ | ✅ | 投稿のみ（閲覧はDashboard） |

### 6.6 Storage（写真アップロード）

#### バケット設定

| 項目 | 値 |
|------|-----|
| バケット名 | `carelink-uploads` |
| 公開設定 | Public read |
| サイズ制限 | 10MB |
| 対応形式 | JPEG, PNG, WebP, GIF |

#### ファイルパス形式

```
carelink-uploads/salons/{uuid}/photo.{ext}
```

### 6.7 登録データの確認方法

管理画面がないため、登録データは以下の方法で確認:

1. **Supabase Dashboard（推奨）**: `https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe` → Table Editor
2. **Slack通知（リアルタイム）**: フォーム送信のたびに通知
3. **SQL Editor（集計）**: Supabase Dashboard → SQL Editor

---

## 7. 業務フロー（全体像）

### 7.1 施設掲載登録フロー（LP: /salon）

```
【顧客】/salon にアクセス
  ├─ Step 1: 基本情報（施設名・業種・代表者・担当者・メール・電話）
  ├─ Step 2: 詳細情報（郵便番号・住所・営業時間・定休日・席数・スタッフ数）
  ├─ Step 3: PR情報（PR文・写真・希望開始日）
  ├─ 同意チェック → 確認ダイアログ
  ├─ Supabase INSERT + Storage upload + Slack通知
  └─ 完了画面: 「担当者より2営業日以内にご連絡いたします。」

【管理者】
  ├─ Slack通知で認知 → Supabase Dashboardで詳細確認
  └─ 2営業日以内に連絡
```

### 7.2 求職者登録フロー（LP: /jobs）

```
【求職者】/jobs にアクセス
  ├─ Step 1: 基本情報（氏名・フリガナ・電話・メール等）
  ├─ Step 2: 経歴（職種・資格・経験年数等）
  ├─ Step 3: 希望条件（雇用形態・勤務地・年収・自己PR）
  ├─ 同意チェック → 確認ダイアログ
  ├─ Supabase INSERT + Slack通知
  └─ 完了画面

【管理者】
  └─ Supabase Dashboardで確認・対応
```

### 7.3 施設検索フロー（検索: /search）

```
【ユーザー】/search にアクセス
  ├─ キーワード・業種・エリアで検索
  ├─ 並び替え（新着順 / 評価順）
  ├─ 施設カード一覧（20件/ページ）
  ├─ ページネーション
  └─ カードクリック → /facility/[slug] 施設詳細ページ
```

### 7.4 施設詳細フロー（検索: /facility/[slug]）

```
【ユーザー】/facility/[slug] にアクセス
  ├─ パンくずナビ: CareLink > 施設名
  ├─ 写真ギャラリー → タブ切替（Top / メニュー / 口コミ / アクセス）
  ├─ 口コミ投稿: 名前・星評価・コメント → 確認ダイアログ → Supabase INSERT
  ├─ お問い合わせフォーム: 名前・メール・電話・メッセージ → 確認ダイアログ → Supabase INSERT + Slack通知
  └─ StickyBookingBar: 電話 / お問い合わせ（#contact-sectionにスクロール）

【管理者】
  ├─ 口コミ: Supabase Dashboardで status を published/hidden で管理
  └─ 問い合わせ: facility_inquiries テーブルで確認
```

### 7.5 Slack通知メッセージ例

**施設掲載の新規登録:**
```
:office: *施設掲載の新規登録*
> *施設名:* リラクゼーションサロン ABC
> *業種:* 美容サロン・アイラッシュ
> *代表者:* 山田 太郎
> *電話:* 090-1234-5678
> *メール:* salon@example.com
```

**施設へのお問い合わせ（検索サイト）:**
```
:envelope: *施設へのお問い合わせ*
> *施設名:* HAL eyelash 堺店
> *お名前:* 佐藤 花子
> *メール:* hanako@example.com
> *電話:* 080-1234-5678
> *内容:* 予約について質問があります。
```

---

## 8. ページ構成

### 8.1 ページ一覧

| パス | ファイル | レンダリング | サイト | 説明 |
|------|---------|:----------:|:------:|------|
| `/` | `page.tsx` | Static | LP | トップページ |
| `/salon` | `salon/page.tsx` | Static | LP | 施設掲載登録 |
| `/jobs` | `jobs/page.tsx` | Static | LP | 求職者登録 |
| `/contact` | `contact/page.tsx` | Static | LP | お問い合わせ |
| `/privacy` | `privacy/page.tsx` | Static | 共通 | プライバシーポリシー |
| `/terms` | `terms/page.tsx` | Static | 共通 | 利用規約 |
| `/search` | `search/page.tsx` | Dynamic | 検索 | 施設検索（force-dynamic） |
| `/facility/[slug]` | `facility/[slug]/page.tsx` | ISR(1h) | 検索 | 施設詳細 |
| `/api/notify` | `api/notify/route.ts` | Dynamic | 共通 | Slack通知API（POST） |
| `/sitemap.xml` | `sitemap.ts` | Dynamic | 共通 | 動的サイトマップ |
| `/robots.txt` | `robots.ts` | Static | 共通 | robots.txt |

> **Static** = ビルド時に静的HTML生成（CDN配信）
> **Dynamic** = リクエストごとにサーバー実行
> **ISR** = Incremental Static Regeneration（キャッシュ + バックグラウンド再生成）

### 8.2 特殊ページ（エラー・ローディング・404）

| ファイル | スコープ | 内容 |
|---------|--------|------|
| `app/loading.tsx` | ルート | ヒーロー+3カードのスケルトン |
| `app/error.tsx` | ルート | 「エラーが発生しました」+ リトライ |
| `app/not-found.tsx` | ルート | 404 + 3つのリンク（robots noindex） |
| `search/loading.tsx` | 検索 | 検索バー+カードグリッドのスケルトン |
| `search/error.tsx` | 検索 | 「検索結果を表示できません」+ リトライ |
| `facility/[slug]/loading.tsx` | 施設詳細 | パンくず+ギャラリー+タブのスケルトン |
| `facility/[slug]/not-found.tsx` | 施設詳細 | 「施設が見つかりません」（robots noindex） |
| `facility/[slug]/error.tsx` | 施設詳細 | 「ページを表示できません」+ リトライ |

### 8.3 トップページ構成（`/`）

| セクション | 内容 |
|-----------|------|
| Hero | 「採用も、集客も。CareLinkがつなぎます。」+ 施設/求職者CTA |
| Numbers | 0円 / 3分 / 5業種+ / 24h |
| こんな方におすすめ | 施設経営者 / 求職者の2カラムカード |
| CareLink の特長 | 業界特化 / 業界特化の掲載 / 完全無料 |
| ご利用の流れ | 3ステップ |
| 安心してご利用いただけます | SSL / 個人情報保護 / サポート |
| よくある質問 | 4問FAQ |
| CTA | 施設掲載 / 求職者登録ボタン |

### 8.4 検索ページ構成（`/search`）

| セクション | 内容 |
|-----------|------|
| SearchBar | キーワード / 業種セレクト / エリアセレクト / 検索ボタン |
| 結果ヘッダー | 「○件の施設が見つかりました」+ 並び替え（新着順/評価順） |
| カードグリッド | FacilityCard × 20件/ページ（2列レスポンシブ） |
| Pagination | ページネーション（省略記号付き、ARIA対応） |
| Empty State | 「条件に一致する施設が見つかりませんでした」 |

### 8.5 施設詳細ページ構成（`/facility/[slug]`）

| セクション | コンポーネント | 内容 |
|-----------|--------------|------|
| パンくず | `<nav>` | CareLink > 施設名 |
| 写真 | `PhotoGallery` | メイン画像+サムネイル行+カウンター |
| ヘッダー | `FacilityHeader` | 業種バッジ・評価・施設名・キャッチコピー |
| タブ | `TabNavigation` | Top / メニュー / 口コミ(件数) / アクセス |
| Topタブ | - | 紹介文・おすすめメニュー3件・特徴タグ・基本情報 |
| メニュータブ | `MenuList` | カテゴリ別メニュー一覧（価格・時間） |
| 口コミタブ | `ReviewTab` | 評価サマリー+棒グラフ+口コミ一覧+投稿フォーム |
| アクセスタブ | `AccessInfo` | 住所・営業時間・特徴・Google Map |
| お問い合わせ | `InquiryForm` | 名前・メール・電話・メッセージ |
| 固定バー | `StickyBookingBar` | 電話ボタン + お問い合わせボタン |

---

## 9. フォーム・バリデーション

### 9.1 バリデーションライブラリ

| ライブラリ | 用途 |
|-----------|------|
| **Zod** | スキーマ定義・バリデーションルール |
| **React Hook Form** | フォーム状態管理（`mode: 'onTouched'`） |
| **@hookform/resolvers** | Zod ↔ React Hook Form 連携 |

### 9.2 LP: 施設掲載フォーム（3ステップ）

**Step 1: 基本情報（全て必須）**

| フィールド | バリデーション |
|-----------|--------------|
| 施設名 | 1文字以上 |
| 業種 | セレクト必須（6業種+その他） |
| 代表者名 | 1文字以上 |
| 担当者名 | 1文字以上 |
| メールアドレス | Email形式 |
| 電話番号 | `0`始まり数字+ハイフン |

**Step 2: 詳細情報（全て任意）**: 郵便番号（7桁）/ 住所 / 営業時間 / 定休日 / 席数 / スタッフ数

**Step 3: PR情報（全て任意）**: PR文（500文字以内）/ 施設写真（10MB以下）/ 希望掲載開始日

### 9.3 LP: 求職者登録フォーム（3ステップ）

**Step 1**: 氏名(必須) / フリガナ(必須・カタカナ) / 生年月日 / 性別 / 電話(必須) / メール(必須) / 郵便番号 / 住所
**Step 2**: 職種(必須) / 保有資格(複数選択) / 経験年数 / 学歴 / 前職
**Step 3**: 希望雇用形態(複数選択) / 希望勤務地 / 希望年収 / 自己PR(1000文字以内)

### 9.4 LP: お問い合わせフォーム

名前(必須) / メール(必須) / 電話 / 問い合わせ種別(必須) / 内容(必須)

### 9.5 検索: 口コミ投稿フォーム（ReviewForm）

| フィールド | 必須 | バリデーション |
|-----------|:----:|--------------|
| ニックネーム | ✅ | 1文字以上、autocomplete="name" |
| 星評価 | ✅ | 1〜5（StarRatingコンポーネント、aria-labelledby） |
| コメント | - | 500文字以内 |

### 9.6 検索: 施設お問い合わせフォーム（InquiryForm）

| フィールド | 必須 | バリデーション | autocomplete |
|-----------|:----:|--------------|-------------|
| お名前 | ✅ | 1文字以上 | name |
| メールアドレス | ✅ | Email形式 | email |
| 電話番号 | - | 電話番号形式 | tel |
| お問い合わせ内容 | ✅ | 1〜1000文字 | - |

### 9.7 共通UX機能

| 機能 | 説明 | 対象 |
|------|------|------|
| 確認ダイアログ | フォーカストラップ・ESCで閉じる | 全フォーム |
| トースト通知 | role="alert"・4秒後自動消去 | 検索側フォーム |
| noValidate | ブラウザネイティブバリデーション無効化（Zod優先） | 検索側フォーム |
| htmlFor/id関連付け | ラベルとinputの明示的紐付け | 検索側フォーム |
| beforeunload警告 | 入力中のページ離脱警告 | LP側フォーム |
| 二重送信防止 | 送信中ボタン無効化+スピナー | 全フォーム |

---

## 10. API Route

### 10.1 POST /api/notify

Slack Incoming Webhook を使ったフォーム送信通知。

**エンドポイント**: `POST /api/notify`

**Zodバリデーション**: `z.discriminatedUnion('type', [...])` で5つのペイロードタイプを厳密に検証。

**対応タイプ**:

| type | 用途 | サイト |
|------|------|--------|
| `salon` | 施設掲載登録 | LP |
| `recruit` | 求人掲載登録 | LP |
| `job_seeker` | 求職者登録 | LP |
| `contact` | 一般お問い合わせ | LP |
| `facility_inquiry` | 施設宛お問い合わせ | 検索 |

**リクエスト例**:

```json
// 施設掲載（LP）
{
  "type": "salon",
  "data": {
    "facility_name": "リラクゼーションサロン ABC",
    "business_type": "美容サロン・アイラッシュ",
    "representative_name": "山田 太郎",
    "phone": "090-1234-5678",
    "email": "salon@example.com"
  }
}

// 施設お問い合わせ（検索）
{
  "type": "facility_inquiry",
  "data": {
    "facility_name": "HAL eyelash 堺店",
    "name": "佐藤 花子",
    "email": "hanako@example.com",
    "phone": "080-1234-5678",
    "message": "予約について質問があります。"
  }
}
```

**レスポンス**:

| ステータス | 条件 |
|-----------|------|
| `200` | 正常送信 |
| `400` | Zodバリデーション失敗 |
| `429` | レート制限超過（IPごとに5回/60秒） |
| `500` | SLACK_WEBHOOK_URL未設定 or その他エラー |

**セキュリティ対策**:
- Zodスキーマ検証（不正ペイロード拒否）
- Slackエスケープ: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`
- IPベースレート制限（in-memory Map）
- `force-dynamic`（サーバーサイド実行を強制）

---

## 11. コンポーネント設計

### 11.1 共通コンポーネント

| コンポーネント | ファイル | 特徴 |
|---------------|---------|------|
| `LayoutSwitch` | `LayoutSwitch.tsx` | usePathname()でLP/検索のHeader・Footer自動切替 |
| `ConfirmDialog` | `ConfirmDialog.tsx` | role="dialog", フォーカストラップ, ESCで閉じる, フォーカス復元 |
| `Toast` | `Toast.tsx` | role="alert", aria-live="assertive", 4秒自動消去, success/error/info |
| `Header` | `Header.tsx` | LP用スティッキーヘッダー（半透明backdrop-blur） |
| `Footer` | `Footer.tsx` | LP用3カラムフッター（運営会社情報付き） |
| `FadeIn` | `FadeIn.tsx` | IntersectionObserverベースのフェードイン |
| `FAQ` | `FAQ.tsx` | `<details>`アコーディオン |
| `StepIndicator` | `StepIndicator.tsx` | マルチステップフォーム進行表示 |
| `PhotoUpload` | `PhotoUpload.tsx` | 写真選択+プレビュー（10MB制限） |
| `Spinner` | `Spinner.tsx` | SVGスピナー |

### 11.2 検索コンポーネント（`components/search/`）

| コンポーネント | 説明 |
|---------------|------|
| `SearchHeader` | 検索サイト用スティッキーヘッダー。業種ナビ（デスクトップ）+ ハンバーガー（モバイル）。aria-expanded, aria-controls |
| `SearchFooter` | ダークフッター。業種リンク + Copyright |
| `SearchBar` | 検索フォーム。keyword(type="search") + 業種select + エリアselect。name属性・aria-label付き |
| `FacilityCard` | 施設カード。画像（グラデーションplaceholder）+ 業種バッジ + 星評価 + 所在地。line-clamp |
| `Pagination` | ページネーション。省略記号(...) + aria-current="page" + aria-label |

### 11.3 施設詳細コンポーネント（`components/facility/`）

| コンポーネント | 説明 |
|---------------|------|
| `PhotoGallery` | メイン画像+サムネイル行。写真カウンター("1/5")。エラーフォールバック。lazy loading |
| `FacilityHeader` | 業種バッジ + 星評価+件数 + 施設名 + キャッチコピー |
| `TabNavigation` | IntersectionObserverでsticky検出。role="tablist/tab/tabpanel"。aria-selected, aria-controls, id |
| `MenuList` | カテゴリ別グルーピング。価格/時間/おすすめバッジ。空状態対応 |
| `AccessInfo` | 基本情報テーブル + 営業時間テーブル(dayOrder) + 特徴タグ + Google Map(iframe) |
| `ReviewTab` | 評価サマリーカード(平均/件数/棒グラフ) + ReviewList + ReviewForm |
| `ReviewList` | 口コミカード一覧。アバター + 名前 + 日付(JST) + 星 + コメント |
| `ReviewForm` | Zod + react-hook-form。StarRating入力。ConfirmDialog + Toast。noValidate, htmlFor/id |
| `InquiryForm` | 名前/メール/電話/メッセージ。Supabase INSERT + Slack通知。autocomplete属性 |
| `StarRating` | 入力/表示兼用。readonly時: role="img" + aria-label。入力時: hover:scale-110 + aria-label="X点を選択" |
| `StickyBookingBar` | 固定下部バー。電話(tel:リンク) + お問い合わせ(#contact-sectionスクロール) |

### 11.4 ConfirmDialog 詳細

```
- role="dialog" / aria-modal="true" / aria-labelledby
- ESCキーで閉じる
- オーバーレイ背景クリックで閉じる（aria-hidden="true"）
- フォーカストラップ: Tab/Shift+Tab がダイアログ内で循環
- 開く時: 最初のボタンに自動フォーカス
- 閉じる時: 元のフォーカス位置に復元（previousFocusRef）
```

---

## 12. SEO・構造化データ

### 12.1 メタデータ

| ページ | title | description |
|--------|-------|-------------|
| `/` | CareLink &#124; 医療・福祉・美容の採用×集客プラットフォーム | 医療・福祉・美容に特化した採用×集客プラットフォーム |
| `/salon` | 【無料掲載】医療・福祉・美容の集客サイト | 掲載無料・登録3分で集客開始 |
| `/jobs` | 医療・福祉・美容の転職サイト | 完全無料で登録、業界特化の求人情報 |
| `/search` | 施設・サロンを探す | 施設検索ページ |
| `/facility/[slug]` | {施設名} - {業種} | {キャッチコピー} or {紹介文先頭160文字} |

### 12.2 構造化データ (JSON-LD)

| ページ | Schema.org Type | 内容 |
|--------|----------------|------|
| 全ページ（layout.tsx） | `WebSite` | サイト名・URL・説明・publisher |
| 全ページ（layout.tsx） | `LocalBusiness` | 事業者名・住所（大阪府堺市）・料金帯 |
| 全ページ（layout.tsx） | `FAQPage` | よくある質問4問 |
| `/salon`（layout.tsx） | `BreadcrumbList` | トップ → 施設・サロンの方 |
| `/jobs`（layout.tsx） | `BreadcrumbList` | トップ → 求職者の方 |
| `/facility/[slug]` | `LocalBusiness` | 施設名・住所・電話・評価・営業時間 |
| `/facility/[slug]` | `BreadcrumbList` | トップ → 施設名 |

### 12.3 Canonical URL

各ページに `alternates.canonical` を設定。施設詳細ページは `{BASE_URL}/facility/{slug}`。

### 12.4 OGP

| 項目 | 値 |
|------|-----|
| og:type | website |
| og:locale | ja_JP |
| og:site_name | CareLink |
| og:image | /og-image.png（LP）/ 施設メイン写真（施設詳細） |
| twitter:card | summary_large_image（施設詳細のみ） |

### 12.5 sitemap.xml（動的生成）

```typescript
// src/app/sitemap.ts
// 静的ページ + 全published施設を動的に生成
```

| URL | 頻度 | 優先度 |
|-----|------|:------:|
| `/` | weekly | 1.0 |
| `/search` | daily | 0.9 |
| `/salon`, `/jobs` | weekly | 0.9 |
| `/facility/{slug}` | weekly | 0.8（DB全件） |
| `/contact` | monthly | 0.5 |
| `/privacy`, `/terms` | monthly | 0.3 |

### 12.6 robots.txt

```
User-agent: *
Allow: /
Sitemap: https://carelink-ruddy-psi.vercel.app/sitemap.xml
```

---

## 13. セキュリティ

### 13.1 HTTPセキュリティヘッダー

`next.config.mjs` で全ページに設定:

| ヘッダー | 値 | 効果 |
|---------|-----|------|
| `X-Content-Type-Options` | `nosniff` | MIMEスニッフィング防止 |
| `X-Frame-Options` | `DENY` | iframe埋め込み禁止 |
| `X-XSS-Protection` | `1; mode=block` | XSSフィルター有効化 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | リファラー情報制限 |

### 13.2 データベースセキュリティ

- **RLS**: 全テーブルで適切なポリシー設定（6.5参照）
- **anon key**: RLSにより操作制限。検索側はSELECTのみ、LP側はINSERTのみ
- **サーバーサイドクエリ**: 検索・詳細の読み取りは `supabase-server.ts` 経由

### 13.3 APIセキュリティ

- **Zodスキーマ検証**: 不正ペイロードを400で拒否
- **レート制限**: IPごとに5リクエスト/60秒（in-memory Map）
- **入力エスケープ**: Slack通知の `&` `<` `>` をHTMLエンティティに変換
- **force-dynamic**: ビルド時実行を防止

### 13.4 フォームセキュリティ

- **Zodバリデーション**: クライアント側でスキーマ検証
- **noValidate**: ブラウザネイティブバリデーション無効化（Zod優先）
- **同意チェック**: 未同意時は送信ボタン無効化
- **二重送信防止**: 送信中ボタン無効化+スピナー
- **beforeunload**: 入力中のページ離脱警告（LP側）

---

## 14. アクセシビリティ

### 14.1 WAI-ARIA対応

| コンポーネント | ARIA属性 |
|---------------|---------|
| `TabNavigation` | role="tablist/tab/tabpanel", aria-selected, aria-controls, aria-labelledby, id, tabIndex |
| `ConfirmDialog` | role="dialog", aria-modal, aria-labelledby, aria-hidden(overlay) |
| `Toast` | role="alert", aria-live="assertive" |
| `SearchHeader` | aria-expanded, aria-controls (ハンバーガーメニュー) |
| `Pagination` | aria-label, aria-current="page" |
| `StarRating` | readonly: role="img" + aria-label / 入力: aria-label="X点を選択" |
| `SearchBar` | type="search", name属性, aria-label (select要素) |

### 14.2 キーボード操作

| 操作 | 動作 |
|------|------|
| Tab | フォーカス移動（ConfirmDialog内はトラップ） |
| Shift+Tab | 逆方向フォーカス移動 |
| Escape | ConfirmDialog/Toast を閉じる |
| Enter/Space | ボタン・リンクの実行 |

### 14.3 フォーカス管理

- ConfirmDialog: 開く時に最初のボタンに自動フォーカス、閉じる時に元の位置に復元
- フォーム: htmlFor/id でラベルとinputを明示的に紐付け
- StarRating: readonly時はtabIndex={-1}でフォーカス除外

---

## 15. アナリティクス

### 15.1 対応ツール

| ツール | 環境変数 | 用途 | 設定状態 |
|--------|---------|------|---------|
| Vercel Analytics | 自動 | Web Vitals | 有効 |
| Vercel Speed Insights | 自動 | ページ表示速度 | 有効 |
| Google Analytics 4 | `NEXT_PUBLIC_GA_ID` | PV・流入経路 | 未設定 |
| Microsoft Clarity | `NEXT_PUBLIC_CLARITY_ID` | ヒートマップ | 未設定 |

> 環境変数未設定時はコード変更不要で自動スキップ。

---

## 16. デザインシステム

### 16.1 カラーパレット

| 用途 | CSS変数 | 値 | Tailwind相当 |
|------|--------|-----|-------------|
| Primary | `--primary` | `#0EA5E9` | sky-500 |
| Primary Dark | `--primary-dark` | `#0284C7` | sky-600（ホバー） |
| Accent | `--accent` | `#F59E0B` | amber-500 |
| Background | `--background` | `#ffffff` | white |
| Foreground | `--foreground` | `#171717` | neutral-900 |

### 16.2 共通CSSクラス（`globals.css` `@layer components`）

| クラス | 説明 |
|--------|------|
| `.btn-primary` | メインボタン。Sky、ホバーでダーク、クリックで95%縮小、disabled時グレー |
| `.btn-accent` | アクセントボタン。Amber |
| `.btn-outline` | アウトラインボタン。Sky枠線+Sky文字 |
| `.section-container` | `max-w-6xl` `px-4 sm:px-6 lg:px-8` `py-16 sm:py-20` |
| `.section-title` | `text-2xl sm:text-3xl` 中央揃え `mb-12` |
| `.form-label` | `text-sm font-medium text-gray-700 mb-1` |
| `.form-input` | ボーダー、フォーカスリング（Sky）、リングオフセット |
| `.form-error` | `text-red-500 text-sm mt-1` |
| `.card` | 白背景、`rounded-2xl shadow-lg`、ホバーで`shadow-xl` |
| `.badge` | `text-xs font-bold px-2.5 py-1 rounded-full` |
| `.badge-primary` | `bg-sky-100 text-sky-700` |
| `.facility-card` | 施設カード。`rounded-2xl shadow-md`、ホバーで`shadow-xl` |
| `.tab-btn` | タブボタン。`text-gray-500 border-b-2 border-transparent` |
| `.tab-btn-active` | アクティブタブ。`color: var(--primary); border-color: var(--primary)` |
| `.sticky-bar` | 固定下部バー。`fixed bottom-0 shadow-[...]` |

### 16.3 ユーティリティ（`@layer utilities`）

| クラス | 説明 |
|--------|------|
| `.scrollbar-hide` | スクロールバー非表示（-webkit + Firefox対応） |

### 16.4 フォント

- **Noto Sans JP**: Google Fonts
- Weight: 400 / 500 / 700 / 900
- `display: "swap"`（FOUT対策）

### 16.5 レスポンシブブレークポイント

| ブレークポイント | 幅 | 主な変化 |
|-----------------|-----|---------|
| デフォルト | 〜639px | 1カラム、ハンバーガー |
| `sm` (640px) | 640px〜 | 2〜4カラムグリッド、デスクトップナビ |
| `lg` (1024px) | 1024px〜 | ヒーロー文字拡大 |

---

## 17. 法的対応

### 17.1 サービス形態

**情報掲載プラットフォーム**（広告型）として運営。仲介・マッチング・職業紹介は行わない（届出取得まで）。

### 17.2 「マッチング」表現の削除（2026-03-21）

コード全体から「AIマッチング」「マッチング機能」「仲介」等の表現を削除済み。代替: 「業界特化の掲載」「情報提供」。

### 17.3 法的ドキュメント

| ページ | 制定日 | 概要 |
|--------|--------|------|
| `/privacy` | 2026年3月19日 | 取得情報・利用目的・第三者提供・Cookie・開示請求 |
| `/terms` | 2026年3月19日 | サービス概要・利用条件・禁止事項・免責・準拠法（大阪地裁） |

---

## 18. 運用手順

### 18.1 日常運用

```
1. Slack通知が届く → Supabase Dashboardで詳細確認
2. 施設掲載: 2営業日以内に電話/メールで連絡
3. 求職者: 条件に合った求人があれば連絡
4. お問い合わせ: 2営業日以内にメールで返信
5. 口コミ管理: facility_reviews の status を published/hidden で制御
```

### 18.2 コード変更・デプロイ

```bash
# 1. ローカルで変更・動作確認
npm run dev

# 2. ビルドチェック
npm run build

# 3. コミット・プッシュ（自動デプロイ）
git add <変更ファイル>
git commit -m "変更内容"
git push origin main
# → Vercelが自動でビルド・デプロイ
```

### 18.3 施設データの追加・編集

施設データは Supabase Dashboard から直接操作:

```
1. facility_profiles にレコード追加（slug, name, business_type, prefecture, city 必須）
2. facility_menus にメニューデータ追加
3. facility_photos に写真URL追加
4. status を 'published' に設定 → 検索結果に表示される
```

### 18.4 外部サービス設定手順

#### Slack Incoming Webhook

1. https://api.slack.com/apps → Create New App → Incoming Webhooks → ON
2. Webhook URL をコピー → Vercel環境変数 `SLACK_WEBHOOK_URL` に設定
3. 再デプロイ（pushまたは `npx vercel --prod`）

#### Google Analytics 4

1. https://analytics.google.com/ でプロパティ作成 → 測定ID取得
2. Vercel環境変数 `NEXT_PUBLIC_GA_ID` に設定 → 再デプロイ

#### Microsoft Clarity

1. https://clarity.microsoft.com/ でプロジェクト作成 → ID取得
2. Vercel環境変数 `NEXT_PUBLIC_CLARITY_ID` に設定 → 再デプロイ

#### カスタムドメイン

1. `carelink.jp` 取得 → `vercel domains add carelink.jp`
2. DNS: CNAME → `cname.vercel-dns.com`
3. `NEXT_PUBLIC_BASE_URL=https://carelink.jp` に更新 → 再デプロイ

---

## 19. トラブルシューティング

### 19.1 よくある問題

| 症状 | 原因 | 対処 |
|------|------|------|
| フォーム送信で「送信に失敗しました」 | Supabase URL/Key 不正 | Vercel環境変数を確認 |
| フォーム送信で「送信に失敗しました」 | RLSポリシー未設定 | Supabase → Policies でINSERTポリシー確認 |
| Slack通知が来ない | `SLACK_WEBHOOK_URL` 未設定 | Vercel環境変数設定 → 再デプロイ |
| 検索結果が空 | facility_profiles にデータなし or status≠published | Supabase Dashboardでデータ・statusを確認 |
| 施設詳細が404 | slugが不一致 or status≠published | facility_profiles.slug を確認 |
| 口コミが表示されない | status≠published | facility_reviews.status を確認 |
| 星評価が0のまま | トリガー未作成 or reviews が全てhidden | トリガー存在確認・reviews statusを確認 |
| `npm run build` でエラー | TypeScript型エラー | エラーメッセージで該当ファイル修正 |
| 写真アップロード失敗 | Storageバケット/ポリシー未設定 | Supabase → Storage で確認 |
| OGP画像が表示されない | `/public/og-image.png` 未配置 | 1200×630pxの画像を配置 |
| レート制限エラー（429） | 60秒内に5回以上 | 60秒待って再試行 |

### 19.2 ビルド・品質チェック

```bash
npm run build      # ローカルビルド
npx tsc --noEmit   # 型チェックのみ
npm run lint        # ESLint
```

### 19.3 Supabase ダッシュボード

```
URL: https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe

テーブル:  Table Editor → 各テーブル
Storage:   Storage → carelink-uploads
RLS:       Authentication → Policies
SQL:       SQL Editor
ログ:      Logs → API / Postgres
```

---

## 20. テスト

現時点で自動テストは未実装。テスト導入時の優先順位:

1. **Zodスキーマのユニットテスト** — `validations.ts` の各スキーマ
2. **API Routeのテスト** — `/api/notify` のレート制限・Zod検証・エスケープ
3. **E2Eテスト** — フォーム送信→完了表示、検索→詳細遷移（Playwright推奨）

手動テスト: `npm run dev` → 各フォーム送信 → Supabase INSERT確認。

---

## 21. 既知の制限事項・今後の開発予定

### 21.1 現在の制限事項

| 制限 | 説明 |
|------|------|
| 管理画面なし | Supabase Dashboardでのみデータ管理 |
| 検索データがダミー | 実際の施設データへの移行が必要 |
| メール通知なし | Slackのみ |
| レート制限がin-memory | サーバーレス環境ではインスタンスごとにリセット |

### 21.2 今後の開発予定

| 優先度 | 機能 | 説明 |
|:------:|------|------|
| 高 | Slack Webhook設定 | フォーム送信通知の有効化 |
| 高 | カスタムドメイン | `carelink.jp` の取得・設定 |
| 高 | GA4 / Clarity設定 | アクセス解析の有効化 |
| 高 | 実データ移行 | ダミー施設データを実際の施設に置換 |
| 中 | 管理画面 | データ閲覧・CSV出力・ステータス管理 |
| 中 | 職業紹介事業届出 | 届出取得後にマッチング機能実装 |
| 低 | メール通知 | Resend等でメール通知追加 |
| 低 | 自動テスト | Vitest + Playwright |

---

## 型定義一覧（`src/types/index.ts`）

| 型名 | 用途 | サイト |
|------|------|--------|
| `Salon` | 施設掲載登録データ | LP |
| `JobSeeker` | 求職者登録データ | LP |
| `Contact` | お問い合わせデータ | LP |
| `Facility` | 施設公開プロフィール（全カラム） | 検索 |
| `FacilityCardData` | 検索結果カード用（軽量版） | 検索 |
| `FacilityMenu` | メニュー項目 | 検索 |
| `FacilityPhoto` | 写真データ | 検索 |
| `FacilityReview` | 口コミデータ | 検索 |
| `FacilityInquiry` | 施設宛お問い合わせ | 検索 |
| `SearchParams` | 検索クエリパラメータ | 検索 |

---

## DBクエリ関数一覧（`src/lib/facilities.ts`）

| 関数 | 引数 | 用途 |
|------|------|------|
| `searchFacilities(params)` | keyword, type, prefecture, page, sort | 施設検索（20件/ページ、ILIKE） |
| `getFacilityBySlug(slug)` | slug | 施設詳細取得 |
| `getFacilityMenus(facilityId)` | UUID | メニュー取得（sort_order順） |
| `getFacilityPhotos(facilityId)` | UUID | 写真取得（sort_order順） |
| `getFacilityReviews(facilityId)` | UUID | 口コミ取得（published, 新しい順） |

---

## 定数一覧（`src/lib/constants.ts`）

| エクスポート名 | 内容 |
|---------------|------|
| `prefectures` | 全47都道府県の配列 |
| `businessTypes` | 5業種の配列（「その他」なし） |
| `facilityFeatures` | 16個の施設特徴タグ |
| `dayOrder` | 曜日順序配列 `['mon','tue',...,'sun']` |
| `dayLabels` | 曜日ラベル `{mon:'月', tue:'火', ...}` |

---

## 変更履歴

| 日付 | バージョン | 内容 |
|------|-----------|------|
| 2026-03-22 | 2.0 | **大規模更新**: 検索サイト全機能追加（/search, /facility/[slug]）、検索側DB5テーブル+トリガー追加、全コンポーネント（16個）追加、LayoutSwitch追加、アクセシビリティ章追加、Zodバリデーション追加、動的sitemap、エラーバウンダリ、型定義一覧、DBクエリ関数一覧、定数一覧。GitHub移行(jimuin0)・自動デプロイ反映 |
| 2026-03-21 | 1.2 | アクセス情報追加、設定状況一覧追加、エラー/ローディング/404追加、テスト追加、制限事項追加 |
| 2026-03-21 | 1.1 | テーブルSQL追加、業務フロー追加、Slack通知例追加、Storage手順追加 |
| 2026-03-21 | 1.0 | 初版作成 |
