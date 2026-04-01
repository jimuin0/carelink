# CareLink マニュアル v7.3

**最終更新**: 2026年4月1日
**バージョン**: 7.3
**作成者**: Claude + 神原 良祐
**プロジェクト**: ~/Projects/carelink/

> 医療・福祉・美容業界に特化した採用×集客プラットフォーム（HPB完全再現）。
> - **LP（ランディングページ）**: 施設掲載登録・求職者登録・お問い合わせ
> - **検索サイト**: 施設検索・施設詳細・口コミ・エリア検索・お問い合わせ
> - **ユーザーシステム**: 認証（メール/LINE）・マイページ・お気に入り・ポイント
> - **スタッフ・クーポン**: スタッフ詳細・ポートフォリオ・クーポン管理
> - **オンライン予約**: カレンダー予約・空き枠計算・予約管理
> - **サロン管理ダッシュボード**: 予約・顧客・スタッフ・クーポン・分析
> - **高度な機能**: ヘアカタログ・ブログ・ランキング・GPS検索・チャット・施設比較・Q&A
> - **HPB超え30機能**: GPS現在地検索・日時指定検索・口コミ写真/返信/役に立った・予約変更・予約台帳・指名スタッフ・スタッフ別売上・ポイント自動付与

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

### 1.2 サイト構成（5つのセクションが同居）

| サイト | パス | 用途 | ヘッダー/フッター |
|--------|------|------|-------------------|
| LP（ランディングページ） | `/`, `/salon`, `/register`, `/recruit`, `/contact`, `/privacy`, `/terms`, `/legal` | 施設登録・求人掲載・お問い合わせ | Header + Footer |
| 検索サイト | `/search`, `/search/area`, `/facility/[slug]`, `/ranking` | 施設検索・詳細・口コミ・エリア検索・ランキング | SearchHeader + SearchFooter |
| 認証 | `/auth/login`, `/auth/signup`, `/auth/callback` | ユーザー認証（メール+LINE） | なし（専用レイアウト） |
| マイページ | `/mypage`, `/mypage/profile`, `/mypage/favorites`, `/mypage/bookings`, `/mypage/points`, `/mypage/coupons`, `/mypage/chat`, `/mypage/staff` | ユーザーダッシュボード | 認証ガード付きレイアウト |
| 管理ダッシュボード | `/admin`, `/admin/bookings`, `/admin/bookings/calendar`, `/admin/staff`, `/admin/coupons`, `/admin/customers`, `/admin/blog`, `/admin/catalog`, `/admin/analytics`, `/admin/settings`, `/admin/reviews`, `/admin/photos`, `/admin/menus`, `/admin/chat`, `/admin/qa`, `/admin/features` | サロン管理（予約・顧客・スタッフ・売上・チャット・Q&A） | サイドバー付きレイアウト |

> `LayoutSwitch` コンポーネントが `usePathname()` でパスを判別し、LP用/検索用/認証用/マイページ用/管理画面用のヘッダー・フッターを自動切替する。

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
| @supabase/ssr | Cookie対応認証（PKCE） | 0.x |
| Zod | バリデーション | 4.3.6 |
| React Hook Form | フォーム管理 | 7.71.2 |
| Vercel | ホスティング・CDN | - |
| Vercel Analytics | アクセス解析 | 2.0.1 |
| Vercel Speed Insights | パフォーマンス | 2.0.0 |
| Noto Sans JP | 日本語フォント | Google Fonts |
| @sentry/nextjs | エラー監視 | - |
| @upstash/ratelimit | レート制限（Redis） | - |
| @upstash/redis | Redis クライアント | - |
| Resend | メール送信 | - |
| web-push | Web Push通知 | - |
| Jest + RTL | テスト | - |

### 1.5 本番URL

| 画面 | URL | 備考 |
|------|-----|------|
| 本番（Vercel） | https://www.carelink-jp.com | カスタムドメイン設定済み |
| カスタムドメイン | https://carelink-jp.com | Cloudflare Registrar（$10.46/年）|
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

### 1.7 現在の外部サービス設定状況（2026-04-01時点）

| サービス | 状態 | 備考 |
|---------|:----:|------|
| Supabase DB（LP: 3テーブル） | ✅ 設定済み | salons / job_seekers / contacts + RLS |
| Supabase DB（検索: 5テーブル） | ✅ 設定済み | facility_profiles / menus / photos / reviews / inquiries + RLS + トリガー |
| Supabase DB（Phase 2: 認証+エリア） | ✅ 設定済み | profiles / favorites / areas + view_count + RPC + トリガー |
| Supabase DB（Phase 3: スタッフ+クーポン） | ✅ 設定済み | staff_profiles / staff_photos / coupons / coupon_menus / menu_staff |
| Supabase DB（Phase 4: 予約） | ✅ 設定済み | staff_schedules / schedule_overrides / bookings + RPC(get_available_slots) |
| Supabase DB（Phase 5: 管理） | ✅ 設定済み | facility_members / customer_visits + admin用RLS |
| Supabase DB（Phase 6: 高度機能） | ✅ 設定済み | treatment_catalogs / blog_posts / review_replies / user_points |
| Supabase Auth | ✅ 設定済み | メール+LINE認証（PKCE, Cookie対応）、Redirect URL 2件登録済み |
| Supabase Storage | ✅ 設定済み | carelink-uploads バケット |
| Vercel デプロイ | ✅ 稼働中 | GitHub連携で自動デプロイ（push→自動ビルド） |
| Slack Incoming Webhook | ❌ 未設定 | Webhook URL作成 + Vercel環境変数設定が必要 |
| Google Analytics 4 | ✅ 設定済み | `G-BP8GVKJ3NZ`（Vercel環境変数設定+デプロイ済み） |
| Microsoft Clarity | ✅ 設定済み | `w1sqla5alv`（Vercel環境変数設定+デプロイ済み） |
| カスタムドメイン | ✅ 設定済み | `carelink-jp.com`（Cloudflare → Vercel DNS） |
| Sentry | ✅ 設定済み | `@sentry/nextjs`（tracesSampleRate 0.1） |
| Upstash Redis | ✅ 設定済み | `@upstash/ratelimit`（booking 3回/5分、notify 5回/60秒） |
| Web Push | ✅ 設定済み | VAPID鍵生成済み、`push_subscriptions`テーブル作成済み |
| Jest + CI/CD | ✅ 設定済み | 200テスト（20スイート）、GitHub Actions CI |

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
    |   |-- src/app/recruit/page.tsx      … 求人掲載登録（3ステップフォーム）
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

- **管理ダッシュボード**: `/admin` に施設管理画面完備（予約/顧客/スタッフ/クーポン/ブログ/カタログ/写真/口コミ/分析/設定）。`facility_members`テーブルで権限管理
- **クライアント側INSERT**: Supabase anon keyでクライアントから直接DBに書き込む（RLSでINSERTのみ許可）
- **通知は補助機能**: Slack通知失敗でもフォーム送信は成功扱い（DB保存が優先）
- **LP側は全Static**: ビルド時に静的HTML生成（CDN配信）
- **検索側はSSR/ISR**: search は `force-dynamic`（毎回DB取得）、facility は ISR（1時間キャッシュ）
- **SEOエリアページ**: `[prefectureSlug]/[secondSlug]/[typeSlug]` の3階層動的ルーティングで283市区町村+2,054ページ自動生成
- **LayoutSwitch**: `usePathname()` で LP用/検索用/認証用/マイページ用/管理画面用のヘッダー・フッターを自動切替
- **Supabaseクライアント4種**: 匿名クライアント (`supabase.ts`)、ブラウザCookie対応 (`supabase-browser.ts`)、サーバー匿名 (`supabase-server.ts`)、サーバー認証Cookie対応 (`supabase-server-auth.ts`)

---

## 3. ディレクトリ構成

