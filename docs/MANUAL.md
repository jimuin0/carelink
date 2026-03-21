# CareLink マニュアル v1.1

**最終更新**: 2026年3月21日
**バージョン**: 1.1
**作成者**: Claude + 神原 良祐
**プロジェクト**: ~/Projects/carelink/

> 医療・福祉・美容業界に特化した採用×集客プラットフォーム。施設・サロンの集客支援と求職者の転職支援を目的とした情報掲載サービス。掲載無料・登録3分で集客・採用を開始できる。

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
14. [アナリティクス](#14-アナリティクス)
15. [デザインシステム](#15-デザインシステム)
16. [法的対応](#16-法的対応)
17. [運用手順](#17-運用手順)
18. [トラブルシューティング](#18-トラブルシューティング)

---

## 1. システム概要

### 1.1 サービス概要

| 項目 | 値 |
|------|-----|
| サービス名 | CareLink |
| 運営 | 神原良祐（HALグループ） |
| 所在地 | 大阪府堺市 |
| 用途 | 施設集客 + 求職者転職支援（情報掲載型） |
| 料金 | 完全無料（施設掲載・求職者登録とも） |

### 1.2 対象業種

- 美容サロン・アイラッシュ
- 鍼灸院
- 整骨院
- 介護施設・デイサービス
- 病院・クリニック
- その他（医療・福祉・美容業界）

### 1.3 技術スタック

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

### 1.4 本番URL

| 画面 | URL | 備考 |
|------|-----|------|
| 本番（Vercel） | https://carelink-ruddy-psi.vercel.app | カスタムドメイン未設定 |
| 予定ドメイン | https://carelink.jp | 取得・設定後 |
| GitHub | eyelashsalon-halgroup/carelink | プライベート |
| Supabase Dashboard | https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe | テーブル・Storage管理 |

### 1.5 関連システム

| システム | パス | 関係 |
|---------|------|------|
| salon-absence-system | ~/Projects/salon-absence-system/ | HAL豊中本店の予約・欠勤・シフト管理 |
| cancel-fee | ~/Projects/cancel-fee/ | キャンセル料請求自動化 |

---

## 2. アーキテクチャ

```
ユーザー（ブラウザ）
    |
    | 施設登録 / 求職者登録 / お問い合わせ
    v
Vercel (Next.js App Router)
    |
    |-- src/app/page.tsx              … トップページ（LP）
    |-- src/app/salon/page.tsx        … 施設掲載登録（3ステップフォーム）
    |-- src/app/jobs/page.tsx         … 求職者登録（3ステップフォーム）
    |-- src/app/contact/page.tsx      … お問い合わせフォーム
    |-- src/app/api/notify/route.ts   … Slack通知 API Route
    |
    |  フォーム送信の処理フロー:
    |  ├─ 1. Zodバリデーション（クライアント側）
    |  ├─ 2. 確認ダイアログ表示
    |  ├─ 3. Supabase INSERT（クライアント側・anon key使用）
    |  ├─ 4. 写真アップロード（施設のみ・Supabase Storage）
    |  ├─ 5. POST /api/notify（サーバー側 → Slack通知）
    |  └─ 6. 完了画面表示
    v
Supabase (PostgreSQL + Storage)
    |-- salons テーブル          … 施設登録データ
    |-- job_seekers テーブル     … 求職者登録データ
    |-- contacts テーブル        … お問い合わせデータ
    |-- carelink-uploads バケット … 施設写真（Public read）

外部サービス:
    |-- Slack Incoming Webhook   … フォーム送信通知（管理者へ）
    |-- Google Analytics 4      … アクセス解析
    |-- Microsoft Clarity       … ヒートマップ・セッション録画
    |-- Vercel Analytics         … Web Vitals
```

### 重要な設計ポイント

- **管理画面なし**: 登録データの確認・管理はSupabase Dashboardで直接行う
- **クライアント側INSERT**: Supabase anon keyでクライアントから直接DBに書き込む（RLSでINSERTのみ許可）
- **通知は補助機能**: Slack通知失敗でもフォーム送信は成功扱い（DB保存が優先）
- **全ページStatic**: API Route以外は全てビルド時に静的生成

---

## 3. ディレクトリ構成

```
~/Projects/carelink/
├── docs/
│   └── MANUAL.md                 … このマニュアル
├── public/
│   ├── favicon.svg               … ファビコン
│   ├── apple-touch-icon.png      … Apple Touch Icon
│   └── og-image.png              … OGP画像（1200x630）
├── src/
│   ├── app/
│   │   ├── layout.tsx            … ルートレイアウト（メタデータ・構造化データ・GA4・Clarity）
│   │   ├── page.tsx              … トップページ（LP）
│   │   ├── loading.tsx           … スケルトンUI（ローディング）
│   │   ├── error.tsx             … エラーページ
│   │   ├── not-found.tsx         … 404ページ
│   │   ├── globals.css           … グローバルCSS（Tailwindコンポーネント定義）
│   │   ├── robots.ts             … robots.txt生成
│   │   ├── sitemap.ts            … sitemap.xml生成
│   │   ├── salon/
│   │   │   ├── layout.tsx        … メタデータ・パンくず構造化データ
│   │   │   └── page.tsx          … 施設掲載登録ページ（3ステップフォーム）
│   │   ├── jobs/
│   │   │   ├── layout.tsx        … メタデータ・パンくず構造化データ
│   │   │   └── page.tsx          … 求職者登録ページ（3ステップフォーム）
│   │   ├── contact/
│   │   │   ├── layout.tsx        … メタデータ
│   │   │   └── page.tsx          … お問い合わせページ
│   │   ├── privacy/
│   │   │   └── page.tsx          … プライバシーポリシー
│   │   ├── terms/
│   │   │   └── page.tsx          … 利用規約
│   │   └── api/
│   │       └── notify/
│   │           └── route.ts      … Slack通知 API Route（レート制限付き）
│   ├── components/
│   │   ├── Header.tsx            … ヘッダー（レスポンシブ・CTA付き）
│   │   ├── Footer.tsx            … フッター（運営会社情報付き）
│   │   ├── FadeIn.tsx            … スクロールフェードインアニメーション
│   │   ├── FAQ.tsx               … FAQアコーディオン
│   │   ├── StepIndicator.tsx     … フォームステップインジケーター
│   │   ├── PhotoUpload.tsx       … 写真アップロード（プレビュー・バリデーション付き）
│   │   ├── ConfirmDialog.tsx     … 確認ダイアログ（a11y対応）
│   │   ├── Spinner.tsx           … ローディングスピナー
│   │   └── Toast.tsx             … トースト通知
│   ├── lib/
│   │   ├── supabase.ts           … Supabaseクライアント初期化
│   │   └── validations.ts        … Zodスキーマ・バリデーション・選択肢定義
│   └── types/
│       └── index.ts              … 型定義
├── .env.example                  … 環境変数テンプレート
├── next.config.mjs               … Next.js設定（セキュリティヘッダー・画像最適化）
├── tailwind.config.ts            … Tailwind設定
├── tsconfig.json                 … TypeScript設定
├── postcss.config.mjs            … PostCSS設定
├── package.json                  … 依存関係
└── .eslintrc.json                … ESLint設定
```

---

## 4. 環境変数・セットアップ

### 4.1 環境変数一覧

| 変数 | 用途 | 必須 | スコープ | 設定場所 |
|------|------|:----:|---------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | ✅ | クライアント | Vercel + .env.local |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | ✅ | クライアント | Vercel + .env.local |
| `NEXT_PUBLIC_BASE_URL` | 本番URL（metadataBase・sitemap用） | - | クライアント | Vercel + .env.local |
| `NEXT_PUBLIC_GA_ID` | Google Analytics 4 測定ID | - | クライアント | Vercel のみ |
| `NEXT_PUBLIC_CLARITY_ID` | Microsoft Clarity プロジェクトID | - | クライアント | Vercel のみ |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL | - | サーバーのみ | Vercel + .env.local |

> **NEXT_PUBLIC_** プレフィックス付き: クライアントJSバンドルに含まれる（公開される）
> **プレフィックスなし** (`SLACK_WEBHOOK_URL`): サーバー側のAPI Route内でのみアクセス可能

### 4.2 ローカルセットアップ

```bash
# 1. リポジトリクローン
git clone https://github.com/eyelashsalon-halgroup/carelink.git
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

# 本番URL（省略時: https://carelink.jp）
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

```bash
# Vercel CLI で本番デプロイ
npx vercel --prod
```

> **注意**: GitHub連携での自動デプロイは組織権限の制約により未設定。手動CLI (`vercel --prod`) でデプロイ。
> `git push` しただけでは本番に反映されない。

### 5.2 Vercel設定

| 設定 | 値 |
|------|-----|
| プロジェクト名 | `carelink` |
| プロジェクトID | `prj_bckwxIcEfm4bcQ3k4dVdPmWez3aB` |
| 組織ID | `team_FxqzqrTMTrJeIfpVf2vYfqkX` |
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

> Vercel Dashboard → Settings → Environment Variables からも設定可能

### 5.4 カスタムドメイン設定（未実施）

```bash
# ドメイン取得後
vercel domains add carelink.jp
# DNS設定: CNAME → cname.vercel-dns.com

# 設定後、環境変数も更新
# NEXT_PUBLIC_BASE_URL=https://carelink.jp
```

### 5.5 デプロイ手順（完全版）

```bash
# 1. ローカルで動作確認
npm run dev

# 2. ビルドチェック（エラーがないことを確認）
npm run build

# 3. コミット・プッシュ
git add <変更ファイル>
git commit -m "変更内容"
git push origin main

# 4. 本番デプロイ
npx vercel --prod
# → Aliased URL が本番URL
```

---

## 6. DB設計（Supabase）

### 6.1 テーブル作成SQL（DDL）

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

-- RLS有効化 + INSERT許可
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

### 6.2 RLS（Row Level Security）

全テーブルで **INSERT のみ許可**（anon ロール）。SELECT / UPDATE / DELETE は anon からは不可。

| 操作 | anon ロール | service_role | Dashboard |
|------|:----------:|:-----------:|:---------:|
| INSERT | ✅ | ✅ | ✅ |
| SELECT | ❌ | ✅ | ✅ |
| UPDATE | ❌ | ✅ | ✅ |
| DELETE | ❌ | ✅ | ✅ |

> 登録データの閲覧・編集・削除は Supabase Dashboard の Table Editor から行う。

### 6.3 Storage（写真アップロード）

#### バケット作成手順

1. Supabase Dashboard → Storage → New Bucket
2. バケット名: `carelink-uploads`
3. Public bucket: **ON**（公開読み取り）
4. File size limit: 10MB
5. Allowed MIME types: `image/jpeg, image/png, image/webp, image/gif`

#### Storage ポリシー設定

```sql
-- 誰でもアップロード可能
CREATE POLICY "Allow public upload"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'carelink-uploads');

-- 誰でも閲覧可能
CREATE POLICY "Allow public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'carelink-uploads');
```

#### ファイルパス形式

```
carelink-uploads/salons/{uuid}/photo.{ext}
```

- `{uuid}`: `crypto.randomUUID()` で生成
- `{ext}`: アップロードファイルの拡張子（jpg, png, webp, gif）

#### 写真アップロードの制約

| 項目 | 値 |
|------|-----|
| 対応形式 | JPEG, PNG, WebP, GIF |
| 最大サイズ | 10MB |
| プレビュー | FileReaderでクライアント側プレビュー（data URL） |
| 削除 | プレビュー上の×ボタンで削除可能 |
| ドラッグ&ドロップ | 非対応（クリック選択のみ） |

### 6.4 登録データの確認方法

このシステムには管理画面がないため、登録データは以下の方法で確認する:

1. **Supabase Dashboard（推奨）**
   ```
   https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe
   → Table Editor → salons / job_seekers / contacts
   ```
   - フィルター・ソート・検索が可能
   - CSVエクスポート可能
   - 行のクリックで詳細表示・編集・削除

2. **Slack通知（リアルタイム）**
   - フォーム送信のたびにSlackチャンネルに通知
   - 通知内容は要約（全フィールドは含まない）
   - 詳細はSupabase Dashboardで確認

3. **Supabase SQL Editor（集計・分析）**
   ```sql
   -- 今日の施設登録数
   SELECT COUNT(*) FROM salons WHERE created_at::date = CURRENT_DATE;

   -- 全求職者一覧（新しい順）
   SELECT * FROM job_seekers ORDER BY created_at DESC;

   -- 業種別の登録数
   SELECT business_type, COUNT(*) FROM salons GROUP BY business_type;
   ```

---

## 7. 業務フロー（全体像）

### 7.1 施設掲載登録フロー

```
【顧客】/salon にアクセス
  │
  ├─ Step 1: 基本情報入力（施設名・業種・代表者・担当者・メール・電話）
  ├─ Step 2: 詳細情報入力（郵便番号・住所・営業時間・定休日・席数・スタッフ数）
  ├─ Step 3: PR情報入力（PR文・写真・希望開始日）
  │
  ├─ プライバシーポリシー・利用規約に同意
  ├─ 「登録する」ボタン → 確認ダイアログ
  │
  ├─ クライアント処理:
  │   ├─ 写真ファイル → Supabase Storage アップロード → photo_url取得
  │   ├─ フォームデータ + photo_url → Supabase salons テーブル INSERT
  │   └─ POST /api/notify → Slack通知（失敗しても無視）
  │
  └─ 完了画面表示: 「担当者より2営業日以内にご連絡いたします。」

【管理者】
  ├─ Slack通知で登録を認知（施設名・業種・代表者・電話・メール）
  ├─ Supabase Dashboard で詳細データを確認
  └─ 2営業日以内に電話またはメールで連絡
```

### 7.2 求職者登録フロー

```
【求職者】/jobs にアクセス
  │
  ├─ Step 1: 基本情報入力（氏名・フリガナ・生年月日・性別・電話・メール・住所）
  ├─ Step 2: 経歴入力（職種・資格・経験年数・学歴・前職）
  ├─ Step 3: 希望条件入力（雇用形態・勤務地・年収・自己PR）
  │
  ├─ プライバシーポリシー・利用規約に同意
  ├─ 「登録する」ボタン → 確認ダイアログ
  │
  ├─ クライアント処理:
  │   ├─ フォームデータ → Supabase job_seekers テーブル INSERT
  │   └─ POST /api/notify → Slack通知
  │
  └─ 完了画面表示

【管理者】
  ├─ Slack通知で登録を認知（氏名・職種・電話・メール）
  └─ Supabase Dashboard で詳細データを確認・対応
```

### 7.3 お問い合わせフロー

```
【ユーザー】/contact にアクセス
  │
  ├─ 入力（名前・メール・電話・種別・内容）
  ├─ プライバシーポリシーに同意
  ├─ 「送信する」ボタン → 確認ダイアログ
  │
  ├─ クライアント処理:
  │   ├─ Supabase contacts テーブル INSERT
  │   └─ POST /api/notify → Slack通知
  │
  └─ 完了画面: 「2営業日以内にご返信いたします。」

【管理者】
  ├─ Slack通知で問い合わせを認知（名前・種別・メール・内容）
  └─ 2営業日以内にメールで返信
```

### 7.4 Slack通知メッセージ例

**施設掲載の新規登録:**
```
:office: *施設掲載の新規登録*
> *施設名:* リラクゼーションサロン ABC
> *業種:* 美容サロン・アイラッシュ
> *代表者:* 山田 太郎
> *電話:* 090-1234-5678
> *メール:* salon@example.com
```

**求職者の新規登録:**
```
:bust_in_silhouette: *求職者の新規登録*
> *氏名:* 佐藤 花子
> *職種:* アイリスト・美容師
> *電話:* 080-9876-5432
> *メール:* hanako@example.com
```

**お問い合わせ:**
```
:envelope: *お問い合わせ*
> *お名前:* 田中 一郎
> *種別:* 掲載について
> *メール:* tanaka@example.com
> *内容:* 掲載の詳細について質問があります。
```

---

## 8. ページ構成

### 8.1 ページ一覧

| パス | ファイル | レンダリング | 説明 |
|------|---------|:----------:|------|
| `/` | `page.tsx` | Static | トップページ（LP） |
| `/salon` | `salon/page.tsx` | Static | 施設掲載登録 |
| `/jobs` | `jobs/page.tsx` | Static | 求職者登録 |
| `/contact` | `contact/page.tsx` | Static | お問い合わせ |
| `/privacy` | `privacy/page.tsx` | Static | プライバシーポリシー |
| `/terms` | `terms/page.tsx` | Static | 利用規約 |
| `/api/notify` | `api/notify/route.ts` | Dynamic | Slack通知API（POST） |
| `/sitemap.xml` | `sitemap.ts` | Static | サイトマップ |
| `/robots.txt` | `robots.ts` | Static | robots.txt |

> Static = ビルド時に静的HTML生成（CDN配信）。Dynamic = リクエストごとにサーバー実行。

### 8.2 トップページ構成（`/`）

| セクション | 内容 |
|-----------|------|
| Hero | キャッチコピー「採用も、集客も。CareLinkがつなぎます。」+ 施設/求職者CTAボタン |
| Numbers | 0円 / 3分 / 5業種+ / 24h |
| こんな方におすすめ | 施設経営者 / 求職者の2カラムカード |
| CareLink の特長 | 業界特化 / 業界特化の掲載 / 完全無料 |
| ご利用の流れ | 無料登録 → 掲載・公開 → スタート（3ステップ） |
| 安心してご利用いただけます | SSL暗号化 / 個人情報保護 / サポート体制 |
| よくある質問 | 4問のFAQ（アコーディオン） |
| CTA | 施設掲載 / 求職者登録ボタン（Skyメインカラー背景） |

### 8.3 施設掲載ページ構成（`/salon`）

| セクション | 内容 |
|-----------|------|
| Hero | 「あなたの施設を、必要な人に届ける」+ CTAボタン（フォームへスクロール） |
| CareLink が選ばれる理由 | 完全無料 / 業界特化 / 業界特化の掲載（3カード） |
| CareLink でできること | プロフィール掲載 / 求人情報掲載 / 専任サポート |
| ご利用の流れ | 4ステップ（フォーム入力→担当者連絡→掲載開始→集客・採用） |
| 無料掲載登録フォーム | 3ステップフォーム（基本→詳細→PR） |
| よくある質問 | 5問のFAQ |

### 8.4 求職者ページ構成（`/jobs`）

| セクション | 内容 |
|-----------|------|
| Hero | 「あなたのスキルを、正しく評価してくれる職場へ」+ CTAボタン |
| CareLink が選ばれる理由 | 完全無料 / 業界特化 / 非公開求人掲載 |
| ご利用の流れ | 3ステップ（登録→求人を探す→応募） |
| 求職者登録フォーム | 3ステップフォーム（基本→経歴→希望条件） |
| よくある質問 | 5問のFAQ |

---

## 9. フォーム・バリデーション

### 9.1 バリデーションライブラリ

| ライブラリ | 用途 |
|-----------|------|
| **Zod** | スキーマ定義・バリデーションルール |
| **React Hook Form** | フォーム状態管理（`mode: 'onTouched'` = 入力離脱時にバリデーション） |
| **@hookform/resolvers** | Zod ↔ React Hook Form 連携 |

### 9.2 施設掲載フォーム（3ステップ）

**Step 1: 基本情報（全て必須）**

| フィールド | バリデーション | エラーメッセージ |
|-----------|--------------|----------------|
| 施設名 | 1文字以上 | 「施設名を入力してください」 |
| 業種 | セレクト必須 | 「業種を選択してください」 |
| 代表者名 | 1文字以上 | 「代表者名を入力してください」 |
| 担当者名 | 1文字以上 | 「担当者名を入力してください」 |
| メールアドレス | Email形式 | 「正しいメールアドレスを入力してください」 |
| 電話番号 | `0`始まり数字+ハイフン | 「正しい電話番号を入力してください」 |

**Step 2: 詳細情報（全て任意）**

| フィールド | バリデーション | 備考 |
|-----------|--------------|------|
| 郵便番号 | 7桁数字 or 3-4形式 | ハイフンなし可 |
| 住所 | - | - |
| 営業時間 | - | 例: 10:00〜20:00 |
| 定休日 | - | 例: 毎週月曜日 |
| 席数 | 整数 ≥ 0 | - |
| スタッフ数 | 整数 ≥ 0 | - |

**Step 3: PR情報（全て任意）**

| フィールド | バリデーション | 備考 |
|-----------|--------------|------|
| PR文 | 500文字以内 | 文字数カウンター付き |
| 施設写真 | JPEG/PNG/WebP/GIF, 10MB以下 | プレビュー表示 |
| 希望掲載開始日 | date形式 | - |

**業種の選択肢** (`validations.ts`):
- 美容サロン・アイラッシュ
- 鍼灸院
- 整骨院
- 介護施設・デイサービス
- 病院・クリニック
- その他

### 9.3 求職者登録フォーム（3ステップ）

**Step 1: 基本情報**

| フィールド | 必須 | バリデーション |
|-----------|:----:|--------------|
| 氏名 | ✅ | 1文字以上 |
| フリガナ | ✅ | 全角カタカナ（スペース許可） |
| 生年月日 | - | date形式 |
| 性別 | - | 男性/女性/その他/回答しない |
| 電話番号 | ✅ | 電話番号形式 |
| メールアドレス | ✅ | Email形式 |
| 郵便番号 | - | 7桁数字 |
| 住所 | - | - |

**Step 2: 経歴**

| フィールド | 必須 | バリデーション |
|-----------|:----:|--------------|
| 職種 | ✅ | セレクト必須 |
| 保有資格 | - | チェックボックス複数選択 |
| 経験年数 | - | セレクト |
| 学歴 | - | - |
| 前職 | - | - |

**職種の選択肢**: 介護士・ヘルパー / 鍼灸師・柔道整復師 / アイリスト・美容師 / 看護師・准看護師 / その他

**資格の選択肢**: 介護福祉士 / ヘルパー2級 / はり師 / きゅう師 / 柔道整復師 / 看護師 / 准看護師 / アイリスト検定 / その他

**Step 3: 希望条件**

| フィールド | 必須 | バリデーション |
|-----------|:----:|--------------|
| 希望雇用形態 | - | チェックボックス複数選択 |
| 希望勤務地 | - | - |
| 希望年収 | - | - |
| 自己PR | - | 1000文字以内 |

### 9.4 お問い合わせフォーム

| フィールド | 必須 | バリデーション | エラーメッセージ |
|-----------|:----:|--------------|----------------|
| お名前 | ✅ | 1文字以上 | 「お名前を入力してください」 |
| メールアドレス | ✅ | Email形式 | 「正しいメールアドレスを入力してください」 |
| 電話番号 | - | 電話番号形式 | 「正しい電話番号を入力してください」 |
| 問い合わせ種別 | ✅ | セレクト必須 | 「お問い合わせ種別を選択してください」 |
| 内容 | ✅ | 1文字以上 | 「内容を入力してください」 |

**問い合わせ種別**: 掲載について / 求職について / その他

### 9.5 共通UX機能

| 機能 | 説明 | 対象フォーム |
|------|------|------------|
| ステップインジケーター | 現在のステップを色分け表示 | salon, jobs |
| 確認ダイアログ | 「送信します。よろしいですか？」 | 全フォーム |
| beforeunload警告 | 入力中にページ離脱で「変更が失われます」警告 | salon, jobs |
| プライバシーポリシー同意 | チェックしないと送信ボタンが無効化（グレー） | 全フォーム |
| 送信完了画面 | フォームが消えて完了メッセージ表示 | 全フォーム |
| 電話番号自動ハイフン | `09012345678` → `090-1234-5678` | salon |
| エラー表示 | フィールド直下に赤字でエラーメッセージ | 全フォーム |
| 送信中スピナー | ボタンにスピナー + 「送信中...」表示、二重送信防止 | 全フォーム |

---

## 10. API Route

### 10.1 POST /api/notify

Slack Incoming Webhook を使ったフォーム送信通知。

**エンドポイント**: `POST /api/notify`

**リクエスト形式**:

```json
// 施設掲載
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

// 求職者
{
  "type": "job_seeker",
  "data": {
    "full_name": "佐藤 花子",
    "job_type": "アイリスト・美容師",
    "phone": "080-9876-5432",
    "email": "hanako@example.com"
  }
}

// お問い合わせ
{
  "type": "contact",
  "data": {
    "name": "田中 一郎",
    "inquiry_type": "掲載について",
    "email": "tanaka@example.com",
    "message": "掲載の詳細について質問があります。"
  }
}
```

**レスポンス**:

| ステータス | ボディ | 条件 |
|-----------|--------|------|
| `200` | `{"ok": true}` | 正常送信 |
| `429` | `{"ok": false, "error": "Too many requests"}` | レート制限超過 |
| `500` | `{"ok": false, "error": "SLACK_WEBHOOK_URL not set"}` | 環境変数未設定 |
| `500` | `{"ok": false}` | その他エラー |

**レート制限**: IPアドレスごとに 5リクエスト / 60秒（in-memory Map）

**セキュリティ対策**:
- ユーザー入力のSlackエスケープ: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`
- `export const dynamic = 'force-dynamic'`（サーバーサイド実行を強制、ビルド時実行を防止）

**クライアント側の呼び出しパターン**:

```typescript
// DB保存成功後に呼び出し（通知失敗は無視）
fetch('/api/notify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  signal: AbortSignal.timeout(10000),  // 10秒タイムアウト
  body: JSON.stringify({ type: 'salon', data: { ... } }),
}).catch(() => {});  // ← 失敗しても何もしない
```

> **重要**: 通知は補助機能。DB保存（Supabase INSERT）が成功すればフォーム送信は成功扱い。通知失敗でもユーザーにエラーは表示しない。

---

## 11. コンポーネント設計

### 11.1 共通コンポーネント一覧

| コンポーネント | ファイル | Props | 説明 |
|---------------|---------|-------|------|
| `Header` | `Header.tsx` | なし | スティッキーヘッダー、デスクトップ+モバイルナビ |
| `Footer` | `Footer.tsx` | なし | 3カラム（ブランド/サービス/その他）+ 運営会社 |
| `FadeIn` | `FadeIn.tsx` | `delay?: number` | IntersectionObserver ベースのフェードイン |
| `FAQ` | `FAQ.tsx` | `items: {question, answer}[]` | `<details>` アコーディオン |
| `StepIndicator` | `StepIndicator.tsx` | `currentStep, totalSteps, labels` | ステップ進行表示 |
| `PhotoUpload` | `PhotoUpload.tsx` | `onChange, error?` | 写真選択+プレビュー |
| `ConfirmDialog` | `ConfirmDialog.tsx` | `open, title, message, onConfirm, onCancel` | 確認モーダル |
| `Spinner` | `Spinner.tsx` | なし | SVGスピナー |
| `Toast` | `Toast.tsx` | `message, type, onClose` | 通知トースト |

### 11.2 Header

- **スティッキー**: `sticky top-0 z-50` + 半透明 (`bg-white/95 backdrop-blur`)
- **デスクトップ（640px〜）**: ナビリンク（施設の方 / 求職者の方 / お問い合わせ）+ CTA「無料で掲載する」ボタン
- **モバイル**: ハンバーガーメニュー（44×44px タッチターゲット）、アニメーション付きスライドダウン
- メニュークリックで自動閉じる

### 11.3 ConfirmDialog

- `role="dialog"` / `aria-modal="true"` / `aria-labelledby="confirm-dialog-title"`
- **ESCキー**で閉じる（`useEffect` + `useCallback` + `keydown` イベント）
- **オーバーレイ背景クリック**で閉じる
- 確認ボタン + キャンセルボタン

### 11.4 PhotoUpload

- **対応形式**: JPEG, PNG, WebP, GIF（`ACCEPTED_TYPES` 配列で定義）
- **最大サイズ**: 10MB（`MAX_SIZE` 定数）
- **プレビュー**: FileReader → data URL → next/image（`unoptimized` でdata URL直接表示）
- **削除**: ×ボタンでプレビュー消去 + input value リセット
- **エラー**: 形式不正 / サイズ超過時にフィールド下にエラー表示

---

## 12. SEO・構造化データ

### 12.1 メタデータ

| ページ | title | description |
|--------|-------|-------------|
| `/` | CareLink &#124; 医療・福祉・美容の採用×集客プラットフォーム | 医療・福祉・美容に特化した採用×集客プラットフォーム。サロン・施設の集客と求職者の転職をサポート |
| `/salon` | 【無料掲載】医療・福祉・美容の集客サイト | 美容サロン・鍼灸院・整骨院・介護施設の集客に。掲載無料・登録3分で集客開始。業界特化で効率的にお客様を獲得 |
| `/jobs` | 医療・福祉・美容の転職サイト | 介護士・鍼灸師・アイリスト・看護師の転職に特化。完全無料で登録、業界特化の求人情報をチェック |
| `/contact` | お問い合わせ | ご質問やご不明点がございましたら、お気軽にお問い合わせください |
| `/privacy` | プライバシーポリシー | - |
| `/terms` | 利用規約 | - |

### 12.2 構造化データ (JSON-LD)

| ページ | Schema.org Type | 内容 |
|--------|----------------|------|
| 全ページ（layout.tsx） | `WebSite` | サイト名・URL・説明・publisher |
| 全ページ（layout.tsx） | `LocalBusiness` | 事業者名・住所（大阪府堺市）・料金帯（無料） |
| 全ページ（layout.tsx） | `FAQPage` | よくある質問4問（無料？/業種？/いつから？/退会？） |
| `/salon`（layout.tsx） | `BreadcrumbList` | トップ → 施設・サロンの方 |
| `/jobs`（layout.tsx） | `BreadcrumbList` | トップ → 求職者の方 |

### 12.3 Canonical URL

各ページに `alternates.canonical` を設定（重複コンテンツ防止）:
- `/` → `/`
- `/salon` → `/salon`
- `/jobs` → `/jobs`
- `/contact` → `/contact`

### 12.4 OGP（Open Graph Protocol）

| 項目 | 値 |
|------|-----|
| og:type | website |
| og:locale | ja_JP |
| og:site_name | CareLink |
| og:image | /og-image.png（1200×630px） |

各ページに個別の `og:title` / `og:description` を設定。

### 12.5 sitemap.xml

| URL | 更新頻度 | 優先度 | lastModified |
|-----|---------|:------:|:----------:|
| `/` | weekly | 1.0 | 2026-03-21 |
| `/salon` | weekly | 0.9 | 2026-03-21 |
| `/jobs` | weekly | 0.9 | 2026-03-21 |
| `/contact` | monthly | 0.5 | 2026-03-21 |
| `/privacy` | monthly | 0.3 | 2026-03-19 |
| `/terms` | monthly | 0.3 | 2026-03-19 |

### 12.6 robots.txt

```
User-agent: *
Allow: /
Sitemap: https://carelink.jp/sitemap.xml
```

---

## 13. セキュリティ

### 13.1 HTTPセキュリティヘッダー

`next.config.mjs` で全ページ (`/(.*)`) に設定:

| ヘッダー | 値 | 効果 |
|---------|-----|------|
| `X-Content-Type-Options` | `nosniff` | MIMEスニッフィング防止 |
| `X-Frame-Options` | `DENY` | iframeへの埋め込み禁止（クリックジャッキング防止） |
| `X-XSS-Protection` | `1; mode=block` | ブラウザXSSフィルター有効化 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 外部サイトへのリファラー情報を制限 |

### 13.2 データベースセキュリティ

| 対策 | 説明 |
|------|------|
| RLS | 全テーブルでINSERTのみ許可。SELECT/UPDATE/DELETEはanon不可 |
| anon key | クライアントに公開されるが、RLSにより書き込みのみ可能 |
| Storage | Public readだがアップロード先パスにUUIDを使用 |

### 13.3 APIセキュリティ

| 対策 | 説明 |
|------|------|
| レート制限 | IPごとに5リクエスト/60秒（in-memory Map） |
| 入力エスケープ | Slack通知の `&` `<` `>` をHTMLエンティティに変換 |
| タイムアウト | クライアント→API: 10秒（AbortSignal.timeout） |
| force-dynamic | API Routeをビルド時ではなくリクエスト時に実行 |

### 13.4 フォームセキュリティ

| 対策 | 説明 |
|------|------|
| Zodバリデーション | クライアント側でスキーマ検証 |
| beforeunload | 入力中のページ離脱を警告 |
| 同意チェック | 未同意時は送信ボタンを無効化（`disabled`） |
| 二重送信防止 | 送信中はボタンを無効化 + スピナー表示 |

### 13.5 画像最適化

- `next.config.mjs` の `images.formats`: WebP + AVIF 自動変換
- PhotoUpload のプレビュー: `unoptimized` 使用（data URLはNext.js画像最適化対象外）

---

## 14. アナリティクス

### 14.1 対応ツール

| ツール | 環境変数 | 用途 | 設定状態 |
|--------|---------|------|---------|
| Vercel Analytics | 自動 | Web Vitals（LCP, FID, CLS） | 有効 |
| Vercel Speed Insights | 自動 | ページ表示速度 | 有効 |
| Google Analytics 4 | `NEXT_PUBLIC_GA_ID` | PV・ユーザー数・流入経路 | 未設定 |
| Microsoft Clarity | `NEXT_PUBLIC_CLARITY_ID` | ヒートマップ・セッション録画 | 未設定 |

### 14.2 読み込み方式

| ツール | 読み込み方式 | 未設定時の動作 |
|--------|------------|--------------|
| GA4 | `next/script` `afterInteractive` | `<Script>`タグ自体が出力されない |
| Clarity | `next/script` `afterInteractive` | 同上 |
| Vercel Analytics | `<Analytics />` Reactコンポーネント | Vercelデプロイ以外では無効 |
| Speed Insights | `<SpeedInsights />` Reactコンポーネント | 同上 |

> 環境変数未設定時はコード変更不要で自動スキップ。

---

## 15. デザインシステム

### 15.1 カラーパレット

| 用途 | CSS変数 | 値 | Tailwind相当 |
|------|--------|-----|-------------|
| Primary | `--primary` | `#0EA5E9` | Sky-500 |
| Primary Dark | `--primary-dark` | `#0284C7` | Sky-600（ホバー） |
| Accent | `--accent` | `#F59E0B` | Amber-500 |
| Background | `--background` | `#ffffff` | White |
| Foreground | `--foreground` | `#171717` | Neutral-900 |

### 15.2 共通CSSクラス（`globals.css` `@layer components`）

| クラス | 説明 |
|--------|------|
| `.btn-primary` | メインボタン。Skyカラー、ホバーでダーク、クリックで95%縮小、disabled時グレー化+cursor禁止 |
| `.btn-accent` | アクセントボタン。Amberカラー |
| `.btn-outline` | アウトラインボタン。Sky枠線+Sky文字 |
| `.section-container` | セクション共通コンテナ。`max-w-6xl` `px-4 sm:px-6 lg:px-8` `py-16 sm:py-20` |
| `.section-title` | セクション見出し。`text-2xl sm:text-3xl` 中央揃え `mb-12` |
| `.form-label` | フォームラベル。`text-sm font-medium text-gray-700` |
| `.form-input` | フォーム入力。ボーダー、フォーカスリング（Skyカラー）、リングオフセット |
| `.form-error` | バリデーションエラー。`text-red-500 text-sm` |
| `.card` | カード。白背景、`rounded-2xl` `shadow-lg`、ホバーで`shadow-xl` |

### 15.3 フォント

- **Noto Sans JP**: Google Fonts
- Weight: 400（本文）/ 500（見出し補助）/ 700（見出し）/ 900（メインキャッチ）
- `display: "swap"`（FOUT対策）

### 15.4 レスポンシブブレークポイント

| ブレークポイント | 幅 | 主な変化 |
|-----------------|-----|---------|
| デフォルト（モバイル） | 〜639px | 1カラム、ハンバーガーメニュー |
| `sm` | 640px〜 | 2〜4カラムグリッド、デスクトップナビ |
| `lg` | 1024px〜 | ヒーロー文字サイズ拡大 |

---

## 16. 法的対応

### 16.1 現在のサービス形態

**情報掲載プラットフォーム**（広告型）として運営。

- 施設情報の掲載（広告）
- 求人情報の掲載（広告）
- 求職者の登録（情報収集）

> **仲介・マッチング・職業紹介は行わない**（届出取得まで）

### 16.2 職業安定法への対応

| サービス形態 | 許可/届出 | 現在の対応 |
|-------------|---------|-----------|
| 求人広告の掲載 | 不要 | ✅ 現在の形態 |
| 無料職業紹介事業 | 厚労大臣への届出が必要 | 未取得（将来予定） |
| 有料職業紹介事業 | 厚労大臣の許可が必要 | 未取得 |

> 職業紹介事業 = 求職者と求人者の間に立ち、雇用関係の成立を仲介する事業（職業安定法 第4条）
> 届出取得前に「マッチング」「仲介」表現を使うと、無届での職業紹介事業と見なされるリスクあり

### 16.3 「マッチング」表現の削除（2026-03-21）

コード全体から以下の表現を削除済み:
- 「AIマッチング」「AI自動マッチング」
- 「マッチング機能」「マッチング」
- 「仲介」

**代替表現**:
- 「業界特化の掲載」
- 「求人情報の掲載」
- 「情報提供」

**対象ファイル**: `page.tsx`, `salon/page.tsx`, `salon/layout.tsx`, `jobs/page.tsx`, `jobs/layout.tsx`, `terms/page.tsx`, `privacy/page.tsx`

**grepで確認済み**: ソースコード内に「マッチング」は0件

### 16.4 法的ドキュメント

| ページ | 制定日 | 概要 |
|--------|--------|------|
| `/privacy` | 2026年3月19日 | 取得情報・利用目的・第三者提供・Cookie/分析ツール・開示請求 |
| `/terms` | 2026年3月19日 | サービス概要・利用条件・禁止事項・免責・準拠法（大阪地裁） |

---

## 17. 運用手順

### 17.1 日常運用（フォーム送信対応）

```
1. Slackチャンネルに通知が届く
   → 施設掲載 / 求職者登録 / お問い合わせ のいずれか

2. Supabase Dashboard で詳細確認
   → https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe
   → Table Editor → 該当テーブル

3. 対応
   → 施設掲載: 2営業日以内に電話またはメールで連絡
   → 求職者: 条件に合った求人があれば連絡
   → お問い合わせ: 2営業日以内にメールで返信
```

### 17.2 コード変更・デプロイ

```bash
# 1. ローカルで変更・動作確認
npm run dev

# 2. ビルドチェック（TypeScriptエラー・ESLintエラーがないこと）
npm run build

# 3. コミット・プッシュ
git add <変更ファイル>
git commit -m "変更内容"
git push origin main

# 4. 本番デプロイ（これを忘れると本番に反映されない）
npx vercel --prod
```

### 17.3 Slack Incoming Webhook 設定手順

1. https://api.slack.com/apps にアクセス
2. 「Create New App」→ 「From scratch」
3. アプリ名（例: CareLink通知）+ ワークスペース選択
4. 左メニュー「Incoming Webhooks」→ 「Activate Incoming Webhooks」をON
5. 「Add New Webhook to Workspace」→ 通知先チャンネル選択 → 「許可する」
6. Webhook URL をコピー（`https://hooks.slack.com/services/REDACTED.../B.../xxx`）
7. Vercel環境変数に設定:
   ```bash
   vercel env add SLACK_WEBHOOK_URL
   # → Webhook URLを貼り付け
   ```
8. 再デプロイ: `npx vercel --prod`

### 17.4 Google Analytics 4 設定手順

1. https://analytics.google.com/ でプロパティ作成
2. データストリーム追加（Web）→ サイトURL入力
3. 測定ID（`G-XXXXXXXXXX`）をコピー
4. Vercel環境変数に設定:
   ```bash
   vercel env add NEXT_PUBLIC_GA_ID
   # → G-XXXXXXXXXX を入力
   ```
5. 再デプロイ: `npx vercel --prod`

### 17.5 Microsoft Clarity 設定手順

1. https://clarity.microsoft.com/ でプロジェクト作成
2. プロジェクトID（英数字列）をコピー
3. Vercel環境変数に設定:
   ```bash
   vercel env add NEXT_PUBLIC_CLARITY_ID
   # → プロジェクトIDを入力
   ```
4. 再デプロイ: `npx vercel --prod`

### 17.6 カスタムドメイン設定手順

1. ドメインレジストラで `carelink.jp` を取得
2. Vercelでドメイン追加:
   ```bash
   vercel domains add carelink.jp
   ```
3. DNSレコード設定（レジストラ側）:
   - タイプ: `CNAME`
   - ホスト: `@` または空
   - 値: `cname.vercel-dns.com`
4. Vercel環境変数を更新:
   ```bash
   vercel env add NEXT_PUBLIC_BASE_URL
   # → https://carelink.jp
   ```
5. 再デプロイ: `npx vercel --prod`
6. SSL証明書は Vercel が自動発行（Let's Encrypt）

### 17.7 データエクスポート

Supabase Dashboard からCSVエクスポート:

1. Table Editor → 対象テーブル選択
2. 右上「Export」→ 「Download as CSV」
3. 全データまたはフィルター適用後のデータをダウンロード

---

## 18. トラブルシューティング

### 18.1 よくある問題

| 症状 | 原因 | 対処 |
|------|------|------|
| フォーム送信で「送信に失敗しました」 | Supabase URL/Key 不正 | Vercel環境変数 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` を確認 |
| フォーム送信で「送信に失敗しました」 | RLSポリシー未設定 | Supabase Dashboard → Authentication → Policies で INSERT ポリシーを確認 |
| Slack通知が来ない | `SLACK_WEBHOOK_URL` 未設定 | Vercel環境変数を設定 → 再デプロイ |
| Slack通知が来ない | Webhook URLが無効 | Slack API Dashboard でWebhookがアクティブか確認 |
| `npm run build` でエラー | TypeScript型エラー | エラーメッセージを確認して該当ファイルを修正 |
| `npm run build` でエラー | 環境変数未設定 | `.env.local` に `NEXT_PUBLIC_SUPABASE_URL` 等を設定 |
| 写真アップロード失敗 | Storageバケット未作成 | Supabase Dashboard → Storage → `carelink-uploads` バケットを作成 |
| 写真アップロード失敗 | Storageポリシー未設定 | INSERT + SELECT ポリシーを設定（6.3参照） |
| OGP画像が表示されない | `/public/og-image.png` 未配置 | 1200×630pxの画像を配置 |
| GA4が計測されない | `NEXT_PUBLIC_GA_ID` 未設定 | 環境変数設定 → 再デプロイ |
| 404ページ表示 | URLパス間違い | ページファイルが `src/app/パス/page.tsx` に存在するか確認 |
| レート制限エラー（429） | 60秒内に5回以上API呼び出し | 60秒待って再試行。in-memoryなのでデプロイで解消 |
| `vercel --prod` で失敗 | Vercel CLI未ログイン | `vercel login` を実行 |
| `vercel --prod` で失敗 | プロジェクト未リンク | `vercel link` を実行 |

### 18.2 ビルド・コード品質チェック

```bash
# ローカルビルド（本番と同じ出力を確認）
npm run build

# TypeScript型チェックのみ
npx tsc --noEmit

# ESLint
npm run lint

# 特定のキーワードがコード内に残っていないか確認
# 例: マッチング表現の残留チェック
grep -r "マッチング" src/
```

### 18.3 Supabase ダッシュボード

```
URL: https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe

テーブル確認:     Table Editor → salons / job_seekers / contacts
Storage確認:      Storage → carelink-uploads
RLSポリシー確認:  Authentication → Policies
SQL実行:          SQL Editor（直接クエリ実行）
ログ確認:         Logs → API / Postgres
```

### 18.4 Vercel ダッシュボード

```
URL: https://vercel.com（ログイン後）

デプロイ履歴:     プロジェクト → Deployments
環境変数:         Settings → Environment Variables
ドメイン設定:     Settings → Domains
ログ:             Deployments → 該当デプロイ → Functions → Logs
Analytics:        Analytics タブ
```

---

## 変更履歴

| 日付 | バージョン | 内容 |
|------|-----------|------|
| 2026-03-21 | 1.1 | テーブル作成SQL追加、業務フロー図追加、Slack通知メッセージ例追加、Storage設定手順追加、写真アップロード制約追加、データ確認方法追加、.env.example作成、Node.jsバージョン追記、トラブルシューティング拡充 |
| 2026-03-21 | 1.0 | 初版作成 |
