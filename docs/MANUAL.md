# CareLink マニュアル v1.0

**最終更新**: 2026年3月21日
**バージョン**: 1.0
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
7. [ページ構成](#7-ページ構成)
8. [フォーム・バリデーション](#8-フォームバリデーション)
9. [API Route](#9-api-route)
10. [コンポーネント設計](#10-コンポーネント設計)
11. [SEO・構造化データ](#11-seo構造化データ)
12. [セキュリティ](#12-セキュリティ)
13. [アナリティクス](#13-アナリティクス)
14. [デザインシステム](#14-デザインシステム)
15. [法的対応](#15-法的対応)
16. [運用手順](#16-運用手順)
17. [トラブルシューティング](#17-トラブルシューティング)

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
| Next.js | フレームワーク（App Router） | 14.2.35 |
| React | UI | 18 |
| TypeScript | 言語 | 5 |
| Tailwind CSS | スタイリング | 3.4.1 |
| Supabase | DB（PostgreSQL） | SDK 2.99.2 |
| Zod | バリデーション | 4.3.6 |
| React Hook Form | フォーム管理 | 7.71.2 |
| Vercel | ホスティング | - |
| Vercel Analytics | アクセス解析 | 2.0.1 |
| Vercel Speed Insights | パフォーマンス | 2.0.0 |
| Noto Sans JP | 日本語フォント | Google Fonts |

### 1.4 本番URL

| 画面 | URL | 備考 |
|------|-----|------|
| 本番（Vercel） | https://carelink-ruddy-psi.vercel.app | カスタムドメイン未設定 |
| 予定ドメイン | https://carelink.jp | 取得・設定後 |
| GitHub | eyelashsalon-halgroup/carelink | プライベート |
| Supabase | プロジェクトID: xzafxiupbflvgbarrihe | - |

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
    |  フォーム送信
    |  ├─ Supabase INSERT（クライアント側）
    |  └─ POST /api/notify（サーバー側 → Slack通知）
    v
Supabase (PostgreSQL)
    |-- salons テーブル          … 施設登録データ
    |-- job_seekers テーブル     … 求職者登録データ
    |-- contacts テーブル        … お問い合わせデータ
    |-- carelink-uploads バケット … 施設写真

外部サービス:
    |-- Slack Incoming Webhook   … フォーム送信通知
    |-- Google Analytics 4      … アクセス解析
    |-- Microsoft Clarity       … ヒートマップ・セッション録画
    |-- Vercel Analytics         … Web Vitals
```

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
│   │           └── route.ts      … Slack通知 API Route
│   ├── components/
│   │   ├── Header.tsx            … ヘッダー（レスポンシブ・CTA付き）
│   │   ├── Footer.tsx            … フッター（運営会社情報付き）
│   │   ├── FadeIn.tsx            … スクロールフェードインアニメーション
│   │   ├── FAQ.tsx               … FAQアコーディオン
│   │   ├── StepIndicator.tsx     … フォームステップインジケーター
│   │   ├── PhotoUpload.tsx       … 写真アップロード（プレビュー付き）
│   │   ├── ConfirmDialog.tsx     … 確認ダイアログ（a11y対応）
│   │   ├── Spinner.tsx           … ローディングスピナー
│   │   └── Toast.tsx             … トースト通知
│   ├── lib/
│   │   ├── supabase.ts           … Supabaseクライアント初期化
│   │   └── validations.ts        … Zodスキーマ・バリデーション定義
│   └── types/
│       └── index.ts              … 型定義
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

| 変数 | 用途 | 必須 | スコープ |
|------|------|:----:|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | ✅ | クライアント |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | ✅ | クライアント |
| `NEXT_PUBLIC_BASE_URL` | 本番URL（metadataBase・sitemap） | - | クライアント |
| `NEXT_PUBLIC_GA_ID` | Google Analytics 4 測定ID | - | クライアント |
| `NEXT_PUBLIC_CLARITY_ID` | Microsoft Clarity プロジェクトID | - | クライアント |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL | - | サーバーのみ |

> **NEXT_PUBLIC_** プレフィックス付きはクライアントに公開される。`SLACK_WEBHOOK_URL` はサーバー側のみ（API Route内で使用）。

### 4.2 ローカルセットアップ

```bash
# 1. リポジトリクローン
git clone https://github.com/eyelashsalon-halgroup/carelink.git
cd carelink

# 2. 依存関係インストール
npm install

# 3. 環境変数設定
cp .env.example .env.local
# .env.local を編集して実際の値を設定

# 4. 開発サーバー起動
npm run dev
# → http://localhost:3000
```

### 4.3 .env.local テンプレート

```env
NEXT_PUBLIC_SUPABASE_URL=https://xzafxiupbflvgbarrihe.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
NEXT_PUBLIC_BASE_URL=http://localhost:3000
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/REDACTED
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

> GitHub連携での自動デプロイは組織権限の制約により未設定。手動CLI (`vercel --prod`) でデプロイ。

### 5.2 Vercel設定

| 設定 | 値 |
|------|-----|
| プロジェクトID | `prj_bckwxIcEfm4bcQ3k4dVdPmWez3aB` |
| 組織ID | `team_FxqzqrTMTrJeIfpVf2vYfqkX` |
| フレームワーク | Next.js（自動検出） |
| ビルドコマンド | `next build`（デフォルト） |
| 出力ディレクトリ | `.next`（デフォルト） |

### 5.3 環境変数の設定

```bash
# Vercel CLI で環境変数を追加
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SLACK_WEBHOOK_URL
vercel env add NEXT_PUBLIC_GA_ID
vercel env add NEXT_PUBLIC_CLARITY_ID
vercel env add NEXT_PUBLIC_BASE_URL
```

### 5.4 カスタムドメイン設定（未実施）

```bash
# ドメイン取得後
vercel domains add carelink.jp
# DNS設定: CNAME → cname.vercel-dns.com
```

---

## 6. DB設計（Supabase）

### 6.1 salons テーブル

| カラム | 型 | 必須 | 説明 |
|--------|-----|:----:|------|
| id | uuid | ✅ | PK（自動生成） |
| created_at | timestamptz | ✅ | 登録日時 |
| facility_name | text | ✅ | 施設名 |
| business_type | text | ✅ | 業種 |
| representative_name | text | ✅ | 代表者名 |
| contact_name | text | ✅ | 担当者名 |
| email | text | ✅ | メールアドレス |
| phone | text | ✅ | 電話番号 |
| postal_code | text | - | 郵便番号 |
| address | text | - | 住所 |
| business_hours | text | - | 営業時間 |
| regular_holiday | text | - | 定休日 |
| seat_count | integer | - | 席数・ベッド数 |
| staff_count | integer | - | スタッフ数 |
| pr_text | text | - | PR文（500文字以内） |
| photo_url | text | - | 施設写真URL |
| desired_start_date | text | - | 希望掲載開始日 |

### 6.2 job_seekers テーブル

| カラム | 型 | 必須 | 説明 |
|--------|-----|:----:|------|
| id | uuid | ✅ | PK |
| created_at | timestamptz | ✅ | 登録日時 |
| full_name | text | ✅ | 氏名 |
| furigana | text | ✅ | フリガナ（カタカナ） |
| birth_date | text | - | 生年月日 |
| gender | text | - | 性別 |
| phone | text | ✅ | 電話番号 |
| email | text | ✅ | メールアドレス |
| postal_code | text | - | 郵便番号 |
| address | text | - | 住所 |
| job_type | text | ✅ | 希望職種 |
| certifications | text[] | - | 保有資格 |
| experience_years | text | - | 経験年数 |
| education | text | - | 学歴 |
| previous_job | text | - | 前職 |
| desired_employment_type | text[] | - | 希望雇用形態 |
| desired_location | text | - | 希望勤務地 |
| desired_salary | text | - | 希望年収 |
| self_pr | text | - | 自己PR（1000文字以内） |

### 6.3 contacts テーブル

| カラム | 型 | 必須 | 説明 |
|--------|-----|:----:|------|
| id | uuid | ✅ | PK |
| created_at | timestamptz | ✅ | 送信日時 |
| name | text | ✅ | お名前 |
| email | text | ✅ | メールアドレス |
| phone | text | - | 電話番号 |
| inquiry_type | text | ✅ | 問い合わせ種別 |
| message | text | ✅ | 内容 |

### 6.4 Storage

| バケット | 用途 | アクセス |
|---------|------|---------|
| `carelink-uploads` | 施設写真 | Public read |

パス形式: `salons/{uuid}/photo.{ext}`

### 6.5 RLS（Row Level Security）

全テーブルで **INSERT のみ許可**（anon ロール）:

```sql
CREATE POLICY "Allow insert" ON salons FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow insert" ON job_seekers FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow insert" ON contacts FOR INSERT WITH CHECK (true);
```

SELECT / UPDATE / DELETE は anon からは不可。管理はSupabase Dashboard経由。

---

## 7. ページ構成

### 7.1 ページ一覧

| パス | ファイル | レンダリング | 説明 |
|------|---------|:----------:|------|
| `/` | `page.tsx` | Static | トップページ（LP） |
| `/salon` | `salon/page.tsx` | Static | 施設掲載登録 |
| `/jobs` | `jobs/page.tsx` | Static | 求職者登録 |
| `/contact` | `contact/page.tsx` | Static | お問い合わせ |
| `/privacy` | `privacy/page.tsx` | Static | プライバシーポリシー |
| `/terms` | `terms/page.tsx` | Static | 利用規約 |
| `/api/notify` | `api/notify/route.ts` | Dynamic | Slack通知API |
| `/sitemap.xml` | `sitemap.ts` | Static | サイトマップ |
| `/robots.txt` | `robots.ts` | Static | robots.txt |

### 7.2 トップページ構成

| セクション | 内容 |
|-----------|------|
| Hero | キャッチコピー + 施設/求職者CTAボタン |
| Numbers | 0円 / 3分 / 5業種+ / 24h |
| こんな方におすすめ | 施設経営者 / 求職者の2カラムカード |
| CareLink の特長 | 業界特化 / 業界特化の掲載 / 完全無料 |
| ご利用の流れ | 無料登録 → 掲載・公開 → スタート（3ステップ） |
| 安心してご利用いただけます | SSL暗号化 / 個人情報保護 / サポート体制 |
| よくある質問 | 4問のFAQ（アコーディオン） |
| CTA | 施設掲載 / 求職者登録ボタン |

### 7.3 施設掲載ページ構成

| セクション | 内容 |
|-----------|------|
| Hero | キャッチコピー + CTAボタン |
| CareLink が選ばれる理由 | 完全無料 / 業界特化 / 業界特化の掲載（3カード） |
| CareLink でできること | プロフィール掲載 / 求人情報掲載 / 専任サポート |
| ご利用の流れ | 4ステップ（フォーム入力→担当者連絡→掲載開始→集客・採用） |
| 無料掲載登録フォーム | 3ステップフォーム（基本→詳細→PR） |
| よくある質問 | 5問のFAQ |

### 7.4 求職者ページ構成

| セクション | 内容 |
|-----------|------|
| Hero | キャッチコピー + CTAボタン |
| CareLink が選ばれる理由 | 完全無料 / 業界特化 / 非公開求人掲載 |
| ご利用の流れ | 3ステップ（登録→求人を探す→応募） |
| 求職者登録フォーム | 3ステップフォーム（基本→経歴→希望条件） |
| よくある質問 | 5問のFAQ |

---

## 8. フォーム・バリデーション

### 8.1 バリデーションライブラリ

- **Zod**: スキーマ定義・バリデーション
- **React Hook Form**: フォーム状態管理（`mode: 'onTouched'`）
- **@hookform/resolvers**: Zod連携

### 8.2 施設掲載フォーム（3ステップ）

**Step 1: 基本情報（必須）**

| フィールド | バリデーション |
|-----------|--------------|
| 施設名 | 必須 |
| 業種 | 必須（セレクト） |
| 代表者名 | 必須 |
| 担当者名 | 必須 |
| メールアドレス | 必須・Email形式 |
| 電話番号 | 必須・`0`始まり・自動ハイフン |

**Step 2: 詳細情報（任意）**

| フィールド | バリデーション |
|-----------|--------------|
| 郵便番号 | 7桁数字（ハイフンなし可） |
| 住所 | 任意 |
| 営業時間 | 任意 |
| 定休日 | 任意 |
| 席数 | 整数 ≥ 0 |
| スタッフ数 | 整数 ≥ 0 |

**Step 3: PR情報（任意）**

| フィールド | バリデーション |
|-----------|--------------|
| PR文 | 500文字以内（文字数カウンター付き） |
| 施設写真 | 画像ファイル（Supabase Storageにアップロード） |
| 希望掲載開始日 | date形式 |

### 8.3 求職者登録フォーム（3ステップ）

**Step 1: 基本情報**

| フィールド | バリデーション |
|-----------|--------------|
| 氏名 | 必須 |
| フリガナ | 必須・全角カタカナ（スペース許可） |
| 生年月日 | 任意 |
| 性別 | 任意（男性/女性/その他/回答しない） |
| 電話番号 | 必須・電話番号形式 |
| メールアドレス | 必須・Email形式 |
| 郵便番号 | 7桁数字 |
| 住所 | 任意 |

**Step 2: 経歴**

| フィールド | バリデーション |
|-----------|--------------|
| 職種 | 必須（セレクト） |
| 保有資格 | 任意（チェックボックス複数選択） |
| 経験年数 | 任意（セレクト） |
| 学歴 | 任意 |
| 前職 | 任意 |

**Step 3: 希望条件**

| フィールド | バリデーション |
|-----------|--------------|
| 希望雇用形態 | 任意（チェックボックス複数選択） |
| 希望勤務地 | 任意 |
| 希望年収 | 任意 |
| 自己PR | 1000文字以内 |

### 8.4 お問い合わせフォーム

| フィールド | バリデーション |
|-----------|--------------|
| お名前 | 必須 |
| メールアドレス | 必須・Email形式 |
| 電話番号 | 任意・電話番号形式 |
| 問い合わせ種別 | 必須（掲載について/求職について/その他） |
| 内容 | 必須 |

### 8.5 共通UX機能

| 機能 | 説明 |
|------|------|
| ステップインジケーター | 現在のステップを視覚的に表示（3段階） |
| 確認ダイアログ | 送信前に確認（ConfirmDialog） |
| beforeunload警告 | フォーム入力中のページ離脱防止 |
| プライバシーポリシー同意 | チェックボックスで同意（必須） |
| 送信完了画面 | 成功後に完了メッセージ表示 |
| 電話番号自動ハイフン | `09012345678` → `090-1234-5678` |

---

## 9. API Route

### 9.1 POST /api/notify

Slack Incoming Webhook を使ったフォーム送信通知。

**リクエスト:**

```json
{
  "type": "salon" | "job_seeker" | "contact",
  "data": { ... }
}
```

**3種類の通知内容:**

| type | Slackメッセージ |
|------|---------------|
| `salon` | 施設名・業種・代表者名・電話・メール |
| `job_seeker` | 氏名・職種・電話・メール |
| `contact` | お名前・種別・メール・内容 |

**レート制限:**

- IPアドレスごとに 5リクエスト / 60秒
- 超過時: `429 Too Many Requests`

**セキュリティ:**

- ユーザー入力のSlackエスケープ（`&` `<` `>` → `&amp;` `&lt;` `&gt;`）
- `SLACK_WEBHOOK_URL` 未設定時: `500` レスポンス
- `export const dynamic = 'force-dynamic'`（サーバーサイド実行を強制）

**クライアント側の呼び出し:**

```typescript
// DB保存成功後に呼び出し（通知失敗は無視）
fetch('/api/notify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  signal: AbortSignal.timeout(10000),  // 10秒タイムアウト
  body: JSON.stringify({ type: 'salon', data: { ... } }),
}).catch(() => {});
```

> 通知は補助機能。DB保存（Supabase INSERT）が成功すればフォーム送信は成功扱い。

---

## 10. コンポーネント設計

### 10.1 共通コンポーネント一覧

| コンポーネント | ファイル | 説明 |
|---------------|---------|------|
| `Header` | `Header.tsx` | スティッキーヘッダー、デスクトップ+モバイルナビ、CTA「無料で掲載する」ボタン |
| `Footer` | `Footer.tsx` | 3カラム（ブランド/サービス/その他）+ 運営会社情報 |
| `FadeIn` | `FadeIn.tsx` | IntersectionObserver ベースのスクロールフェードインアニメーション |
| `FAQ` | `FAQ.tsx` | `<details>/<summary>` によるアコーディオンFAQ |
| `StepIndicator` | `StepIndicator.tsx` | フォームの進行ステップ表示（1/2/3） |
| `PhotoUpload` | `PhotoUpload.tsx` | ドラッグ&ドロップ対応の写真アップロード（プレビュー付き） |
| `ConfirmDialog` | `ConfirmDialog.tsx` | モーダル確認ダイアログ（`aria-modal`, ESCキー対応） |
| `Spinner` | `Spinner.tsx` | CSS SVGスピナー |
| `Toast` | `Toast.tsx` | 成功/エラーのトースト通知（5秒で自動消去） |

### 10.2 Header 詳細

- **スティッキー**: `sticky top-0 z-50` + 半透明背景 (`bg-white/95 backdrop-blur`)
- **デスクトップ**: ナビリンク（施設の方 / 求職者の方 / お問い合わせ）+ CTA
- **モバイル**: ハンバーガーメニュー（44px タッチターゲット）、スライドダウン展開
- **CTAボタン**: 「無料で掲載する」→ `/salon` リンク

### 10.3 ConfirmDialog 詳細

- `role="dialog"` / `aria-modal="true"` / `aria-labelledby`
- ESCキーで閉じる（`useEffect` + `useCallback`）
- オーバーレイ背景クリックで閉じる

---

## 11. SEO・構造化データ

### 11.1 メタデータ

| ページ | title | description |
|--------|-------|-------------|
| `/` | CareLink &#124; 医療・福祉・美容の採用×集客プラットフォーム | 医療・福祉・美容に特化した採用×集客プラットフォーム... |
| `/salon` | 【無料掲載】医療・福祉・美容の集客サイト | 美容サロン・鍼灸院・整骨院・介護施設の集客に... |
| `/jobs` | 医療・福祉・美容の転職サイト | 介護士・鍼灸師・アイリスト・看護師の転職に特化... |
| `/contact` | お問い合わせ | ご質問やご不明点がございましたら... |
| `/privacy` | プライバシーポリシー | - |
| `/terms` | 利用規約 | - |

### 11.2 構造化データ (JSON-LD)

| ページ | Schema.org Type | 内容 |
|--------|----------------|------|
| 全ページ（layout.tsx） | `WebSite` | サイト名・URL・説明 |
| 全ページ（layout.tsx） | `LocalBusiness` | 事業者名・住所・料金帯 |
| 全ページ（layout.tsx） | `FAQPage` | よくある質問4問 |
| `/salon` | `BreadcrumbList` | トップ → 施設・サロンの方 |
| `/jobs` | `BreadcrumbList` | トップ → 求職者の方 |

### 11.3 Canonical URL

各ページに `alternates.canonical` を設定:

```
/ → /
/salon → /salon
/jobs → /jobs
/contact → /contact
```

### 11.4 OGP

- OGP画像: `/og-image.png`（1200x630）
- `og:type`: website
- `og:locale`: ja_JP
- `og:site_name`: CareLink

### 11.5 sitemap.xml

| URL | 更新頻度 | 優先度 |
|-----|---------|:------:|
| `/` | weekly | 1.0 |
| `/salon` | weekly | 0.9 |
| `/jobs` | weekly | 0.9 |
| `/contact` | monthly | 0.5 |
| `/privacy` | monthly | 0.3 |
| `/terms` | monthly | 0.3 |

---

## 12. セキュリティ

### 12.1 HTTPセキュリティヘッダー

`next.config.mjs` で全ページに設定:

| ヘッダー | 値 | 効果 |
|---------|-----|------|
| `X-Content-Type-Options` | `nosniff` | MIMEスニッフィング防止 |
| `X-Frame-Options` | `DENY` | クリックジャッキング防止 |
| `X-XSS-Protection` | `1; mode=block` | XSSフィルター有効化 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | リファラー制御 |

### 12.2 データベースセキュリティ

- **RLS**: INSERT のみ許可（anon ロール）
- SELECT / UPDATE / DELETE は Supabase Dashboard からのみ
- anon key はクライアントに公開されるが、INSERT以外の操作は不可

### 12.3 API セキュリティ

- **レート制限**: IPアドレスごとに 5リクエスト/60秒（in-memory）
- **入力エスケープ**: Slack通知の `&` `<` `>` をエスケープ
- **タイムアウト**: クライアント→APIは10秒タイムアウト

### 12.4 フォームセキュリティ

- **Zod バリデーション**: サーバー側でのスキーマ検証
- **beforeunload**: フォーム入力中のページ離脱防止
- **同意チェック**: プライバシーポリシー同意チェックボックス必須

### 12.5 画像最適化

- **WebP / AVIF** 対応（`next.config.mjs` の `images.formats`）
- Supabase Storage の公開URLを使用

---

## 13. アナリティクス

### 13.1 対応ツール

| ツール | 環境変数 | 用途 |
|--------|---------|------|
| Vercel Analytics | 自動（Vercelデプロイ時） | Web Vitals（LCP, FID, CLS） |
| Vercel Speed Insights | 自動 | ページ表示速度 |
| Google Analytics 4 | `NEXT_PUBLIC_GA_ID` | アクセス解析（PV, ユーザー数等） |
| Microsoft Clarity | `NEXT_PUBLIC_CLARITY_ID` | ヒートマップ・セッション録画 |

### 13.2 読み込み方式

- GA4 / Clarity: `next/script` の `strategy="afterInteractive"` で遅延読み込み
- 環境変数未設定時は読み込みスキップ（コード変更不要）
- Vercel Analytics / Speed Insights: React コンポーネントとして埋め込み

---

## 14. デザインシステム

### 14.1 カラーパレット

| 用途 | CSS変数 | 値 | 説明 |
|------|--------|-----|------|
| Primary | `--primary` | `#0EA5E9` | Sky-500（メインカラー） |
| Primary Dark | `--primary-dark` | `#0284C7` | Sky-600（ホバー） |
| Accent | `--accent` | `#F59E0B` | Amber-500 |
| Background | `--background` | `#ffffff` | 白 |
| Foreground | `--foreground` | `#171717` | 黒に近い灰色 |

### 14.2 共通CSSクラス（`globals.css`）

| クラス | 説明 |
|--------|------|
| `.btn-primary` | メインボタン（Sky, ホバーでダーク, disabled時グレー化） |
| `.btn-accent` | アクセントボタン（Amber） |
| `.btn-outline` | アウトラインボタン（Sky枠線） |
| `.section-container` | セクション共通コンテナ（max-w-6xl, padding） |
| `.section-title` | セクション見出し（中央揃え, 太字） |
| `.form-label` | フォームラベル |
| `.form-input` | フォーム入力（フォーカスリング付き） |
| `.form-error` | バリデーションエラー文（赤） |
| `.card` | カード（白背景, 角丸, シャドウ, ホバーで影強調） |

### 14.3 フォント

- **Noto Sans JP**: Google Fonts（400/500/700/900 weight, display: swap）

### 14.4 レスポンシブ

- **sm**: 640px〜
- **lg**: 1024px〜
- モバイルファースト設計

---

## 15. 法的対応

### 15.1 現在のサービス形態

**情報掲載プラットフォーム**（広告型）として運営。

- 施設情報の掲載
- 求人情報の掲載
- 求職者の登録

### 15.2 職業安定法への対応

| 機能 | 対応状況 |
|------|---------|
| 求人情報の掲載（広告型） | 届出不要 |
| 求職者と施設のマッチング | **未実装**（届出取得後に実装予定） |
| AI自動マッチング | **未実装**（届出取得後に実装予定） |

> 職業紹介事業（有料・無料）を行う場合は厚生労働大臣の許可または届出が必要（職業安定法 第30条・第33条）。現時点ではマッチング機能を提供せず、情報掲載のみで運営。

### 15.3 「マッチング」表現の削除（2026-03-21）

コード内から全ての「マッチング」「AI自動マッチング」「AIマッチング」表現を削除済み。
代替表現: 「業界特化の掲載」「求人情報の掲載」「情報提供」

**対象ファイル**: `page.tsx`, `salon/page.tsx`, `salon/layout.tsx`, `jobs/page.tsx`, `jobs/layout.tsx`, `terms/page.tsx`, `privacy/page.tsx`

### 15.4 法的ドキュメント

| ページ | 制定日 |
|--------|--------|
| `/privacy` プライバシーポリシー | 2026年3月19日 |
| `/terms` 利用規約 | 2026年3月19日 |

---

## 16. 運用手順

### 16.1 フォーム送信確認

1. フォーム送信 → Supabase に INSERT
2. Slack通知（`SLACK_WEBHOOK_URL` 設定時）
3. Supabase Dashboard で登録データを確認

### 16.2 コード変更・デプロイ

```bash
# 1. ローカルで変更・確認
npm run dev

# 2. ビルド確認
npm run build

# 3. コミット・プッシュ
git add .
git commit -m "変更内容"
git push origin main

# 4. 本番デプロイ
npx vercel --prod
```

### 16.3 Slack Webhook 設定手順

1. [Slack API](https://api.slack.com/apps) でアプリ作成
2. Incoming Webhooks を有効化
3. 通知先チャンネルを選択 → Webhook URL をコピー
4. Vercel 環境変数に `SLACK_WEBHOOK_URL` を設定
5. 再デプロイ

### 16.4 GA4 設定手順

1. [Google Analytics](https://analytics.google.com/) でプロパティ作成
2. 測定ID（`G-XXXXXXXXXX`）を取得
3. Vercel 環境変数に `NEXT_PUBLIC_GA_ID` を設定
4. 再デプロイ

### 16.5 Clarity 設定手順

1. [Microsoft Clarity](https://clarity.microsoft.com/) でプロジェクト作成
2. プロジェクトID を取得
3. Vercel 環境変数に `NEXT_PUBLIC_CLARITY_ID` を設定
4. 再デプロイ

---

## 17. トラブルシューティング

### 17.1 よくある問題

| 症状 | 原因 | 対処 |
|------|------|------|
| フォーム送信失敗 | Supabase URL/Key 不正 | Vercel環境変数を確認 |
| Slack通知が来ない | `SLACK_WEBHOOK_URL` 未設定 | Vercel環境変数を設定→再デプロイ |
| ビルドエラー | TypeScript型エラー | `npm run build` でエラー確認 |
| 写真アップロード失敗 | Supabase Storageバケット未作成 | `carelink-uploads` バケットを作成 |
| OGP画像が表示されない | `/public/og-image.png` 未配置 | 1200x630の画像を配置 |
| GA4が計測されない | `NEXT_PUBLIC_GA_ID` 未設定 | 環境変数設定→再デプロイ |
| 404ページ表示 | パス間違い | Next.js App Routerのルーティング確認 |
| レート制限エラー（429） | 短時間に5回以上送信 | 60秒待って再試行 |

### 17.2 ビルド確認

```bash
# ローカルビルド
npm run build

# 型チェック
npx tsc --noEmit

# Lint
npm run lint
```

### 17.3 Supabase ダッシュボード

- URL: https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe
- テーブル確認: Table Editor
- Storage確認: Storage → carelink-uploads
- RLS確認: Authentication → Policies

---

## 変更履歴

| 日付 | バージョン | 内容 |
|------|-----------|------|
| 2026-03-21 | 1.0 | 初版作成 |