```
~/Projects/carelink/
├── docs/
│   └── MANUAL.md                        … このマニュアル
├── supabase/
│   └── migrations/                         … DBマイグレーション（18ファイル）
├── .github/
│   └── workflows/ci.yml                   … GitHub Actions CI（lint/tsc/test）
├── public/
│   ├── favicon.svg                      … ファビコン
│   ├── apple-touch-icon.png             … Apple Touch Icon
│   ├── og-image.png                     … OGP画像（1200x630）
│   ├── manifest.json                    … PWA マニフェスト
│   ├── sw.js                            … Service Worker（Push通知+オフライン）
│   ├── offline.html                     … オフラインフォールバック
│   └── icons/icon-192.svg              … PWAアイコン
├── src/
│   ├── middleware.ts                     … 認証トークンリフレッシュ + 保護ルート
│   ├── app/
│   │   ├── layout.tsx                   … ルートレイアウト（メタデータ・構造化データ・GA4・Clarity）
│   │   ├── page.tsx                     … トップページ（LP）
│   │   ├── globals.css                  … グローバルCSS（Tailwindコンポーネント定義）
│   │   ├── loading.tsx / error.tsx / not-found.tsx
│   │   ├── robots.ts / sitemap.ts       … robots.txt / 動的sitemap.xml
│   │   │
│   │   ├── search/                      … 【検索】施設検索
│   │   │   ├── page.tsx / layout.tsx / loading.tsx / error.tsx
│   │   │   └── area/                    … エリアドリルダウン
│   │   │       ├── page.tsx / loading.tsx / error.tsx
│   │   │       └── [slug]/page.tsx
│   │   │
│   │   ├── facility/[slug]/             … 【検索】施設詳細
│   │   │   ├── page.tsx / loading.tsx / error.tsx / not-found.tsx
│   │   │   ├── booking/                 … オンライン予約
│   │   │   │   ├── page.tsx / loading.tsx / error.tsx
│   │   │   │   └── complete/page.tsx
│   │   │   ├── staff/                   … スタッフ一覧
│   │   │   │   ├── page.tsx / loading.tsx / error.tsx
│   │   │   │   └── [staffSlug]/page.tsx
│   │   │   ├── blog/                    … 施設ブログ
│   │   │   │   ├── page.tsx / loading.tsx / error.tsx
│   │   │   │   └── [postSlug]/page.tsx
│   │   │   └── catalog/                 … ヘアカタログ
│   │   │       └── page.tsx / loading.tsx
│   │   │
│   │   ├── compare/page.tsx             … 【検索】施設比較（最大3件横並び）
│   │   │
│   │   ├── [prefectureSlug]/            … 【SEO】エリアページ（283市区町村+2,054ページ）
│   │   │   ├── page.tsx                 … 都道府県ページ
│   │   │   └── [secondSlug]/
│   │   │       ├── page.tsx             … 市区町村/業種ページ
│   │   │       └── [typeSlug]/page.tsx  … 業種×エリアページ
│   │   │
│   │   ├── feature/                     … 【特集】特集ページ
│   │   │   ├── page.tsx / loading.tsx
│   │   │   └── [slug]/page.tsx / loading.tsx
│   │   │
│   │   ├── ranking/                     … 【ランキング】
│   │   │   ├── page.tsx / loading.tsx / error.tsx
│   │   │   └── [area]/page.tsx
│   │   │
│   │   ├── blog/                        … 【コラム】公開ブログ
│   │   │   ├── page.tsx / error.tsx
│   │   │   └── [slug]/page.tsx
│   │   │
│   │   ├── salon/                       … 【LP】施設掲載LP
│   │   │   ├── page.tsx / layout.tsx
│   │   ├── register/                    … 【LP】施設登録フォーム
│   │   │   ├── page.tsx / layout.tsx
│   │   │   └── complete/page.tsx
│   │   ├── recruit/                     … 【LP】求人掲載登録
│   │   │   ├── page.tsx / layout.tsx
│   │   ├── contact/                     … 【LP】お問い合わせ
│   │   │   ├── page.tsx / layout.tsx
│   │   ├── privacy/page.tsx             … プライバシーポリシー
│   │   ├── terms/page.tsx               … 利用規約
│   │   ├── legal/page.tsx               … 特定商取引法に基づく表記
│   │   │
│   │   ├── auth/                        … 【認証】（robots noindex）
│   │   │   ├── layout.tsx / loading.tsx
│   │   │   ├── login/page.tsx           … ログイン（メール+LINE）
│   │   │   ├── signup/page.tsx          … 新規登録
│   │   │   ├── forgot-password/page.tsx … パスワードリセット申請
│   │   │   ├── reset-password/page.tsx  … パスワード再設定
│   │   │   └── callback/route.ts        … OAuthコールバック
│   │   │
│   │   ├── mypage/                      … 【マイページ】（認証必須、robots noindex）
│   │   │   ├── layout.tsx / page.tsx / loading.tsx / error.tsx
│   │   │   ├── profile/page.tsx / loading.tsx
│   │   │   ├── favorites/page.tsx / loading.tsx
│   │   │   ├── bookings/
│   │   │   │   ├── page.tsx / loading.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   │       └── change/page.tsx   … 予約日時変更
│   │   │   ├── points/page.tsx / loading.tsx
│   │   │   ├── coupons/page.tsx          … クーポン手帳
│   │   │   ├── chat/page.tsx             … メッセージ（Realtime）
│   │   │   └── staff/page.tsx            … 指名スタッフ一覧
│   │   │
│   │   ├── admin/                       … 【管理】（facility_members権限必須、robots noindex）
│   │   │   ├── layout.tsx / page.tsx / loading.tsx / error.tsx
│   │   │   ├── bookings/               … 予約管理
│   │   │   │   ├── page.tsx / loading.tsx
│   │   │   │   ├── [id]/page.tsx
│   │   │   │   └── calendar/page.tsx    … 予約台帳（ガントチャート）
│   │   │   ├── customers/              … 顧客管理
│   │   │   │   ├── page.tsx / loading.tsx
│   │   │   │   └── [email]/page.tsx
│   │   │   ├── staff/                   … スタッフ管理
│   │   │   │   ├── page.tsx / loading.tsx
│   │   │   │   └── [id]/edit/page.tsx
│   │   │   ├── coupons/                … クーポン管理
│   │   │   │   ├── page.tsx / loading.tsx
│   │   │   │   └── new/page.tsx
│   │   │   ├── blog/                    … ブログ管理
│   │   │   │   ├── page.tsx / loading.tsx
│   │   │   │   ├── new/page.tsx
│   │   │   │   └── [id]/edit/page.tsx
│   │   │   ├── catalog/                 … カタログ管理
│   │   │   │   ├── page.tsx / loading.tsx
│   │   │   │   └── new/page.tsx
│   │   │   ├── menus/page.tsx / loading.tsx     … メニューCRUD
│   │   │   ├── reviews/page.tsx / loading.tsx   … 口コミ管理
│   │   │   ├── photos/page.tsx / loading.tsx    … 写真管理
│   │   │   ├── analytics/
│   │   │   │   ├── page.tsx / loading.tsx … 売上分析
│   │   │   │   └── StaffSalesTab.tsx     … スタッフ別売上
│   │   │   ├── settings/page.tsx / loading.tsx  … 施設設定
│   │   │   ├── chat/page.tsx              … チャット管理（Realtime）
│   │   │   ├── qa/page.tsx                … Q&A管理
│   │   │   ├── features/page.tsx          … 特集記事管理
│   │   │   ├── inquiries/page.tsx        … 施設宛お問い合わせ一覧
│   │   │   ├── registrations/page.tsx    … 施設掲載申請一覧
│   │   │   └── staff/new/page.tsx        … スタッフ新規追加
│   │   │
│   │   └── api/                         … APIルート（18エンドポイント）
│   │       ├── notify/route.ts          … Slack通知（Zod検証・レート制限）
│   │       ├── booking/route.ts         … 予約作成（競合チェック・レート制限）
│   │       ├── booking/[id]/cancel/route.ts … 予約キャンセル
│   │       ├── admin/booking-status/route.ts … 予約ステータス変更
│   │       ├── slots/route.ts           … 空き枠取得
│   │       ├── favorites/route.ts       … お気に入りトグル
│   │       ├── profile/route.ts         … プロフィール更新
│   │       ├── salons/route.ts          … 施設検索API
│   │       ├── og/route.tsx             … 動的OGP画像生成（@vercel/og）
│   │       ├── booking/complete/route.ts … 予約完了（ポイント自動付与）
│   │       ├── availability/route.ts    … 月間空き状況
│   │       └── auth/line/               … LINE OAuth
│   │           ├── route.ts / callback/route.ts
│   │
│   ├── components/                      … 64コンポーネント
│   │   ├── Header.tsx / Footer.tsx      … LP用ヘッダー・フッター
│   │   ├── LayoutSwitch.tsx             … パス別レイアウト自動切替
│   │   ├── ConfirmDialog.tsx            … 確認ダイアログ（フォーカストラップ）
│   │   ├── Toast.tsx                    … トースト通知（role="alert"）
│   │   ├── Breadcrumb.tsx               … パンくずナビ
│   │   ├── CookieConsent.tsx            … Cookie同意バナー
│   │   ├── FadeIn.tsx                   … スクロールフェードイン
│   │   ├── FAQ.tsx                      … FAQアコーディオン
│   │   ├── StepIndicator.tsx            … マルチステップ進行表示
│   │   ├── MultiPhotoUpload.tsx         … 写真アップロード（MIME検証）
│   │   ├── Spinner.tsx                  … ローディングスピナー
│   │   │
│   │   ├── search/                      … 検索コンポーネント（16個）
│   │   │   ├── SearchHeader.tsx / SearchFooter.tsx / SearchBar.tsx
│   │   │   ├── FacilityCard.tsx / Pagination.tsx
│   │   │   ├── SearchFilters.tsx        … サイドバーフィルター（地方optgroup・こだわり16条件）
│   │   │   ├── MobileFilterDrawer.tsx   … モバイルフィルタードロワー（dialog）
│   │   │   ├── HomeSearchForm.tsx       … トップページ検索フォーム
│   │   │   ├── HomeUserPanel.tsx        … ログインユーザーパネル
│   │   │   ├── CompareButton.tsx       … 施設比較ボタン
│   │   │   └── CompareBar.tsx          … 施設比較フローティングバー
│   │   │
│   │   ├── facility/                    … 施設詳細コンポーネント（23個）
│   │   │   ├── PhotoGallery.tsx / FacilityHeader.tsx / TabNavigation.tsx
│   │   │   ├── MenuList.tsx / AccessInfo.tsx / ReviewTab.tsx
│   │   │   ├── ReviewList.tsx / ReviewForm.tsx / InquiryForm.tsx
│   │   │   ├── StarRating.tsx / StickyBookingBar.tsx
│   │   │   ├── BusinessStatusBadge.tsx  … 営業状態バッジ
│   │   │   ├── CatalogList.tsx          … カタログ一覧
│   │   │   ├── CouponBadge.tsx / CouponCard.tsx / CouponList.tsx
│   │   │   ├── FavoriteButton.tsx       … お気に入りボタン
│   │   │   ├── SimilarFacilities.tsx    … 類似施設
│   │   │   ├── StaffCard.tsx / StaffList.tsx
│   │   │   ├── ViewCount.tsx            … 閲覧数カウンター
│   │   │   ├── QASection.tsx           … 施設Q&A表示+投稿
│   │   │   └── RecentlyViewed.tsx      … 閲覧履歴（localStorage）
│   │   │
│   │   ├── admin/AdminMobileNav.tsx     … 管理画面モバイルナビ
│   │   ├── auth/AuthButton.tsx          … 認証ボタン
│   │   ├── booking/BookingFlow.tsx      … 予約フロー全体
│   │   ├── catalog/BeforeAfterSlider.tsx … Before/After比較スライダー
│   │   ├── home/JapanRegionMap.tsx      … 日本地図エリアマップ
│   │   └── seo/                         … SEOコンポーネント
│   │       ├── SafeHtmlContent.tsx      … HTMLサニタイザー
│   │       └── RelatedLinks.tsx         … 関連リンク
│   │
│   ├── lib/                             … ライブラリ（27ファイル）
│   │   ├── supabase.ts                  … クライアント匿名
│   │   ├── supabase-browser.ts          … ブラウザCookie対応
│   │   ├── supabase-server.ts           … サーバー匿名（公開データ読み取り専用）
│   │   ├── supabase-server-auth.ts      … サーバー認証Cookie対応
│   │   ├── facilities.ts               … 施設DBクエリ
│   │   ├── staff.ts / coupons.ts / bookings.ts / schedules.ts
│   │   ├── areas.ts / catalogs.ts / blog.ts / rankings.ts / points.ts
│   │   ├── user.ts / admin.ts / features.ts
│   │   ├── constants.ts                 … 都道府県・業種・特徴・曜日・regionGroups・SITE_URL
│   │   ├── seo-constants.ts             … SEO用定数
│   │   ├── area-seo.ts                  … エリアSEOコンテンツ取得
│   │   ├── analytics.ts                 … GA4イベント追跡
│   │   ├── image-utils.ts              … SHIMMER_BLURプレースホルダー
│   │   ├── email.ts                     … Resendメール送信
│   │   ├── csrf.ts                      … CSRF保護
│   │   ├── validations.ts              … LP用Zodスキーマ
│   │   ├── validations-auth.ts          … 認証Zodスキーマ
│   │   └── validations-booking.ts       … 予約Zodスキーマ
│   │
│   ├── types/
│   │   ├── index.ts                     … 全型定義
│   │   └── database.types.ts            … Supabase自動生成型
│   │
│   └── data/
│       ├── articles.ts                  … コラム記事データ
│       └── city-slugs.ts               … 市区町村スラッグマッピング
│
├── .env.example                         … 環境変数テンプレート
├── next.config.mjs                      … Next.js設定（セキュリティヘッダー・画像最適化・Sentry）
├── sentry.client.config.ts              … Sentry Client（無効化、100KB JS削減）
├── sentry.server.config.ts              … Sentry Server（tracesSampleRate 0.1）
├── sentry.edge.config.ts                … Sentry Edge（tracesSampleRate 0.1）
├── jest.config.js                       … Jest設定（jsdom・@/*エイリアス・uncrypto ESM対応）
├── vercel.json                          … Vercel設定
├── tailwind.config.ts                   … Tailwind設定（デザイントークン）
├── tsconfig.json / postcss.config.mjs / .eslintrc.json / package.json
```

---

## 4. 環境変数・セットアップ

### 4.1 環境変数一覧

| 変数 | 用途 | 必須 | スコープ | 設定場所 |
|------|------|:----:|---------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | ✅ | クライアント | Vercel + .env.local |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | ✅ | クライアント | Vercel + .env.local |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key | ✅ | サーバーのみ | Vercel + .env.local |
| `NEXT_PUBLIC_BASE_URL` | 本番URL（`SITE_URL`定数経由で全ファイル参照） | - | クライアント | Vercel + .env.local |
| `NEXT_PUBLIC_GA_ID` | Google Analytics 4 測定ID | - | クライアント | Vercel のみ |
| `NEXT_PUBLIC_CLARITY_ID` | Microsoft Clarity プロジェクトID | - | クライアント | Vercel のみ |
| `NEXT_PUBLIC_LINE_CHANNEL_ID` | LINE OAuth チャネルID | - | クライアント | Vercel + .env.local |
| `LINE_CHANNEL_SECRET` | LINE OAuth チャネルシークレット | - | サーバーのみ | Vercel + .env.local |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL | - | サーバーのみ | Vercel + .env.local |
| `RESEND_API_KEY` | Resend メール送信APIキー | - | サーバーのみ | Vercel + .env.local |
| `EMAIL_FROM` | 送信元メールアドレス | - | サーバーのみ | Vercel + .env.local |
| `CRON_SECRET` | Vercel Cron認証シークレット | - | サーバーのみ | Vercel + .env.local |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN | - | クライアント | Vercel + .env.local |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis URL | - | サーバーのみ | Vercel + .env.local |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis トークン | - | サーバーのみ | Vercel + .env.local |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push VAPID公開鍵 | - | クライアント | Vercel + .env.local |
| `VAPID_PRIVATE_KEY` | Web Push VAPID秘密鍵 | - | サーバーのみ | Vercel + .env.local |

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
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# 本番URL（省略時: https://www.carelink-jp.com）
NEXT_PUBLIC_BASE_URL=http://localhost:3000

# Slack通知（省略時: 通知なし・API 500レスポンス）
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/REDACTED

# LINE OAuth（省略時: LINEログイン無効）
NEXT_PUBLIC_LINE_CHANNEL_ID=your_line_channel_id
LINE_CHANNEL_SECRET=your_line_channel_secret

# メール送信（省略時: メール送信スキップ）
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM=CareLink <noreply@carelink-jp.com>

# エラー監視 - Sentry（省略時: 監視なし）
NEXT_PUBLIC_SENTRY_DSN=https://xxxxx@xxx.ingest.sentry.io/xxxxx

# Rate Limiting - Upstash Redis（省略時: in-memoryフォールバック）
UPSTASH_REDIS_REST_URL=https://xxxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxQ=

# Vercel Cron認証（省略時: Cronジョブが401で失敗）
CRON_SECRET=your_cron_secret_here

# Web Push通知 - VAPID（省略時: Push通知無効）
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your_vapid_public_key_here
VAPID_PRIVATE_KEY=your_vapid_private_key_here

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

### 5.4 カスタムドメイン設定（設定済み）

- **ドメイン**: `carelink-jp.com`（Cloudflare Registrar、$10.46/年）
- **Vercel Domains**: `carelink-jp.com` + `www.carelink-jp.com` 設定済み
- **Cloudflare DNS**: A `@` → `76.76.21.21`、CNAME `www` → `cname.vercel-dns.com`（DNS only）
- **SSL証明書**: 自動生成済み
- **残作業**: Supabase Auth Site URL 更新（`NEXT_PUBLIC_BASE_URL`はコード側`SITE_URL`フォールバックで対応済み）

---

## 6. DB設計（Supabase）

### 6.1 テーブル一覧

**Phase 1: LP + 検索基盤（8テーブル）**

| テーブル | 用途 | サイト |
|---------|------|--------|
| `salons` | 施設掲載登録データ | LP |
| `job_seekers` | 求職者登録データ | LP |
| `contacts` | LP問い合わせデータ | LP |
| `facility_profiles` | 施設公開プロフィール（+view_count） | 検索 |
| `facility_menus` | 施設メニュー（カテゴリ・価格・時間） | 検索 |
| `facility_photos` | 施設写真（ソート順付き） | 検索 |
| `facility_reviews` | 口コミ（星評価+コメント） | 検索 |
| `facility_inquiries` | 施設宛お問い合わせ | 検索 |

**Phase 2: ユーザーシステム + エリア検索（3テーブル）**

| テーブル | 用途 | サイト |
|---------|------|--------|
| `profiles` | ユーザープロフィール（auth.usersに連動、自動作成トリガー） | マイページ |
| `favorites` | お気に入り（user_id + facility_id UNIQUE） | マイページ・検索 |
| `areas` | エリア階層（region/prefecture/city/station、parent_id） | 検索 |

**Phase 3: スタッフ + クーポン（5テーブル）**

| テーブル | 用途 | サイト |
|---------|------|--------|
| `staff_profiles` | スタッフ情報（名前/役職/経歴/得意分野/SNS） | 検索・管理 |
| `staff_photos` | スタッフ写真（portfolio/before_after） | 検索 |
| `coupons` | クーポン（タイプ別: 新規/リピート/期間限定/全員） | 検索・管理 |
| `coupon_menus` | クーポン⇔メニュー結合 | 検索 |
| `menu_staff` | メニュー⇔スタッフ結合 | 検索 |

**Phase 4: オンライン予約（3テーブル + RPC）**

| テーブル | 用途 | サイト |
|---------|------|--------|
| `staff_schedules` | 週間シフト（day_of_week/start_time/end_time） | 予約・管理 |
| `schedule_overrides` | 例外日（is_holiday/特別時間） | 予約・管理 |
| `bookings` | 予約情報（日時/顧客/ステータス/金額） | 予約・マイページ・管理 |
| RPC `get_available_slots` | 空き枠計算（facility_id, staff_id, date, duration） | 予約 |

**Phase 5: 管理ダッシュボード（2テーブル）**

| テーブル | 用途 | サイト |
|---------|------|--------|
| `facility_members` | 施設メンバー（owner/admin/staff権限） | 管理 |
| `customer_visits` | 来店履歴（施設・日付・メニュー・金額） | 管理 |

**Phase 6: 高度な機能（4テーブル）**

| テーブル | 用途 | サイト |
|---------|------|--------|
| `treatment_catalogs` | ヘアカタログ（ビフォーアフター・タグ） | 検索・管理 |
| `blog_posts` | ブログ（タイトル/slug/内容/公開状態） | 検索・管理 |
| `review_replies` | オーナー口コミ返信（1レビュー1返信） | 検索・管理 |
| `user_points` | ポイント履歴（理由/予約ID/ポイント数） | マイページ |

**Phase 7: HPB超え拡張（7テーブル + カラム追加）** ※要DB Migration実行

| テーブル/変更 | 用途 | サイト |
|-------------|------|--------|
| `review_helpful` | 口コミ「役に立った」（review_id + user_id UNIQUE） | 検索 |
| `feature_articles` | 特集記事（タイトル/画像/リンク/sort_order） | 検索・管理 |
| `facility_qa` | 施設Q&A（質問/回答/ステータス/公開フラグ） | 検索・管理 |
| `chat_rooms` | チャットルーム（facility_id + user_id UNIQUE） | マイページ・管理 |
| `chat_messages` | チャットメッセージ（Supabase Realtime） | マイページ・管理 |
| `user_preferred_staff` | 指名スタッフ（user_id + staff_id） | マイページ |
| `booking_menus` | 複数メニュー同時予約（booking_id + menu_id） | 予約 |
| ALTER `facility_reviews` | `is_verified_visit BOOLEAN`, `photo_urls TEXT[]` 追加 | 検索 |
| ALTER `facility_menus` | `photo_url TEXT` 追加 | 検索・管理 |
| ALTER `staff_profiles` | `nomination_fee INT DEFAULT 0` 追加 | 予約・管理 |

### 6.1.1 マイグレーションファイル一覧（18ファイル）

| ファイル | 内容 |
|---------|------|
| `20260320_initial_tables.sql` | 初期テーブル: salons, job_seekers, contacts |
| `20260321_facilities_phase1.sql` | Phase 1: facility_profiles（施設公開データ） |
| `20260321000000_enable_rls.sql` | RLS有効化: salons, job_seekers, contacts（INSERT only） |
| `20260321000001_storage_policy.sql` | Storageポリシー: carelink-uploads（匿名アップロード+公開読取） |
| `20260321000002_contacts_phone.sql` | contacts.phone カラム追加 |
| `20260322_reviews_inquiries.sql` | facility_reviews, facility_inquiries + インデックス |
| `20260323_phase2_users_search.sql` | Phase 2: profiles, favorites, areas, view_count |
| `20260323_phase3_staff_coupons.sql` | Phase 3: staff_profiles, coupons, coupon_menus, menu_staff |
| `20260323_phase4_bookings.sql` | Phase 4: staff_schedules, schedule_overrides, bookings |
| `20260323_phase5_admin.sql` | Phase 5: facility_members, customer_visits |
| `20260323_phase6_advanced.sql` | Phase 6: treatment_catalogs, blog_posts, review_replies, user_points |
| `20260326_salons_extend.sql` | salons拡張: contact_phone, website, nearest_station, features[] |
| `20260328_performance_indexes.sql` | パフォーマンスインデックス4件（実行済み） |
| `20260328_reviews_extend.sql` | facility_reviews拡張: 5軸評価, photo_urls, is_verified_visit |
| `20260330_phase_c_infra.sql` | push_subscriptions, facility_card_view, 追加インデックス |
| `20260331_data_enrichment.sql` | シードデータ: スタッフ経験年数, スケジュール, ブログ, カタログ, エリア階層 |
| `20260331_push_subscriptions_and_indexes.sql` | push_subscriptions再構築（制約+RLS） |
| `combined_phase2_to_6.sql` | Phase 2-6統合マイグレーション（冪等トランザクション） |

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
  desired_start_date DATE,
  status TEXT DEFAULT 'pending',
  is_public BOOLEAN DEFAULT false
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
  self_pr TEXT,
  photo_url TEXT,
  status TEXT DEFAULT 'pending'
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
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE facility_profiles SET
      rating_avg = COALESCE((
        SELECT ROUND(AVG(rating)::numeric, 1)
        FROM facility_reviews
        WHERE facility_id = NEW.facility_id AND status = 'published'
      ), 0),
      rating_count = (
        SELECT COUNT(*)
        FROM facility_reviews
        WHERE facility_id = NEW.facility_id AND status = 'published'
      )
    WHERE id = NEW.facility_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE facility_profiles SET
      rating_avg = COALESCE((
        SELECT ROUND(AVG(rating)::numeric, 1)
        FROM facility_reviews
        WHERE facility_id = OLD.facility_id AND status = 'published'
      ), 0),
      rating_count = (
        SELECT COUNT(*)
        FROM facility_reviews
        WHERE facility_id = OLD.facility_id AND status = 'published'
      )
    WHERE id = OLD.facility_id;
    RETURN OLD;
  END IF;
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

| バケット名 | 公開設定 | サイズ制限 | 用途 |
|-----------|---------|-----------|------|
| `carelink-uploads` | Public read | 10MB | 施設写真（JPEG/PNG/WebP/GIF） |
| `avatars` | Public read | 5MB | ユーザープロフィール写真（JPEG/PNG/WebP） |
| `review-photos` | Public read | 5MB | 口コミ添付写真（JPEG/PNG/WebP） |

#### ファイルパス形式

```
carelink-uploads/salons/{uuid}/photo.{ext}
avatars/{user_id}/{timestamp}.{ext}
review-photos/{review_id}/{timestamp}.{ext}
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

### 7.2 求人掲載登録フロー（LP: /recruit）

```
【施設担当者】/recruit にアクセス
  ├─ Step 1: 基本情報（施設名・業種・代表者・担当者・メール・電話）
  ├─ Step 2: 詳細情報（郵便番号・住所・営業時間・定休日・席数・スタッフ数）
  ├─ Step 3: PR情報（PR文・写真・希望開始日）
  ├─ 同意チェック → 確認ダイアログ
  ├─ Supabase INSERT + Slack通知
  └─ 完了画面: 「担当者より2営業日以内にご連絡いたします。」

【管理者】
  └─ Supabase Dashboard / admin/registrationsで確認・対応
```

### 7.3 施設検索フロー（検索: /search）

```
【ユーザー】/search にアクセス
  ├─ キーワード・業種・エリアで検索
  ├─ 📍GPS現在地検索（Geolocation API → haversine 10km圏内）
  ├─ 📅日付・時間帯指定検索（午前/午後/夕方〜）
  ├─ 並び替え（新着順 / 評価順 / 人気順 / 距離順）
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

### 7.5 オンライン予約フロー（Phase 4: /facility/[slug]/booking）

```
【ユーザー】/facility/[slug]/booking にアクセス
  ├─ メニュー選択（クーポン適用可能）
  ├─ スタッフ選択（空き状況表示）
  ├─ 日付選択（カレンダー表示）
  ├─ 時間帯選択（空き枠グリッド、RPC計算）
  ├─ 顧客情報入力（名前・メール・電話・備考）
  ├─ 予約確認画面 → 確定
  ├─ POST /api/booking（競合チェック + レート制限 3回/5分）
  └─ 予約完了画面

【管理者】/admin/bookings
  ├─ 予約一覧（ステータスフィルタ: 確認待ち/確定/完了/キャンセル）
  ├─ 予約詳細 → ステータス変更（pending→confirmed→completed）
  └─ 無断キャンセル(no_show)設定可能

【ユーザー】/mypage/bookings
  ├─ 予約履歴一覧
  ├─ 予約詳細確認
  └─ キャンセル（POST /api/booking/[id]/cancel、UUID検証+所有者チェック）
```

### 7.6 管理ダッシュボードフロー（Phase 5: /admin）

```
【施設オーナー】/admin にアクセス（facility_membersで権限チェック、owner/adminのみ）
  ├─ ダッシュボード: 今日の予約数・KPI表示
  ├─ 予約管理: 一覧/詳細/ステータス変更
  ├─ 📅予約台帳: ガントチャート（縦=スタッフ、横=9:00-22:00）
  ├─ 顧客管理: 顧客検索/来店履歴
  ├─ スタッフ管理: 追加/編集/削除（指名料設定）
  ├─ クーポン管理: 作成/編集（新規/リピート/期間限定/全員）
  ├─ ブログ管理: 記事作成/編集/公開
  ├─ カタログ管理: ヘアカタログ追加/編集
  ├─ 口コミ管理: 公開/非公開切替・サロン返信
  ├─ 写真管理: アップロード・メイン設定
  ├─ Q&A管理: 質問回答・公開/非公開
  ├─ 特集管理: 特集記事CRUD
  ├─ チャット: ユーザーとのリアルタイムメッセージ
  ├─ 分析: 売上レポート + スタッフ別売上
  └─ 設定: 施設情報編集
```

### 7.7 Slack通知メッセージ例

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

**LP（静的ページ）**

| パス | ファイル | レンダリング | 説明 |
|------|---------|:----------:|------|
| `/` | `page.tsx` | Static | トップページ |
| `/salon` | `salon/page.tsx` | Static | 施設掲載LP（CTA→/register） |
| `/register` | `register/page.tsx` | Static | 施設掲載登録フォーム |
| ~~`/jobs`~~ | 削除済み（`/recruit`に統合） | - | - |
| `/recruit` | `recruit/page.tsx` | Static | 求人掲載登録 |
| `/contact` | `contact/page.tsx` | Static | お問い合わせ |
| `/blog` | `blog/page.tsx` | Static | コラム一覧 |
| `/blog/[slug]` | `blog/[slug]/page.tsx` | Dynamic | コラム記事 |
| `/privacy` | `privacy/page.tsx` | Static | プライバシーポリシー |
| `/terms` | `terms/page.tsx` | Static | 利用規約 |
| `/legal` | `legal/page.tsx` | Static | 特定商取引法に基づく表記 |

**検索サイト**

| パス | ファイル | レンダリング | 説明 |
|------|---------|:----------:|------|
| `/search` | `search/page.tsx` | Dynamic | 施設検索（force-dynamic） |
| `/search/area` | `search/area/page.tsx` | Static | エリアドリルダウン |
| `/search/area/[slug]` | `search/area/[slug]/page.tsx` | Dynamic | エリア別検索結果 |
| `/facility/[slug]` | `facility/[slug]/page.tsx` | ISR(1h) | 施設詳細 |
| `/facility/[slug]/staff` | `facility/[slug]/staff/page.tsx` | Dynamic | スタッフ一覧 |
| `/facility/[slug]/staff/[staffSlug]` | `facility/[slug]/staff/[staffSlug]/page.tsx` | Dynamic | スタッフ詳細 |
| `/facility/[slug]/booking` | `facility/[slug]/booking/page.tsx` | Dynamic | 予約フロー |
| `/facility/[slug]/booking/complete` | `facility/[slug]/booking/complete/page.tsx` | Static | 予約完了 |
| `/facility/[slug]/blog` | `facility/[slug]/blog/page.tsx` | Dynamic | 施設ブログ一覧 |
| `/facility/[slug]/blog/[postSlug]` | `facility/[slug]/blog/[postSlug]/page.tsx` | Dynamic | ブログ記事（Markdown描画） |
| `/facility/[slug]/catalog` | `facility/[slug]/catalog/page.tsx` | Dynamic | ヘアカタログ（Before/After） |
| `/ranking` | `ranking/page.tsx` | Static | ランキングページ |
| `/ranking/[area]` | `ranking/[area]/page.tsx` | Dynamic | エリア別ランキング |

**SEOエリアページ（動的生成）**

| パス | ファイル | レンダリング | 説明 |
|------|---------|:----------:|------|
| `/[prefectureSlug]` | `[prefectureSlug]/page.tsx` | Dynamic | 都道府県ページ（施設一覧+SEOテキスト） |
| `/[prefectureSlug]/[secondSlug]` | `[prefectureSlug]/[secondSlug]/page.tsx` | Dynamic | 市区町村/業種ページ |
| `/[prefectureSlug]/[secondSlug]/[typeSlug]` | `[prefectureSlug]/[secondSlug]/[typeSlug]/page.tsx` | Dynamic | 業種×エリア詳細ページ |

**特集ページ**

| パス | ファイル | レンダリング | 説明 |
|------|---------|:----------:|------|
| `/feature` | `feature/page.tsx` | Dynamic | 特集一覧 |
| `/feature/[slug]` | `feature/[slug]/page.tsx` | Dynamic | 特集詳細 |

**認証**

| パス | ファイル | レンダリング | 説明 |
|------|---------|:----------:|------|
| `/auth/login` | `auth/login/page.tsx` | Static | ログイン（メール+LINE） |
| `/auth/signup` | `auth/signup/page.tsx` | Static | 新規登録 |
| `/auth/callback` | `auth/callback/route.ts` | Dynamic | OAuthコールバック |
| `/auth/forgot-password` | `auth/forgot-password/page.tsx` | Static | パスワードリセット申請 |
| `/auth/reset-password` | `auth/reset-password/page.tsx` | Static | パスワード再設定 |

**マイページ（認証必須）**

| パス | ファイル | レンダリング | 説明 |
|------|---------|:----------:|------|
| `/mypage` | `mypage/page.tsx` | Dynamic | ダッシュボード |
| `/mypage/profile` | `mypage/profile/page.tsx` | Dynamic | プロフィール編集（アバター写真） |
| `/mypage/favorites` | `mypage/favorites/page.tsx` | Dynamic | お気に入り一覧 |
| `/mypage/bookings` | `mypage/bookings/page.tsx` | Dynamic | 予約履歴 |
| `/mypage/bookings/[id]` | `mypage/bookings/[id]/page.tsx` | Dynamic | 予約詳細+キャンセル |
| `/mypage/bookings/[id]/change` | `mypage/bookings/[id]/change/page.tsx` | Dynamic | 予約日時変更 |
| `/mypage/points` | `mypage/points/page.tsx` | Dynamic | ポイント履歴 |
| `/mypage/coupons` | `mypage/coupons/page.tsx` | Dynamic | クーポン手帳 |
| `/mypage/chat` | `mypage/chat/page.tsx` | Dynamic | メッセージ（Supabase Realtime） |
| `/mypage/staff` | `mypage/staff/page.tsx` | Dynamic | 指名スタッフ一覧 |

**管理ダッシュボード（施設メンバー権限必須）**

| パス | ファイル | レンダリング | 説明 |
|------|---------|:----------:|------|
| `/admin` | `admin/page.tsx` | Dynamic | ダッシュボード（今日の予約・KPI） |
| `/admin/bookings` | `admin/bookings/page.tsx` | Dynamic | 予約一覧（ステータスフィルタ） |
| `/admin/bookings/[id]` | `admin/bookings/[id]/page.tsx` | Dynamic | 予約詳細（ステータス変更） |
| `/admin/staff` | `admin/staff/page.tsx` | Dynamic | スタッフ管理 |
| `/admin/staff/[id]/edit` | `admin/staff/[id]/edit/page.tsx` | Dynamic | スタッフ編集 |
| `/admin/coupons` | `admin/coupons/page.tsx` | Dynamic | クーポン管理 |
| `/admin/coupons/new` | `admin/coupons/new/page.tsx` | Dynamic | クーポン作成 |
| `/admin/customers` | `admin/customers/page.tsx` | Dynamic | 顧客一覧 |
| `/admin/customers/[email]` | `admin/customers/[email]/page.tsx` | Dynamic | 顧客来店履歴 |
| `/admin/blog` | `admin/blog/page.tsx` | Dynamic | ブログ管理 |
| `/admin/blog/new` | `admin/blog/new/page.tsx` | Dynamic | ブログ新規作成 |
| `/admin/blog/[id]/edit` | `admin/blog/[id]/edit/page.tsx` | Dynamic | ブログ編集 |
| `/admin/catalog` | `admin/catalog/page.tsx` | Dynamic | カタログ管理 |
| `/admin/catalog/new` | `admin/catalog/new/page.tsx` | Dynamic | カタログ追加 |
| `/admin/menus` | `admin/menus/page.tsx` | Dynamic | メニュー管理（CRUD・15カテゴリ・メニュー写真） |
| `/admin/reviews` | `admin/reviews/page.tsx` | Dynamic | 口コミ管理（公開/非公開切替・サロン返信） |
| `/admin/photos` | `admin/photos/page.tsx` | Dynamic | 写真管理（アップロード・メイン設定） |
| `/admin/analytics` | `admin/analytics/page.tsx` | Dynamic | 売上レポート + スタッフ別売上（StaffSalesTab） |
| `/admin/settings` | `admin/settings/page.tsx` | Dynamic | 施設設定（基本情報・営業時間・特徴） |
| `/admin/bookings/calendar` | `admin/bookings/calendar/page.tsx` | Dynamic | 予約台帳ガントチャート（スタッフ×時間軸） |
| `/admin/chat` | `admin/chat/page.tsx` | Dynamic | チャット管理（Supabase Realtime） |
| `/admin/qa` | `admin/qa/page.tsx` | Dynamic | Q&A管理（質問回答・公開/非公開） |
| `/admin/features` | `admin/features/page.tsx` | Dynamic | 特集記事CRUD管理 |
| `/admin/inquiries` | `admin/inquiries/page.tsx` | Dynamic | 施設宛お問い合わせ一覧 |
| `/admin/registrations` | `admin/registrations/page.tsx` | Dynamic | 施設掲載申請一覧 |
| `/admin/staff/new` | `admin/staff/new/page.tsx` | Dynamic | スタッフ新規追加 |

**API Routes**

| パス | メソッド | 説明 |
|------|---------|------|
| `/api/notify` | POST | Slack通知（Zod検証・レート制限） |
| `/api/booking` | POST | 予約作成（競合チェック・レート制限: 3回/5分） |
| `/api/booking/[id]/cancel` | POST | 予約キャンセル（UUID検証・所有者チェック・メール通知） |
| `/api/booking/[id]/change` | PUT | 予約日時変更（UUID検証・競合チェック） |
| `/api/admin/booking-status` | POST | 予約ステータス変更（承認/却下・メール通知） |
| `/api/slots` | GET | 空き枠取得（UUID+日付バリデーション・duration 15-480制限） |
| `/api/favorites` | POST | お気に入りトグル（認証必須） |
| `/api/profile` | PUT | プロフィール更新（Zod検証・認証必須） |
| `/api/salons` | GET | 施設検索（キーワード・業種・エリアフィルタ） |
| `/api/og` | GET | 動的OGP画像生成（@vercel/og ImageResponse） |
| `/api/auth/line` | GET | LINE OAuthログイン |
| `/api/auth/line/callback` | GET | LINE OAuthコールバック |
| `/api/booking/complete` | POST | 予約完了処理（ステータス変更+ポイント自動付与+来店履歴記録） |
| `/api/availability` | GET | 月間空き状況取得（○×△カレンダー用、レート制限: 10回/min） |
| `/api/facilities/suggest` | GET | 検索オートコンプリート（施設名・エリア候補） |
| `/api/push/subscribe` | POST | Web Pushサブスクリプション登録 |
| `/api/stations` | GET | 駅検索（StationSearchモーダル用） |
| `/api/cron/booking-reminder` | POST | 予約リマインドCron（CRON_SECRET認証） |
| `/sitemap.xml` | GET | 動的サイトマップ（DB全件） |
| `/robots.txt` | GET | robots.txt（/admin/・/mypage/・/auth/ をdisallow） |

> **Static** = ビルド時に静的HTML生成（CDN配信）
> **Dynamic** = リクエストごとにサーバー実行
> **ISR** = Incremental Static Regeneration（キャッシュ + バックグラウンド再生成）

### 8.2 特殊ページ（loading.tsx / error.tsx / not-found.tsx）

**loading.tsx（51ファイル）**

| グループ | ディレクトリ |
|---------|-------------|
| ルート | `app/` |
| 検索 (4) | `search/` `search/area/` `search/area/[slug]/` |
| 施設 (5) | `facility/[slug]/` `facility/[slug]/booking/` `facility/[slug]/staff/` `facility/[slug]/blog/` `facility/[slug]/catalog/` |
| 特集 (2) | `feature/` `feature/[slug]/` |
| ランキング (2) | `ranking/` `ranking/[area]/` |
| 比較 (1) | `compare/` |
| エリアSEO (3) | `[prefectureSlug]/` `[prefectureSlug]/[secondSlug]/` `[prefectureSlug]/[secondSlug]/[typeSlug]/` |
| 認証 (1) | `auth/` |
| マイページ (8) | `mypage/` `mypage/bookings/` `mypage/bookings/[id]/change/` `mypage/profile/` `mypage/favorites/` `mypage/points/` `mypage/coupons/` `mypage/chat/` `mypage/staff/` |
| 管理 (22) | `admin/` `admin/settings/` `admin/menus/` `admin/reviews/` `admin/photos/` `admin/bookings/` `admin/bookings/calendar/` `admin/bookings/[id]/` `admin/blog/` `admin/blog/[id]/edit/` `admin/catalog/` `admin/analytics/` `admin/coupons/` `admin/coupons/[id]/edit/` `admin/customers/` `admin/customers/[email]/` `admin/staff/` `admin/staff/[id]/edit/` `admin/staff/[id]/schedule/` `admin/chat/` `admin/qa/` `admin/features/` `admin/inquiries/` `admin/registrations/` |

**error.tsx（28ファイル）** + `global-error.tsx`（Root Layout用）

| グループ | ディレクトリ |
|---------|-------------|
| ルート (1) | `app/` |
| 検索 (3) | `search/` `search/area/` `search/area/[slug]/` |
| 施設 (4) | `facility/[slug]/` `facility/[slug]/booking/` `facility/[slug]/staff/` `facility/[slug]/blog/` |
| 公開ページ (3) | `blog/` `contact/` `register/` |
| ランキング (2) | `ranking/` `ranking/[area]/` |
| 比較 (1) | `compare/` |
| エリアSEO (3) | `[prefectureSlug]/` `[prefectureSlug]/[secondSlug]/` `[prefectureSlug]/[secondSlug]/[typeSlug]/` |
| 認証 (1) | `auth/` |
| マイページ (1) | `mypage/` |
| 管理 (9) | `admin/` `admin/bookings/[id]/` `admin/blog/[id]/edit/` `admin/coupons/[id]/edit/` `admin/customers/[email]/` `admin/staff/[id]/edit/` `admin/staff/[id]/schedule/` `admin/inquiries/` `admin/registrations/` |

**not-found.tsx（2ファイル）**: `app/` / `facility/[slug]/`（両方 robots noindex）

### 8.3 トップページ構成（`/`）

| セクション | 内容 |
|-----------|------|
| Hero | 「ネットでかんたんサロン予約」+ 検索フォーム + 業種ピル + 統計カウンター（施設数/口コミ数/¥0） |
| 特集バナー | 3カラム画像バナー（春のヘアチェンジ/ご褒美リラク/理想の目元） |
| お悩みナビ | 6グリッド（髪イメチェン/まつ毛/肩こり/お肌/ネイル/疲れ癒し） |
| エリアマップ | JapanRegionMap + 業種×エリア + こだわり条件 + 主要都市 + 47都道府県 |

### 8.4 検索ページ構成（`/search`）

| セクション | 内容 |
|-----------|------|
| SearchBar | キーワード / 業種セレクト / エリアセレクト / 検索ボタン |
| GPS検索 | 📍「現在地から探す」ボタン（Geolocation API → haversine 10km圏内） |
| サイドバー | SearchFilters（エリア=地方optgroup/業種/評価/価格帯/こだわり16条件/📅日付/🕐時間帯） |
| モバイル | MobileFilterDrawer（`<dialog>`スライドイン）+ 固定フローティングボタン |
| 結果ヘッダー | 「○件見つかりました」+ 並び替え（新着順/評価順/人気順/距離順）+ フィルター数表示 |
| カードグリッド | FacilityCard × 20件/ページ（2列レスポンシブ） |
| Pagination | ページネーション（省略記号付き、ARIA対応） |
| Empty State | 「該当するサロン・クリニックが見つかりませんでした」 |

### 8.5 施設詳細ページ構成（`/facility/[slug]`）

| セクション | コンポーネント | 内容 |
|-----------|--------------|------|
| パンくず | `<nav>` | CareLink > 施設名 |
| 写真 | `PhotoGallery` | メイン画像+サムネイル行+カウンター |
| ヘッダー | `FacilityHeader` | 業種バッジ・評価・施設名・キャッチコピー |
| タブ | `TabNavigation` | Top / メニュー / スタッフ / カタログ / クーポン / 口コミ(件数) / Q&A / アクセス |
| Topタブ | - | 紹介文・おすすめメニュー3件・特徴タグ・基本情報 |
| メニュータブ | `MenuList` | カテゴリ別メニュー一覧（価格・時間） |
| 口コミタブ | `ReviewTab` | 評価サマリー+棒グラフ+口コミ一覧(写真・返信・「役に立った」・来店確認バッジ)+投稿フォーム(写真添付可) |
| Q&Aタブ | `QASection` | 質問一覧+投稿フォーム（サロン回答付き） |
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
| 業種 | セレクト必須（7業種+その他） |
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

### 10.0 全APIルート一覧（18エンドポイント）

| # | パス | メソッド | 認証 | レート制限 | 概要 |
|---|------|---------|:----:|-----------|------|
| 1 | `/api/notify` | POST | - | 5回/60秒 | Slack通知（Zod discriminatedUnion検証） |
| 2 | `/api/booking` | POST | 任意 | 3回/5分 | 予約作成（競合チェック・サーバー側価格計算・ポイント原子的消費） |
| 3 | `/api/booking/[id]/cancel` | POST | 必須 | 10回/60秒 | 予約キャンセル（所有者チェック・メール通知） |
| 4 | `/api/booking/[id]/change` | POST | 必須 | 10回/60秒 | 予約日時変更（pending/confirmedのみ・競合チェック） |
| 5 | `/api/booking/complete` | POST | 必須 | 10回/60秒 | 予約完了（admin専用・ポイント付与・来店記録） |
| 6 | `/api/admin/booking-status` | POST | 必須 | 10回/60秒 | ステータス変更（owner/admin・メール+Push通知） |
| 7 | `/api/slots` | GET | - | 30回/60秒 | 空き枠取得（RPC `get_available_slots`・duration 15-480） |
| 8 | `/api/availability` | GET | - | 10回/60秒 | 月間空き状況（○△×カレンダー用） |
| 9 | `/api/favorites` | POST | 必須 | 10回/60秒 | お気に入りトグル（追加/削除） |
| 10 | `/api/profile` | PUT | 必須 | 10回/60秒 | プロフィール更新（Zod検証） |
| 11 | `/api/salons` | GET | - | 20回/60秒 | 施設検索（is_public=true・最大50件） |
| 12 | `/api/facilities/suggest` | GET | - | 30回/60秒 | オートコンプリート（施設名+エリア、各5件） |
| 13 | `/api/stations` | GET | - | 30回/60秒 | 駅名検索（1時間キャッシュ） |
| 14 | `/api/push/subscribe` | POST | 必須 | 10回/60秒 | Web Pushサブスクリプション登録（upsert） |
| 15 | `/api/cron/booking-reminder` | GET | CRON | - | 予約リマインドメール（毎日9:00 JST・CRON_SECRET認証） |
| 16 | `/api/og` | GET | - | - | 動的OGP画像生成（1200×630・Edge Runtime） |
| 17 | `/api/auth/line` | GET | - | - | LINE OAuthリダイレクト（CSRFステートCookie設定） |
| 18 | `/api/auth/line/callback` | GET | - | - | LINE OAuthコールバック（セッション確立） |

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

### 11.1 共通コンポーネント（12個）

| コンポーネント | ファイル | 特徴 |
|---------------|---------|------|
| `LayoutSwitch` | `LayoutSwitch.tsx` | usePathname()でLP/検索/認証/マイページ/管理のHeader・Footer自動切替 |
| `ConfirmDialog` | `ConfirmDialog.tsx` | role="dialog", フォーカストラップ, ESCで閉じる, フォーカス復元 |
| `Toast` | `Toast.tsx` | role="alert", aria-live="assertive", 4秒自動消去, success/error/info |
| `Header` | `Header.tsx` | LP用スティッキーヘッダー（半透明backdrop-blur） |
| `Footer` | `Footer.tsx` | LP用3カラムフッター（運営会社情報付き） |
| `Breadcrumb` | `Breadcrumb.tsx` | パンくずナビゲーション |
| `CookieConsent` | `CookieConsent.tsx` | Cookie同意バナー |
| `FadeIn` | `FadeIn.tsx` | IntersectionObserverベースのフェードイン |
| `FAQ` | `FAQ.tsx` | `<details>`アコーディオン |
| `StepIndicator` | `StepIndicator.tsx` | マルチステップフォーム進行表示 |
| `MultiPhotoUpload` | `MultiPhotoUpload.tsx` | 複数写真選択+プレビュー（10MB制限・MIME検証） |
| `Spinner` | `Spinner.tsx` | SVGスピナー |

### 11.2 検索コンポーネント（`components/search/` — 16個）

| コンポーネント | 説明 |
|---------------|------|
| `SearchHeader` | 検索サイト用スティッキーヘッダー。業種ナビ（デスクトップ）+ ハンバーガー（モバイル）。aria-expanded, aria-controls |
| `SearchFooter` | ダークフッター。業種リンク + Copyright |
| `SearchBar` | 検索フォーム。keyword(type="search") + 業種select + エリアselect。name属性・aria-label付き |
| `SearchFilters` | サイドバーフィルター。エリア（地方optgroup）・業種・評価・価格帯・こだわり16条件。aria-label・aria-pressed対応 |
| `SearchSuggest` | 検索オートコンプリート。300msデバウンス、/api/facilities/suggest連携 |
| `MobileFilterDrawer` | モバイルフィルタードロワー。`<dialog>`ベース、右スライドイン、背景クリック・Escape閉じ |
| `MobileBottomNav` | モバイル下部ナビゲーション（検索・お気に入り・マイページ） |
| `HomeSearchForm` | トップページ検索フォーム。業種ピル+エリア選択+📍GPS「現在地から探す」ボタン |
| `HomeUserPanel` | ログインユーザーパネル（お気に入り・予約履歴リンク） |
| `FacilityCard` | 施設カード。画像（blurプレースホルダー）+ 業種バッジ + 星評価 + 所在地。line-clamp |
| `MapView` | Leaflet地図ビュー。施設マーカー表示+ポップアップ |
| `ViewToggle` | リスト↔マップ表示切替トグル |
| `StationSearch` | 駅名検索モーダル。/api/stations連携 |
| `CompareButton` | 施設比較ボタン（localStorage、最大3件） |
| `CompareBar` | 施設比較フローティングバー（比較リスト表示） |
| `Pagination` | ページネーション。省略記号(...) + aria-current="page" + aria-label |

### 11.3 施設詳細コンポーネント（`components/facility/` — 27個）

| コンポーネント | 説明 |
|---------------|------|
| `PhotoGallery` | メイン画像+サムネイル行。写真カウンター("1/5")。エラーフォールバック。lazy loading |
| `FacilityHeader` | 業種バッジ + 星評価+件数 + 施設名 + キャッチコピー |
| `TabNavigation` | IntersectionObserverでsticky検出。role="tablist/tab/tabpanel"。aria-selected, aria-controls, id |
| `MenuList` | カテゴリ別グルーピング。価格/時間/おすすめバッジ。空状態対応 |
| `AccessInfo` | 基本情報テーブル + 営業時間テーブル(dayOrder) + 特徴タグ + Google Map(iframe) |
| `ReviewTab` | 評価サマリーカード(平均/件数/星分布棒グラフ) + ReviewList + ReviewForm |
| `ReviewList` | 口コミカード一覧。アバター + 名前 + 日付(JST) + 星 + コメント |
| `ReviewForm` | Zod + react-hook-form。StarRating入力。ConfirmDialog + Toast。noValidate, htmlFor/id |
| `InquiryForm` | 名前/メール/電話/メッセージ。Supabase INSERT + Slack通知。autocomplete属性 |
| `StarRating` | 入力/表示兼用。readonly時: role="img" + aria-label。入力時: hover:scale-110 + aria-label="X点を選択" |
| `StickyBookingBar` | 固定下部バー。電話(tel:リンク) + お問い合わせ(#contact-sectionスクロール) |
| `BeforeAfterSlider` | Before/After画像比較スライダー。ポインタードラッグ+キーボード矢印対応。role="slider" |
| `BusinessStatusBadge` | 営業状態バッジ（営業中/休業日/準備中）。aria-hidden(ドット) + role="status" |
| `CatalogList` | カタログ一覧表示（blurプレースホルダー付き画像） |
| `CouponBadge` | クーポンタイプバッジ（新規/リピート/期間限定/全員） |
| `CouponCard` | クーポンカード（割引額/対象メニュー） |
| `CouponList` | クーポン一覧（タイプ別フィルタ対応） |
| `FavoriteButton` | お気に入りトグルボタン（ハート。認証チェック付き） |
| `SimilarFacilities` | 類似施設カード一覧（同業種・同エリア） |
| `StaffCard` | スタッフカード（写真・名前・役職・得意分野） |
| `StaffList` | スタッフ一覧グリッド |
| `ViewCount` | 閲覧数カウンター（sessionStorage安全アクセス） |
| `QASection` | 施設Q&A表示（質問一覧+投稿フォーム） |
| `RecentlyViewed` | 閲覧履歴（localStorage、最大20件） |
| `NearbyFacilities` | 近隣施設一覧（同市区町村の施設を表示） |
| `RemainingSlots` | 本日の残り枠数表示（緊急性シグナル） |
| `ShareButtons` | SNSシェアボタン（LINE/Twitter/Facebook） |
| `ViewingNow` | リアルタイム閲覧中人数表示（緊急性シグナル） |

### 11.4 ConfirmDialog 詳細

```
- role="dialog" / aria-modal="true" / aria-labelledby
- ESCキーで閉じる
- オーバーレイ背景クリックで閉じる（aria-hidden="true"）
- フォーカストラップ: Tab/Shift+Tab がダイアログ内で循環
- 開く時: 最初のボタンに自動フォーカス
- 閉じる時: 元のフォーカス位置に復元（previousFocusRef）
```

### 11.5 その他の専門コンポーネント

| コンポーネント | ファイル | 説明 |
|---------------|---------|------|
| `AdminMobileNav` | `admin/AdminMobileNav.tsx` | モバイル管理画面ナビ。4タブ+「その他」メニュー（16項目対応：ホーム/予約/顧客/メニュー/スタッフ/口コミ/写真/クーポン/ブログ/カタログ/Q&A/特集/チャット/分析/設定）|
| `AuthButton` | `auth/AuthButton.tsx` | 認証ボタン（ログイン/ログアウト切替） |
| `BookingFlow` | `booking/BookingFlow.tsx` | 予約フロー全体（メニュー→スタッフ→日時→確認→完了）。指名料自動加算対応 |
| `StaffSalesTab` | `admin/analytics/StaffSalesTab.tsx` | スタッフ別売上バーグラフ（月間） |
| `JapanRegionMap` | `home/JapanRegionMap.tsx` | 日本地図エリアマップ（8地方クリック対応） |
| `SafeHtmlContent` | `seo/SafeHtmlContent.tsx` | HTMLサニタイザー（許可タグのみ通す） |
| `RelatedLinks` | `seo/RelatedLinks.tsx` | 関連リンク一覧（エリア・業種） |
| `PushPermissionBanner` | `push/PushPermissionBanner.tsx` | Web Push通知許可バナー |

---

## 12. SEO・構造化データ

### 12.1 メタデータ

| ページ | title | description |
|--------|-------|-------------|
| `/` | CareLink &#124; ネットでかんたんサロン予約 - ヘア・ネイル・エステ・リラク・美容クリニック | ヘアサロン・ネイル・まつげ・リラク・エステ・美容クリニック・鍼灸院・整骨院を検索・予約 |
| `/salon` | 【無料掲載】医療・福祉・美容の集客サイト | 掲載無料・登録3分で集客開始 |
| `/recruit` | 求人掲載登録 | 掲載無料・登録3分で集客開始 |
| `/search` | 施設・サロンを探す | 施設検索ページ |
| `/facility/[slug]` | {施設名} - {業種} | {キャッチコピー} or {紹介文先頭160文字} |

### 12.2 構造化データ (JSON-LD)

| ページ | Schema.org Type | 内容 |
|--------|----------------|------|
| 全ページ（layout.tsx） | `WebSite` | サイト名・URL・説明・publisher |
| 全ページ（layout.tsx） | `LocalBusiness` | 事業者名・住所（大阪府堺市）・料金帯 |
| 全ページ（layout.tsx） | `FAQPage` | よくある質問4問 |
| `/salon`（layout.tsx） | `BreadcrumbList` | トップ → 施設・サロンの方 |
| `/recruit`（layout.tsx） | `BreadcrumbList` | トップ → 求人掲載 |
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
| `/salon`, `/recruit` | weekly | 0.9 |
| `/facility/{slug}` | weekly | 0.8（DB全件） |
| `/contact` | monthly | 0.5 |
| `/privacy`, `/terms` | monthly | 0.3 |

### 12.6 robots.txt

```
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /mypage/
Disallow: /auth/
Sitemap: {BASE_URL}/sitemap.xml
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
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(self)` | 不要なAPI無効化 |

### 13.2 認証・認可セキュリティ

- **Supabase Auth（PKCE）**: `@supabase/ssr` によるCookie対応認証
- **4種類のクライアント**:
  - `supabase.ts`: 匿名クライアント（公開データ読み取りのみ）
  - `supabase-browser.ts`: ブラウザ用Cookie対応クライアント
  - `supabase-server.ts`: サーバー用匿名クライアント（公開データ読み取り専用、書き込み不可）
  - `supabase-server-auth.ts`: サーバー用認証Cookie対応クライアント
- **middleware.ts**: トークン自動リフレッシュ + 保護ルート（/mypage/*, /admin/*）
- **notFound()ガード**: 全admin/mypageページでuser/membershipのnullチェック（非null assertionゼロ）
- **facility_members権限チェック**: 管理画面は施設メンバーのみアクセス可

### 13.3 データベースセキュリティ

- **RLS**: 全テーブルで適切なポリシー設定（Phase 1〜6の全テーブル）
- **admin用RLS**: facility_membersのroleベースアクセス制御
- **anon key**: RLSにより操作制限。検索側はSELECTのみ、LP側はINSERTのみ
- **サーバーサイドクエリ**: 公開データは `supabase-server.ts`、認証データは `supabase-server-auth.ts` 経由

### 13.4 APIセキュリティ

- **Zodスキーマ検証**: 全APIエンドポイントで不正ペイロードを400で拒否
- **UUID検証**: `/api/booking/[id]/cancel`, `/api/slots` でUUID形式を正規表現チェック
- **日付検証**: `/api/slots` で `YYYY-MM-DD` 形式を正規表現チェック
- **レート制限（/api/notify）**: IPごとに5リクエスト/60秒（in-memory Map、1000件超でクリーンアップ）
- **レート制限（/api/booking）**: IPごとに3リクエスト/5分（予約スパム防止）
- **duration制限（/api/slots）**: 15〜480分にクランプ
- **入力エスケープ**: Slack通知の `&` `<` `>` をHTMLエンティティに変換
- **force-dynamic**: ビルド時実行を防止
- **res.json()クラッシュ防止**: `.catch(() => null)` で非JSONレスポンス（502 HTML等）に対応
- **finally節**: 非同期ハンドラのstate cleanup（setUpdating(false)等）を保証

### 13.5 フォームセキュリティ

- **Zodバリデーション**: クライアント側+サーバー側でスキーマ検証
- **メールバリデーション**: BookingFlowで正規表現チェック
- **noValidate**: ブラウザネイティブバリデーション無効化（Zod優先）
- **同意チェック**: 未同意時は送信ボタン無効化
- **二重送信防止**: 送信中ボタン無効化+スピナー
- **beforeunload**: 入力中のページ離脱警告（LP側）
- **メッセージ長制限**: お問い合わせフォームは5000文字以内

### 13.6 robots.txt保護

```
Disallow: /admin/
Disallow: /mypage/
Disallow: /auth/
```

### 13.7 GA4/Clarity IDバリデーション

- GA4: `/^G-[A-Z0-9]+$/` 形式のみ注入（XSS防止）
- Clarity: `/^[a-z0-9]+$/i` 形式のみ注入

### 13.8 sessionStorage安全アクセス

- `ViewCount`コンポーネント: try-catchでSafari Private Browsing例外に対応

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
| Google Analytics 4 | `NEXT_PUBLIC_GA_ID` | PV・流入経路 | ✅ 設定済み（G-BP8GVKJ3NZ） |
| Microsoft Clarity | `NEXT_PUBLIC_CLARITY_ID` | ヒートマップ | ✅ 設定済み（w1sqla5alv） |

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

1. `carelink-jp.com` 取得 → `vercel domains add carelink-jp.com`
2. DNS: A `@` → `76.76.21.21`、CNAME `www` → `cname.vercel-dns.com`
3. SSL証明書自動生成を確認

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
npm test           # Jest テスト（200テスト）
npm run test:ci    # CI用テスト（single run）
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

### 20.1 テスト環境

| 技術 | 用途 |
|------|------|
| Jest | テストランナー |
| React Testing Library (RTL) | コンポーネントテスト |
| next/jest | Next.js統合設定 |

設定: `jest.config.js`（jsdom環境、`@/*`パスエイリアス、uncrypto ESM対応）

### 20.2 テストスイート（200テスト / 20スイート）

| ファイル | テスト数 | 内容 |
|---------|:-------:|------|
| `lib/__tests__/validations.test.ts` | 20 | step1/step2/step3スキーマ + formatPhone |
| `lib/__tests__/validations-booking.test.ts` | 12 | bookingSchema |
| `lib/__tests__/validations-inquiry.test.ts` | 11 | inquirySchema電話番号バリデーション |
| `lib/__tests__/validations-auth.test.ts` | 10 | loginSchema / signupSchema |
| `lib/__tests__/constants.test.ts` | 21 | UUID_REGEX、prefectures 47、businessTypes、regionGroups、dayOrder/dayLabels、SITE_URL |
| `lib/__tests__/csrf.test.ts` | 8 | CSRF検証 |
| `lib/__tests__/rate-limit.test.ts` | 12 | in-memoryフォールバック |
| `lib/__tests__/rate-limit-advanced.test.ts` | 13 | window expiry、limit=0、empty IP、checkRateLimitフォールバック |
| `lib/__tests__/email.test.ts` | 11 | メール送信テスト |
| `lib/__tests__/email-utils.test.ts` | 14 | メールユーティリティ |
| `lib/__tests__/facilities.test.ts` | 17 | 施設DBクエリ |
| `lib/__tests__/staff.test.ts` | 6 | スタッフDBクエリ |
| `lib/__tests__/coupons.test.ts` | 9 | クーポンDBクエリ |
| `lib/__tests__/push.test.ts` | 4 | Web Push送信 |
| `lib/__tests__/seo-constants.test.ts` | 21 | SEO定数 |
| `components/__tests__/Spinner.test.tsx` | 3 | Spinnerコンポーネント |
| `app/api/booking/__tests__/route.test.ts` | 13 | 予約作成API |
| `app/api/booking/[id]/cancel/__tests__/route.test.ts` | 8 | 予約キャンセルAPI |
| `app/api/favorites/__tests__/route.test.ts` | 6 | お気に入りAPI |
| `app/api/facilities/suggest/__tests__/route.test.ts` | 5 | オートコンプリートAPI |

### 20.3 CI/CD（GitHub Actions）

`.github/workflows/ci.yml`: push/PR to main → `npm ci` → `lint` → `tsc` → `test:ci`

### 20.4 実行方法

```bash
npm test          # テスト実行（watch mode）
npm run test:ci   # CI用（single run）
npm run lint      # ESLint
npx tsc --noEmit  # 型チェックのみ
```

---

## 21. 既知の制限事項・今後の開発予定

### 21.1 現在の制限事項

| 制限 | 説明 |
|------|------|
| 検索データがダミー | 実際の施設データへの移行が必要 |
| GPS検索がJS側計算 | PostGIS未使用。haversine距離計算をJS側で実行（500件上限→10km以内フィルタ）。大規模データ時はPostGIS移行推奨 |
| NEXT_PUBLIC_BASE_URL未設定 | Vercel環境変数未設定だが、`SITE_URL`定数のフォールバックで正常動作中 |
| Supabase Auth Site URL未更新 | カスタムドメインに合わせて更新が必要 |

### 21.2 今後の開発予定

| 優先度 | 機能 | 説明 |
|:------:|------|------|
| 高 | 実データ移行 | ダミー施設データを実際の施設に置換 |
| 中 | Supabase Auth Site URL | carelink-jp.comに更新（ブラウザで手動） |
| 中 | 職業紹介事業届出 | 届出取得後にマッチング機能実装 |
| 低 | PostGIS移行 | GPS検索のDB側距離計算（スケール対策） |
| 低 | E2Eテスト | Playwright導入 |

---

## 型定義一覧（`src/types/index.ts`）

**Phase 1: LP + 検索**

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

**Phase 2〜6: ユーザー・予約・管理**

| 型名 | 用途 | サイト |
|------|------|--------|
| `Profile` | ユーザープロフィール | マイページ |
| `Favorite` | お気に入り | マイページ |
| `Area` | エリア階層 | 検索 |
| `StaffProfile` | スタッフ情報 | 検索・管理 |
| `StaffPhoto` | スタッフ写真 | 検索 |
| `Coupon` | クーポン | 検索・管理 |
| `CouponMenu` | クーポン⇔メニュー結合 | 検索 |
| `MenuStaff` | メニュー⇔スタッフ結合 | 検索 |
| `StaffSchedule` | 週間シフト | 予約 |
| `ScheduleOverride` | 例外日 | 予約 |
| `Booking` | 予約情報 | 予約・マイページ・管理 |
| `AvailableSlot` | 空き枠 | 予約 |
| `FacilityMember` | 施設メンバー | 管理 |
| `CustomerVisit` | 来店履歴 | 管理 |
| `TreatmentCatalog` | ヘアカタログ | 検索・管理 |
| `BlogPost` | ブログ記事 | 検索・管理 |
| `ReviewReply` | 口コミ返信 | 検索・管理 |
| `UserPoint` | ポイント履歴 | マイページ |

---

## DBクエリ関数一覧

**`src/lib/facilities.ts`**

| 関数 | 引数 | 用途 |
|------|------|------|
| `searchFacilities(params)` | keyword, type, prefecture, page, sort, lat, lng | 施設検索（20件/ページ、ILIKE、GPS距離検索対応） |
| `haversineDistance(lat1, lng1, lat2, lng2)` | 座標2点 | 2点間距離計算（km）。GPS検索で使用 |
| `getPopularFacilities(limit)` | limit(default 6) | 人気施設取得（rating_count降順） |
| `getSimilarFacilities(...)` | facilityId, businessType, prefecture, limit | 類似施設取得（同業種・同エリア） |
| `getLatestFacilities(limit)` | limit(default 6) | 新着施設取得 |
| `getLatestReviews(limit)` | limit(default 6) | 最新口コミ取得（施設名付き） |
| `getFacilityBySlug(slug)` | slug | 施設詳細取得 |
| `getFacilityMenus(facilityId)` | UUID | メニュー取得（sort_order順） |
| `getFacilityPhotos(facilityId)` | UUID | 写真取得（sort_order順） |
| `getFacilityReviews(facilityId)` | UUID | 口コミ取得（published, 新しい順） |

**`src/lib/staff.ts`**

| 関数 | 引数 | 用途 |
|------|------|------|
| `getStaffByFacility(facilityId)` | UUID | 施設のスタッフ一覧 |
| `getStaffBySlug(facilityId, slug)` | UUID, slug | スタッフ詳細 |
| `getStaffPhotos(staffId)` | UUID | スタッフ写真一覧 |

**`src/lib/coupons.ts`**

| 関数 | 引数 | 用途 |
|------|------|------|
| `getCouponsByFacility(facilityId)` | UUID | 施設のクーポン一覧 |
| `getCouponMenus(couponId)` | UUID | クーポン対象メニュー |

**`src/lib/bookings.ts`**

| 関数 | 引数 | 用途 |
|------|------|------|
| `createBooking(data)` | BookingFormData | 予約作成（競合チェック付き） |
| `getBookings(userId)` | UUID | ユーザーの予約一覧 |
| `cancelBooking(bookingId, userId)` | UUID, UUID | 予約キャンセル |

**`src/lib/schedules.ts`**

| 関数 | 引数 | 用途 |
|------|------|------|
| `getStaffSchedule(staffId)` | UUID | 週間シフト取得 |
| `getAvailableSlots(params)` | facility_id, staff_id, date, duration | 空き枠計算（RPC） |

**`src/lib/user.ts`**

| 関数 | 引数 | 用途 |
|------|------|------|
| `getUserProfile()` | - | ログインユーザーのプロフィール |
| `getUserFavorites()` | - | お気に入り一覧 |
| `toggleFavorite(facilityId)` | UUID | お気に入りトグル |
| `checkFavorite(facilityId)` | UUID | お気に入り状態チェック |

**`src/lib/areas.ts`**

| 関数 | 引数 | 用途 |
|------|------|------|
| `getAreas()` | - | エリア階層取得 |
| `getAreaBySlug(slug)` | slug | エリア詳細（パンくずリスト付き、ループ上限10） |

**`src/lib/catalogs.ts` / `src/lib/blog.ts` / `src/lib/rankings.ts` / `src/lib/points.ts`**

| 関数 | 用途 |
|------|------|
| `getCatalogsByFacility(facilityId)` | ヘアカタログ一覧 |
| `getBlogPostsByFacility(facilityId)` | ブログ記事一覧 |
| `getRankingsByArea(area)` | エリアランキング |
| `getUserPoints(userId)` | ポイント履歴 |

**`src/lib/admin.ts`**

| 関数 | 用途 |
|------|------|
| 管理画面用クエリ群 | 予約管理・顧客管理・スタッフCRUD・メニューCRUD等 |

**`src/lib/features.ts`**

| 関数 | 用途 |
|------|------|
| 特集データ取得 | 特集一覧・特集詳細・関連施設 |

**その他のユーティリティlib**

| ファイル | 用途 |
|---------|------|
| `analytics.ts` | GA4イベント追跡（`trackEvent()`関数） |
| `area-seo.ts` | エリアSEOコンテンツ取得（`getAreaSeoContent()`） |
| `seo-constants.ts` | SEO用定数（メタディスクリプションテンプレート等） |
| `image-utils.ts` | `SHIMMER_BLUR`定数（グレーSVG base64プレースホルダー） |
| `email.ts` | Resendメール送信（6テンプレ: 予約受付確認/リマインド/予約確定/予約キャンセル/新規予約通知(施設向け)/ステータス変更） |
| `csrf.ts` | CSRF保護（Origin/Refererチェック） |

---

## 定数一覧（`src/lib/constants.ts`）

| エクスポート名 | 内容 |
|---------------|------|
| `prefectures` | 全47都道府県の配列 |
| `regionGroups` | 8地方グループ（北海道・東北/関東/中部/近畿/中国/四国/九州・沖縄）×都道府県 |
| `businessTypes` | 8業種の配列（7業種+「その他」）※ validations.tsはre-export |
| `facilityFeatures` | 16個の施設特徴タグ |
| `dayOrder` | 曜日順序配列 `['mon','tue',...,'sun']` |
| `dayLabels` | 曜日ラベル `{mon:'月', tue:'火', ...}` |
| `SITE_URL` | サイトURL（`process.env.NEXT_PUBLIC_BASE_URL \|\| 'https://www.carelink-jp.com'`）。全11ファイルから参照 |

---

## Zodスキーマ一覧

| ファイル | スキーマ | 用途 |
|---------|---------|------|
| `validations.ts` | `salonSchema`, `jobSeekerSchema`, `contactSchema` | LP登録フォーム |
| `validations.ts` | `reviewSchema`, `inquirySchema` | 検索サイトフォーム |
| `validations-auth.ts` | `loginSchema`, `signupSchema` | 認証フォーム |
| `validations-booking.ts` | `bookingSchema` | 予約フォーム（UUID/日付/時間検証） |
| ~~`validations-admin.ts`~~ | 未実装（管理画面はインラインZod検証） | - |

---

## 認証基盤（Phase 2）

### Supabaseクライアント4種

| ファイル | 用途 | Cookie | 認証 |
|---------|------|:------:|:----:|
| `supabase.ts` | クライアント匿名 | ❌ | ❌ |
| `supabase-browser.ts` | ブラウザ用（Cookie対応） | ✅ | ✅ |
| `supabase-server.ts` | サーバー匿名（公開データ読み取り専用） | ❌ | ❌ |
| `supabase-server-auth.ts` | サーバー認証（Cookie対応） | ✅ | ✅ |

> `supabase-server.ts` は公開データ読み取り専用。書き込みや認証データアクセスには `supabase-server-auth.ts` を使用する。

### middleware.ts

- トークン自動リフレッシュ（Supabase PKCE）
- 保護ルート: `/mypage/*`, `/admin/*` → 未認証時は `/auth/login` にリダイレクト
- `/auth/callback` はOAuthコールバック処理

---

## エラー監視（Sentry）

- `@sentry/nextjs` 導入、`next.config.mjs` を `withSentryConfig()` でラップ
- 3設定ファイル: `sentry.client.config.ts`（**無効化**、100KB JS削減）/ `sentry.server.config.ts` / `sentry.edge.config.ts`（DSN + tracesSampleRate 0.1）
- `src/app/global-error.tsx`（Root Layout エラーバウンダリ）
- 全8 APIルートの catch に `Sentry.captureException` 追加
- CSP: `script-src` に `https://browser.sentry-cdn.com`、`connect-src` に `https://*.ingest.sentry.io` 追加

## レート制限（Upstash Redis）

- `@upstash/ratelimit` + `@upstash/redis` 導入
- `src/lib/rate-limit.ts`: 共有モジュール（Redis未設定時はin-memoryフォールバック）
  - `bookingRateLimit`: 3回/5分
  - `notifyRateLimit`: 5回/60秒
  - `checkRateLimit()` ヘルパー
- GET APIレート制限: slots 30/min、availability 10/min、salons 20/min
- CSP: `connect-src` に `https://*.upstash.io` 追加

## Web Push通知

- `web-push` パッケージ + VAPID鍵（Vercel環境変数設定済み）
- `src/lib/push.ts`: Push送信ユーティリティ
- `push_subscriptions` テーブル（RLS + ポリシー設定済み）
- `/api/push/subscribe`: サブスクリプション登録エンドポイント
- `public/sw.js`: Service Worker（push / notificationclick ハンドラ）
- `PushPermissionBanner` コンポーネント
- booking API / admin booking-status API から自動送信

## OG Image動的化

- 施設詳細ページのOG画像を `/api/og?title=...&subtitle=...` に変更
- `@vercel/og` ImageResponse による Edge Runtime 動的生成

## DBパフォーマンスインデックス

`supabase/migrations/20260328_performance_indexes.sql`（4件の部分インデックス、実行済み）:

| インデックス | 用途 |
|------------|------|
| `idx_fp_published_created` | published施設の作成日ソート |
| `idx_fp_published_rating` | published施設の評価ソート |
| `idx_bookings_staff_date_active` | 予約競合チェック |
| `idx_reviews_facility_published` | 口コミ取得 |

---

## 品質監査履歴

20回の品質監査で合計230件以上の問題を修正:

| 回 | 検出数 | 主な修正内容 |
|:--:|:------:|------------|
| 1-6 | ~60件 | Phase 1-6の初期品質改善 |
| 7 | 22件 | CRITICAL: admin non-null assertion 4件修正、booking API rate limiting追加 |
| 8 | 11件 | cancel/slots API UUID検証、mypage non-null修正、res.json()クラッシュ防止 |
| 9 | 3件 | admin/coupons, admin/catalog, mypage/points の最終non-null assertion修正 |
| 10 | 9件 | セキュリティ3（maxLength/MIME/エラーメッセージ漏洩）・SEO2（register metadata）・a11y4（aria-expanded/aria-label/autoComplete/aria-pressed） |
| 11 | 5件 | パスワードリセット機能追加・bookingバリデーション強化・マイグレーション補完・.env.example更新・重複ページ削除 |
| 12 | 4件 | /salon LP分離（CTA→/register）・利用規約チェックボックス・FlowをB方式に変更・未使用PhotoUpload.tsx削除 |
| 13 | 14件 | 管理機能4点（施設設定/メニューCRUD/メール通知/予約承認フロー）・PWA manifest・保留予約アラート |
| 14 | 17件 | Email XSS修正・PWA SVG修正・口コミ管理・写真管理・AdminMobileNav・loading.tsx 4件・Markdownエディタ・予約ページネーション |
| 15 | 7件 | Before/Afterスライダー・エリア地方optgroup・シードデータ(スタッフ5名+カタログ6件)・マイページ予約カード・公開ブログMarkdown描画 |
| 16 | 12件 | Markdown XSS修正(sanitizeUrl 3ファイル)・ホームページ専用metadata・admin/mypage/auth robots noindex・loading.tsx 13件一括追加 |
| 17(v6.1) | 59件 | **全方位深審査3Round**: R1=UUID検証+aria-label 12箇所+loading.tsx 9件。R2=.maybeSingle()全対応+MapView修正+localStorage SSRガード+admin .limit(1).single() 24ページ。R3=FavoriteButton/user.ts .maybeSingle() 4箇所 |
| 18(v7.1) | 20件 | バリデーション(InquiryForm電話番号/Availability年範囲/Booking facility_id検証)、セキュリティ(GETレート制限3件/CSRF Sentry記録)、タイムアウト(全fetchにAbortSignal.timeout)、可観測性(全8 API Sentry.captureException)、パフォーマンス(Booking API N+1→Promise.all) |
| 19(v7.2) | 16件 | PWA sw.js・CSVエクスポート・iCalendar .ics 追加 |
| 20(v7.3) | 8件 | HPB致命的修正: オートコンプリート・空き検索統合・緊急性シグナル・クーポン取消線・予約4ステップ化・カタログタグフィルタ・Web Push・駅検索UI |

---

## HPB超え30機能一覧（v6.0）

v6.0で一括搭載した、ホットペッパービューティー（HPB）を超える30機能：

### 検索・発見（5機能）
| # | 機能 | 実装概要 |
|---|------|----------|
| 1 | GPS現在地検索 | Geolocation API→haversine距離計算→10km圏内（JS側、500件上限） |
| 2 | 日付・時間帯指定検索 | SearchFiltersに日付ピッカー+時間帯セレクト（午前/午後/夕方〜） |
| 3 | 地図ビュー切替 | Leaflet地図表示（リスト↔マップ切替） |
| 4 | 新着サロン（トップ） | `getLatestFacilities()`でトップページに新着セクション追加 |
| 5 | 特徴タグクリック検索 | 施設詳細の特徴タグをクリック→検索結果にジャンプ |

### 口コミ・評価（4機能）
| # | 機能 | 実装概要 |
|---|------|----------|
| 8 | サロン返信表示 | `review_replies`テーブルJOIN→ReviewListにグレー背景返信ブロック |
| 9 | 口コミ写真投稿 | ReviewFormに写真アップロード追加（`review-photos`バケット） |
| 10 | 「役に立った」 | `review_helpful`テーブル（review_id + user_id UNIQUE） |
| 11 | 来店確認バッジ | `is_verified_visit`フラグ（booking存在時に自動設定） |

### 施設詳細・コンテンツ（5機能）
| # | 機能 | 実装概要 |
|---|------|----------|
| 6 | 施設比較 | localStorage比較リスト（最大3件）→`/compare`で横並び表示 |
| 12 | BeforeAfterカタログ | `BeforeAfterSlider`をCatalogListに統合 |
| 13 | カタログ詳細ページ | `/facility/[slug]/catalog/[catalogId]`（大サイズスライダー+タグ+関連スタッフ） |
| 14 | AccessInfo改善 | 住所フォールバック地図+ルートボタン+最寄り駅表示 |
| 28 | 施設Q&A | 質問投稿+サロン回答（`facility_qa`テーブル、admin/qa管理画面） |

### 予約・決済（5機能）
| # | 機能 | 実装概要 |
|---|------|----------|
| 16 | 複数メニュー同時予約 | `booking_menus`テーブル、duration/price合算 |
| 17 | 月間カレンダー○×△ | `/api/availability`で空き状況取得 |
| 18 | 指名料自動加算 | `staff_profiles.nomination_fee`をBookingFlowのcalculatePrice()に加算 |
| 19 | 予約日時変更 | `/mypage/bookings/[id]/change`（日付グリッド+時間帯選択） |
| 20 | ポイント自動付与 | `/api/booking/complete`で`total_price/100`ポイント自動INSERT |

### マイページ（5機能）
| # | 機能 | 実装概要 |
|---|------|----------|
| 5 | 閲覧履歴 | localStorage `viewed_facilities`（最大20件） |
| 21 | クーポン手帳 | `/mypage/coupons`（お気に入り施設のクーポン一覧） |
| 22 | 指名スタッフ登録 | `/mypage/staff`（`user_preferred_staff`テーブル） |
| 23 | プロフィール写真 | `avatars`バケットへアップロード、5MB制限 |
| 25 | チャット | `/mypage/chat`（Supabase Realtime双方向、`chat_rooms`+`chat_messages`） |

### 管理ダッシュボード（6機能）
| # | 機能 | 実装概要 |
|---|------|----------|
| 7 | メニュー写真 | `facility_menus.photo_url`カラム、admin/menusにアップロード |
| 24 | 予約台帳カレンダー | ガントチャート（縦=スタッフ、横=9:00-22:00、CSS absolute配置） |
| 26 | スタッフ別売上 | `StaffSalesTab`（bookingsをstaff_idでGROUP BY、バーグラフ） |
| 27 | 特集管理 | `/admin/features`（`feature_articles`テーブルCRUD） |
| 29 | salon CTAリンク修正 | `/register`→`/recruit`に修正 |
| 30 | admin権限チェック強化 | `facility_members.role`検証（owner/adminのみ） |

---

## 変更履歴

| 日付 | バージョン | 内容 |
|------|-----------|------|
| 2026-04-01 | 7.3(MANUAL) | **MANUAL v7.3更新**: v7.0〜v7.3の全内容反映（Sentry・Upstash Redis・Jest 200テスト・CI/CD・OG動的化・DBインデックス・Web Push・カスタムドメイン）。`SITE_URL`定数をconstants.tsに集約（11ファイル12箇所のハードコード排除）。外部サービス設定状況更新、制限事項から完了済み項目削除、テストセクション全面書き直し、品質監査20回230件+に更新 |
| 2026-03-29 | 7.3 | **HPB致命的8件修正**: 検索オートコンプリート(/api/facilities/suggest + SearchSuggest 300msデバウンス)、空き検索統合(getAvailableFacilityIds post-filter + 空きあり/なしバッジ)、緊急性シグナル4種(ViewingNow/RemainingSlots/monthlyBookings/view_count)、クーポン価格取り消し線(computeDiscountedPrice)、予約フロー6→4ステップ(menu→staff→datetime→confirm)、カタログタグフィルタ(selectedTagチップ+スタッフ/メニュー名)、Web Push通知(sw.js+/api/push/subscribe+PushPermissionBanner)、駅検索UI(/api/stations+StationSearchモーダル)。新規10ファイル、変更17ファイル、+1277行 |
| 2026-03-29 | 7.2 | **追加LOW項目**: PWA sw.js・CSVエクスポート・iCalendar .ics |
| 2026-03-29 | 7.1 | **全方位品質監査20項目修正**: バリデーション(InquiryForm電話番号regex/Availability年範囲/Booking start<end+facility_id検証)、セキュリティ(GETレート制限3件/CSRF Sentry記録)、タイムアウト(全fetchにAbortSignal.timeout)、可観測性(全8 API Sentry.captureException/email safeSendラッパー)、パフォーマンス(Booking API N+1→Promise.all)、a11y(ReviewForm写真削除aria-label)、SEO(Blog JSON-LD Article→BlogPosting)、テスト41→71(+30、3新規ファイル) |
| 2026-03-28 | 7.0 | **本番化**: Sentry統合(@sentry/nextjs、global-error.tsx、全API captureException)、Upstash Redisレート制限(rate-limit.ts共有モジュール、in-memoryフォールバック)、Jest+RTL 41テスト(jest.config.js、8スイート)、CI/CD(GitHub Actions ci.yml)、OG Image動的化(@vercel/og Edge Runtime)、DBパフォーマンスインデックス4件、カスタムドメイン(carelink-jp.com、Cloudflare+Vercel DNS+SSL)、.env.example補完 |
| 2026-03-27 | 6.1 | **全方位深審査3Round59件修正**: R1=UUID検証(/api/favorites)+aria-label 12箇所+loading.tsx 9件追加(計38件)。R2=.maybeSingle()全対応(favorites/profiles/user.ts)+MapView二重500px修正+localStorage SSRガード(CompareButton/ViewCount)+nomination_fee null安全+clearFilters全state初期化+type定義null許容(photo_urls/is_verified_visit)+admin全24ページ.limit(1).single()。R3=FavoriteButton/user.ts .maybeSingle() 4箇所。DB Migration Phase1-3全実行完了+Storageバケット(review-photos/avatars)作成+RLSポリシー全設定 |
| 2026-03-27 | 6.0 | **HPB超え30機能一括搭載**: GPS現在地検索(haversine 10km)、日時指定検索、施設比較(/compare)、閲覧履歴(localStorage)、口コミ写真投稿/サロン返信/「役に立った」/来店確認バッジ、Q&A(施設詳細+admin管理)、特集管理(admin CRUD)、チャット(Supabase Realtime双方向)、予約日時変更(/mypage/bookings/[id]/change)、予約台帳ガントチャート(/admin/bookings/calendar)、指名スタッフ登録(/mypage/staff)、スタッフ別売上(StaffSalesTab)、指名料自動加算(BookingFlow)、ポイント自動付与(/api/booking/complete)、プロフィール写真(avatarsバケット)、メニュー写真、クーポン手帳(/mypage/coupons)、月間カレンダー○×△、複数メニュー同時予約。新テーブル7+カラム追加3。ナビ更新(admin 16項目、mypage 8項目) |
| 2026-03-27 | 5.1 | **マニュアル完全照合**: ディレクトリ構成を全124ファイル反映に書き直し、コンポーネント47個全記載、lib 27ファイル全記載、loading.tsx 30件・error.tsx全記載、SEOエリアページ・特集ページ追加、Section 2.2の事実誤認2件修正（「管理画面なし」→管理ダッシュボード完備、「クライアント2種」→4種）、品質監査16回150件+に更新 |
| 2026-03-27 | 5.0 | **HPB深度強化Round13-16(50件修正)**: 管理機能4点(施設設定/メニューCRUD/Resendメール通知5テンプレ/予約承認フロー)、PWA manifest、Email XSS修正(`esc()`関数)、口コミ管理/写真管理/AdminMobileNav(4タブ+その他)、Markdownエディタ(ツールバー+プレビュー)、予約ページネーション(20件/page)、Before/Afterスライダー(ポインタードラッグ+キーボード)、エリア地方optgroup、シードデータ(スタッフ5名+カタログ6件)、マイページ予約カード、公開ブログMarkdown描画、loading.tsx 4件追加 |
| 2026-03-26 | 4.0 | **外部サービス設定+品質強化**: GA4設定(`G-BP8GVKJ3NZ`)、Clarity設定(`w1sqla5alv`)、Supabase Site URL+Redirect URL設定、パスワードリセット機能(`/auth/forgot-password`+`/auth/reset-password`)、/salon LP分離(CTA→/register, B方式Flow)、bookingバリデーション強化、品質監査Round10-12(18件修正)、重複/salonsページ削除、マイグレーションファイル補完、.env.example更新(SERVICE_ROLE_KEY+LINE変数追加) |
| 2026-03-22 | 3.0 | **HPB完全再現**: Phase 2〜6実装完了（認証/マイページ/お気に入り/エリア検索/スタッフ/クーポン/オンライン予約/管理ダッシュボード/ブログ/カタログ/ランキング/GPS検索/ポイント）。全25テーブル、120+新規ファイル。品質監査9回実施（80+件修正）。セキュリティ強化（レート制限/UUID検証/non-null assertion全排除/HTTPセキュリティヘッダー5種/GA4・Clarity IDバリデーション） |
| 2026-03-22 | 2.0 | **大規模更新**: 検索サイト全機能追加（/search, /facility/[slug]）、検索側DB5テーブル+トリガー追加、全コンポーネント（16個）追加、LayoutSwitch追加、アクセシビリティ章追加、Zodバリデーション追加、動的sitemap、エラーバウンダリ、型定義一覧、DBクエリ関数一覧、定数一覧。GitHub移行(jimuin0)・自動デプロイ反映 |
| 2026-03-21 | 1.2 | アクセス情報追加、設定状況一覧追加、エラー/ローディング/404追加、テスト追加、制限事項追加 |
| 2026-03-21 | 1.1 | テーブルSQL追加、業務フロー追加、Slack通知例追加、Storage手順追加 |
| 2026-03-21 | 1.0 | 初版作成 |
