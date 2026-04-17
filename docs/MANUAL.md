# CareLink マニュアル v8.12.2

**最終更新**: 2026年4月17日
**バージョン**: 8.12.0
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
| LP（ランディングページ） | `/`, `/salon`, `/register`, `/recruit`, `/contact`, `/privacy`, `/terms`, `/legal`, `/jobs`, `/jobs/[id]` | 施設登録・求人掲載・求人詳細・お問い合わせ | Header + Footer |
| 検索サイト | `/search`, `/search/area`, `/facility/[slug]`, `/ranking` | 施設検索・詳細・口コミ・エリア検索・ランキング | SearchHeader + SearchFooter |
| 認証 | `/auth/login`, `/auth/signup`, `/auth/callback` | ユーザー認証（メール+LINE） | なし（専用レイアウト） |
| マイページ | `/mypage`, `/mypage/profile`, `/mypage/favorites`, `/mypage/bookings`, `/mypage/points`, `/mypage/coupons`, `/mypage/chat`, `/mypage/staff` | ユーザーダッシュボード | 認証ガード付きレイアウト |
| 管理ダッシュボード | `/admin`, `/admin/bookings`, `/admin/bookings/calendar`, `/admin/staff`, `/admin/coupons`, `/admin/customers`, `/admin/blog`, `/admin/catalog`, `/admin/analytics`, `/admin/settings`, `/admin/reviews`, `/admin/photos`, `/admin/menus`, `/admin/chat`, `/admin/qa`, `/admin/features`, `/admin/gbp` | サロン管理（予約・顧客・スタッフ・売上・チャット・Q&A・GBP管理） | サイドバー付きレイアウト |

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
| Node.js | ランタイム | 20.x推奨（package.json `engines: ">=18.17.0"`） |
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
| next/font Noto Sans JP | 日本語フォント | `next/font/google` Noto_Sans_JP（サブセット化、CLS削減。v7.6で一度削除→v8.11 TOP取得Phase2で再導入） |
| LINE Messaging API | Bot通知・Webhook | Push送信+署名検証 |
| recharts | チャート（売上/予約/顧客セグメント） | dynamic import+ssr:false |
| Stripe | オンライン決済（Checkout Session+Webhook） | stripe + @stripe/stripe-js |
| @sentry/nextjs | エラー監視 | - |
| @upstash/ratelimit | レート制限（Redis） | - |
| @upstash/redis | Redis クライアント | - |
| Resend | メール送信 | - |
| web-push | Web Push通知 | - |
| Jest + RTL | テスト | jest 30 / @testing-library/react 16 |
| @hookform/resolvers | React Hook Form ↔ Zod 連携 | 5.x |
| @next/third-parties | サードパーティスクリプト最適化 | 16.x |
| leaflet / @types/leaflet | 地図表示（MapView） | 1.9.x |
| @react-map/japan | トップページ日本地図 | 1.0.x |

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

### 1.7 現在の外部サービス設定状況（2026-04-07時点）

| サービス | 状態 | 備考 |
|---------|:----:|------|
| Supabase DB（LP: 3テーブル） | ✅ 設定済み | salons / job_seekers / contacts + RLS |
| Supabase DB（検索: 5テーブル） | ✅ 設定済み | facility_profiles / menus / photos / reviews / inquiries + RLS + トリガー |
| Supabase DB（Phase 2: 認証+エリア） | ✅ 設定済み | profiles / favorites / areas + view_count + RPC + トリガー |
| Supabase DB（Phase 3: スタッフ+クーポン） | ✅ 設定済み | staff_profiles / staff_photos / coupons / coupon_menus / menu_staff |
| Supabase DB（Phase 4: 予約） | ✅ 設定済み | staff_schedules / schedule_overrides / bookings + RPC(get_available_slots) |
| Supabase DB（Phase 5: 管理） | ✅ 設定済み | facility_members / customer_visits + admin用RLS |
| Supabase DB（Phase 6: 高度機能） | ✅ 設定済み | treatment_catalogs / blog_posts / review_replies / user_points |
| Supabase Auth | ✅ 設定済み | メール+LINE+Google認証（PKCE, Cookie対応）、Redirect URL 2件登録済み。handle_new_user()はSECURITY DEFINER設定済み（2026-04-06修正） |
| Supabase Storage | ✅ 設定済み | carelink-uploads バケット |
| Vercel デプロイ | ✅ 稼働中 | GitHub連携で自動デプロイ（push→自動ビルド） |
| Slack Incoming Webhook | ✅ 設定済み | アプリ名「carelink」（2026-04-07設定）、SLACK_WEBHOOK_URL環境変数設定済み、テスト送信成功 |
| Google Analytics 4 | ✅ 設定済み | `G-BP8GVKJ3NZ`（Vercel環境変数設定+デプロイ済み） |
| Google Search Console | ✅ 設定済み | HTMLタグ認証完了（メタタグ埋め込み方式） |
| Microsoft Clarity | ✅ 設定済み | `w1sqla5alv`（Vercel環境変数設定+デプロイ済み） |
| カスタムドメイン | ✅ 設定済み | `carelink-jp.com`（Cloudflare → Vercel DNS） |
| Sentry | ✅ 設定済み | `NEXT_PUBLIC_SENTRY_DSN` Vercel設定済み（2026-04-07）→エラー監視稼働中 |
| Upstash Redis | ✅ 設定済み | `UPSTASH_REDIS_REST_URL/TOKEN` Vercel設定済み（2026-04-07）→分散レート制限稼働中（in-memoryフォールバックから切替済み） |
| Web Push | ✅ 設定済み | VAPID鍵生成済み、`push_subscriptions`テーブル作成済み |
| LINE Messaging Bot | ✅ 設定済み | v8.0: 予約/キャンセルLINE通知、Webhook署名検証、Bot ID: @549rbbyi |
| Stripe | ✅ 設定済み（テストモード） | STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET設定済み（2026-04-07、sk_test_）。Webhook送信先「CareLink本番Webhook」`/api/payment/webhook`。Stripe Dashboardでは7イベントを購読設定済み（checkout.session.completed / customer.subscription.created・updated・deleted / invoice.payment_succeeded・failed / payment_intent.payment_failed）が、コードで実際にハンドリングしているのは3イベント（`checkout.session.completed` / `payment_intent.payment_failed` / `charge.refunded`）のみ。残りはINSERT後ノーオペで冪等記録のみ。本番化は審査後 |
| LINE OAuthログイン | ✅ 設定済み | NEXT_PUBLIC_LINE_CHANNEL_ID=2009692936/LINE_CHANNEL_SECRET設定済み（2026-04-07）。コールバックURL `https://carelink-jp.com/api/auth/callback/line` 登録済み |
| Resend | ✅ 設定済み | RESEND_API_KEY設定済み。EMAIL_FROM=`CareLink <noreply@carelink-jp.com>`。ドメイン `carelink-jp.com` Resend verified（DKIM/SPF設定済み、2026-04-14）。Supabase Auth カスタムSMTP も `smtp.resend.com` 経由に設定済み |
| Jest + CI/CD | ✅ 設定済み | 200テスト（20スイート）、GitHub Actions CI（booking dateテスト修正済み） |
| Google Maps API（Places API） | ✅ 設定済み | `GOOGLE_MAPS_API_KEY` Vercel設定済み。GBP管理ページでPlace詳細取得・スコア計算・Google口コミ表示に使用（v8.12） |

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
- **ホームページISR**: トップページ（`/`）は `revalidate=3600`（1時間キャッシュ + バックグラウンド再生成）
- **検索側はSSR/ISR**: search は `force-dynamic`（毎回DB取得）、facility は ISR（1時間キャッシュ）。search/page.tsxでは `import nextDynamic from 'next/dynamic'` にリネーム（`export const dynamic = 'force-dynamic'` との変数名衝突回避）
- **SEOエリアページ**: `[prefectureSlug]/[secondSlug]/[typeSlug]` の3階層ISRルーティング（revalidate=3600+dynamicParams=true）。47県+376県×業種+283市区町村+主要10県の市×業種ページ自動生成
- **LayoutSwitch**: `usePathname()` で LP用/検索用/認証用/マイページ用/管理画面用のヘッダー・フッターを自動切替
- **Supabaseクライアント4種**: 匿名クライアント (`supabase.ts`)、ブラウザCookie対応 (`supabase-browser.ts`)、サーバー匿名 (`supabase-server.ts`)、サーバー認証Cookie対応 (`supabase-server-auth.ts`)

---

## 3. ディレクトリ構成

```
~/Projects/carelink/
├── docs/
│   ├── MANUAL.md                        … このマニュアル
│   ├── TEST-CHECKLIST.md                … 本番テストチェックリスト（30項目+後片付け、v8.9）
│   ├── TOP-ROADMAP.md                   … HPB超え機能ロードマップ（130タスク）
│   ├── sales-templates.md               … 営業資料テンプレート5種（メール/DM/チラシ/LINE/電話）
│   ├── LAUNCH-CHECKLIST.md              … 本番ローンチPhase A-E（GSC/UptimeRobot/Sentry/Stripe/E2E、v8.11）
│   └── ADMIN-LAUNCH-TASKS.md           … 事務員向けローンチ手順書（7タスク、クリック単位の操作手順、v8.11）
├── scripts/                                … 運用スクリプト（v8.11追加）
│   ├── seed-facilities.mjs              … 都道府県別ダミー施設+求人シード生成（is_seed=trueでフラグ管理、本番投入禁止）
│   └── cleanup-seed.mjs                 … is_seed=true ダミー施設を一括削除
├── supabase/
│   └── migrations/                         … DBマイグレーション（29ファイル）
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
│   │   ├── [prefectureSlug]/            … 【SEO】エリアページ（47県+376県×業種+283市区町村、ISR 1h）
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
│   │   │   │   ├── [id]/edit/page.tsx
│   │   │   │   └── [id]/schedule/page.tsx  … スタッフシフト管理
│   │   │   ├── coupons/                … クーポン管理
│   │   │   │   ├── page.tsx / loading.tsx
│   │   │   │   ├── new/page.tsx
│   │   │   │   └── [id]/edit/page.tsx
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
│   │   └── api/                         … APIルート（35エンドポイント、詳細は§10.0）
│   │       ├── notify/route.ts          … Slack通知（Zod検証・レート制限）
│   │       ├── booking/route.ts         … 予約作成（競合チェック・レート制限）
│   │       ├── booking/[id]/cancel/route.ts … 予約キャンセル
│   │       ├── admin/booking-status/route.ts … 予約ステータス変更
│   │       ├── slots/route.ts           … 空き枠取得
│   │       ├── favorites/route.ts       … お気に入りトグル
│   │       ├── profile/route.ts         … プロフィール更新
│   │       ├── salons/route.ts          … 施設検索API
│   │       ├── booking/complete/route.ts … 予約完了（ポイント自動付与）
│   │       ├── availability/route.ts    … 月間空き状況
│   │       ├── auth/line/               … LINE OAuth
│   │       │   ├── route.ts / callback/route.ts
│   │       ├── line/webhook/route.ts   … LINE Messaging Webhook（v8.0）
│   │       ├── cron/                    … Vercel Cron 5本（booking-reminder/daily-summary/customer-segment/review-request/sync-google-ratings）
│   │       ├── payment/                … Stripe（checkout/webhook、v8.5+v8.10）
│   │       ├── account/delete/route.ts … アカウント+全データ削除（v8.5）
│   │       ├── admin/report/route.ts   … 売上CSVエクスポート（v8.1）
│   │       ├── admin/gbp/              … GBP管理 API（place: GET/POST、posts: GET/POST/PATCH/DELETE）
│   │       ├── facility/setup/route.ts … セルフ施設作成（v8.3）
│   │       ├── facilities/suggest/route.ts … 検索オートコンプリート（v7.3）
│   │       ├── push/subscribe/route.ts … Web Push購読（v7.3）
│   │       ├── referral/route.ts       … 紹介コード（v8.6）
│   │       └── stations/route.ts       … 駅検索（v7.3）
│   │
│   ├── components/                      … 80コンポーネント
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
│   │   ├── search/                      … 検索コンポーネント（17個）
│   │   │   ├── SearchHeader.tsx / SearchFooter.tsx / SearchBar.tsx
│   │   │   ├── FacilityCard.tsx / Pagination.tsx
│   │   │   ├── SearchFilters.tsx        … サイドバーフィルター（地方optgroup・こだわり16条件）
│   │   │   ├── MobileFilterDrawer.tsx   … モバイルフィルタードロワー（dialog）
│   │   │   ├── HomeSearchForm.tsx       … トップページ検索フォーム
│   │   │   ├── HomeUserPanel.tsx        … ログインユーザーパネル
│   │   │   ├── CompareButton.tsx       … 施設比較ボタン
│   │   │   └── CompareBar.tsx          … 施設比較フローティングバー
│   │   │
│   │   ├── facility/                    … 施設詳細コンポーネント（31個）
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
│   │   ├── home/HomeBelowFold.tsx      … Below-fold遅延ロード（ssr:false）
│   │   ├── home/StickySignupCta.tsx    … スクロール時スティッキーCTAバナー（未ログインのみ表示）
│   │   └── seo/                         … SEOコンポーネント
│   │       ├── SafeHtmlContent.tsx      … HTMLサニタイザー
│   │       └── RelatedLinks.tsx         … 関連リンク
│   │
│   ├── lib/                             … ライブラリ（43ファイル）
│   │   ├── supabase.ts                  … クライアント匿名
│   │   ├── supabase-browser.ts          … ブラウザCookie対応
│   │   ├── supabase-server.ts           … サーバー匿名（公開データ読み取り専用）
│   │   ├── supabase-server-auth.ts      … サーバー認証Cookie対応
│   │   ├── facilities.ts               … 施設DBクエリ
│   │   ├── staff.ts / coupons.ts / schedules.ts
│   │   ├── areas.ts / catalogs.ts / blog.ts / rankings.ts
│   │   ├── user.ts / admin.ts / features.ts
│   │   ├── constants.ts                 … 都道府県・業種・特徴・曜日・regionGroups・SITE_URL
│   │   ├── seo-constants.ts             … SEO用定数
│   │   ├── area-seo.ts                  … エリアSEOコンテンツ取得（DB seedフォールバック）
│   │   ├── seo-snippets.ts              … SEOスニペット生成器（businessTypeContext+生成3関数、v8.11）
│   │   ├── analytics.ts                 … GA4イベント追跡
│   │   ├── image-utils.ts              … SHIMMER_BLURプレースホルダー
│   │   ├── email.ts                     … Resendメール送信
│   │   ├── csrf.ts                      … CSRF保護
│   │   ├── push.ts                      … Web Push送信ユーティリティ
│   │   ├── rate-limit.ts               … レート制限（Upstash Redis/in-memoryフォールバック）
│   │   ├── line.ts                     … LINE Messaging API（Push送信/署名検証/通知テンプレート）
│   │   ├── validations.ts              … LP用Zodスキーマ
│   │   ├── validations-auth.ts          … 認証Zodスキーマ
│   │   └── validations-booking.ts       … 予約Zodスキーマ
│   │
│   ├── types/
│   │   ├── index.ts                     … 全型定義
│   │   └── database.types.ts            … Supabase自動生成型
│   │
│   └── data/
│       ├── articles.ts                  … コラム記事データ（51記事、医療/美容/福祉/エリア特集/求人）
│       ├── city-slugs.ts               … 市区町村スラッグマッピング
│       ├── prefecture-seo.ts           … 47都道府県固有SEOコンテンツ（intro/highlights/3FAQ）
│       └── symptom-seo.ts              … 30症状固有SEOコンテンツ（intro/causes/treatments/selfCare/3FAQ）
│
├── .env.example                         … 環境変数テンプレート
├── next.config.mjs                      … Next.js設定（セキュリティヘッダー・画像最適化）※withSentryConfigなし
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
| `NEXT_PUBLIC_BASE_URL` | 本番URL（`SITE_URL`定数経由で全ファイル参照） | - | クライアント | ✅ Vercel設定済み |
| `NEXT_PUBLIC_GA_ID` | Google Analytics 4 測定ID | - | クライアント | Vercel のみ |
| `NEXT_PUBLIC_CLARITY_ID` | Microsoft Clarity プロジェクトID | - | クライアント | Vercel のみ |
| `NEXT_PUBLIC_LINE_CHANNEL_ID` | LINE OAuth チャネルID（ログイン用） | 2009692936 | クライアント | ✅ Vercel設定済み（2026-04-07） |
| `LINE_CHANNEL_SECRET` | LINE OAuth チャネルシークレット | (Vercel) | サーバーのみ | ✅ Vercel設定済み（2026-04-07） |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL | - | サーバーのみ | ✅ Vercel設定済み（2026-04-07） |
| `RESEND_API_KEY` | Resend メール送信APIキー | - | サーバーのみ | ✅ Vercel設定済み（2026-04-07） |
| `EMAIL_FROM` | 送信元メールアドレス | - | サーバーのみ | ✅ `CareLink <noreply@carelink-jp.com>`（2026-04-14修正、Resendドメイン検証済み） |
| `CRON_SECRET` | Vercel Cron認証シークレット | - | サーバーのみ | Vercel + .env.local |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN | - | クライアント | ✅ Vercel設定済み（2026-04-07） |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis URL | - | サーバーのみ | ✅ Vercel設定済み（2026-04-07） |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis トークン | - | サーバーのみ | ✅ Vercel設定済み（2026-04-07） |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push VAPID公開鍵 | - | クライアント | Vercel + .env.local |
| `VAPID_PRIVATE_KEY` | Web Push VAPID秘密鍵 | - | サーバーのみ | Vercel + .env.local |
| `LINE_CHANNEL_ACCESS_TOKEN_CARELINK` | LINE Bot Push送信用トークン | - | サーバーのみ | Vercel |
| `LINE_CHANNEL_SECRET_CARELINK` | LINE Webhook署名検証用シークレット | - | サーバーのみ | Vercel |
| `LINE_CHANNEL_ID_CARELINK` | LINE Messaging APIチャネルID | - | サーバーのみ | Vercel |
| `STRIPE_SECRET_KEY` | Stripe秘密鍵（決済処理） | sk_test_ | サーバーのみ | ✅ Vercel設定済み（2026-04-07・テストモード） |
| `STRIPE_WEBHOOK_SECRET` | Stripe Webhook署名検証シークレット | whsec_ | サーバーのみ | ✅ Vercel設定済み（2026-04-07） |
| `STRIPE_PUBLIC_KEY` | Stripe公開鍵 | - | クライアント | コード未使用（不要） |
| `NEXT_PUBLIC_GSC_VERIFICATION_APEX` | Google Search Console apexプロパティ認証トークン（HTMLタグ方式、v8.11追加） | - | クライアント | 任意（Vercel） |
| `SENTRY_TEST_TOKEN` | Sentryテストエラー発火用トークン（`/api/sentry-check?fire=1&token=...`、v8.11追加） | - | サーバーのみ | 任意（Vercel） |
| `GOOGLE_MAPS_API_KEY` | Google Places API キー（GBP管理・施設情報取得・スコア計算・口コミ表示、v8.12追加） | - | サーバーのみ | ✅ Vercel設定済み（v8.12） |

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

# LINE Messaging API（省略時: LINE通知・Webhook無効）
LINE_CHANNEL_ACCESS_TOKEN_CARELINK=your_line_channel_access_token
LINE_CHANNEL_SECRET_CARELINK=your_line_channel_secret_carelink

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

# Google Search Console apex プロパティ用認証トークン（任意、v8.11追加）
# 既存wwwプロパティの認証はlayout.tsxにハードコード済み
# apexプロパティ追加時、GSC「HTMLタグ」方式で取得したcontent値をここに設定
# NEXT_PUBLIC_GSC_VERIFICATION_APEX=xxxxxxxxxxxxxxxxxxxxxxx

# Sentryテストエラー発火用トークン（任意、本番でも安全に動作確認するため、v8.11追加）
# 設定すると /api/sentry-check?fire=1&token=THIS_VALUE でテストエラーがSentryに送られる
# SENTRY_TEST_TOKEN=任意の長い文字列_20文字以上推奨

# Google Maps / Places API キー（GBP管理ページ、v8.12追加）
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
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
| プロジェクトID | `prj_7bTLoEtbUNd5j7r0PbaF5YbCqUaF` |
| 組織ID | `team_n0Nv7nRakSPdNolmmpLbh122` |
| GitHub連携 | `jimuin0/carelink` → main ブランチ自動デプロイ |
| Cron | 5ジョブ（booking-reminder / review-request / daily-summary / customer-segment / sync-google-ratings） |
| Rewrites | `/google7163d69fca9aea21.html` → Google Search Console認証用 |
| フレームワーク | Next.js（自動検出） |
| ビルドコマンド | `next build`（デフォルト） |
| 出力ディレクトリ | `.next`（デフォルト） |

### 5.2.1 Vercel Cron設定（`vercel.json`）

| Cronジョブ | パス | スケジュール（UTC） | JST換算 |
|-----------|------|-------------------|---------|
| 予約リマインド | `/api/cron/booking-reminder` | `0 0 * * *` | 毎日 9:00 JST |
| レビュー依頼 | `/api/cron/review-request` | `0 3 * * *` | 毎日 12:00 JST |
| 日次売上集計 | `/api/cron/daily-summary` | `0 15 * * *` | 毎日 24:00 JST |
| 顧客RFM分析 | `/api/cron/customer-segment` | `0 16 * * 0` | 毎週月曜 1:00 JST（UTC日曜16:00） |
| Google評価同期 | `/api/cron/sync-google-ratings` | `0 18 * * 0` | 毎週日曜 3:00 JST（UTC日曜18:00）。`gbp_place_id`設定済み公開施設の`google_rating`/`google_review_count`を一括更新（v8.12） |

> 全CronジョブはGETメソッドで、`Authorization: Bearer {CRON_SECRET}` ヘッダーで認証。

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

**Phase 7: HPB超え拡張（6テーブル + カラム追加）** ※要DB Migration実行（`booking_menus`は構想のみで未実装）

| テーブル/変更 | 用途 | サイト |
|-------------|------|--------|
| `review_helpful` | 口コミ「役に立った」（review_id + user_id UNIQUE） | 検索 |
| `feature_articles` | 特集記事（タイトル/画像/リンク/sort_order） | 検索・管理 |
| `facility_qa` | 施設Q&A（質問/回答/ステータス/公開フラグ） | 検索・管理 |
| `chat_rooms` | チャットルーム（facility_id + user_id UNIQUE） | マイページ・管理 |
| `chat_messages` | チャットメッセージ（Supabase Realtime） | マイページ・管理 |
| `user_preferred_staff` | 指名スタッフ（user_id + staff_id） | マイページ |
| ~~`booking_menus`~~ | ~~複数メニュー同時予約~~ | **未実装（テーブル・コード共に存在しない）** |
| ALTER `facility_reviews` | `is_verified_visit BOOLEAN`, `photo_urls TEXT[]` 追加 | 検索 |
| ALTER `facility_menus` | `photo_url TEXT` 追加 | 検索・管理 |
| ALTER `staff_profiles` | `nomination_fee INT DEFAULT 0` 追加 | 予約・管理 |

**Phase 8: LINE連携（3テーブル）**

| テーブル | 用途 | サイト |
|---------|------|--------|
| `line_user_links` | ユーザーLINE連携（user_id ↔ line_user_id、NULLable user_id） | マイページ |
| `facility_line_settings` | 施設別LINE通知設定（予約/キャンセル/リマインド） | 管理 |
| `line_notification_logs` | LINE通知送信ログ（booking_id紐付け） | 管理 |

**Phase 9: ダッシュボード強化（3テーブル）**

| テーブル | 用途 | サイト |
|---------|------|--------|
| `daily_revenue_summary` | 日次売上集計（Cronバッチ、facility_id+date UNIQUE） | 管理 |
| `customer_segments` | 顧客RFM分析（VIP/常連/離脱リスク/離脱/新規） | 管理 |
| `facility_notification_settings` | 通知設定（Push/メール各種トグル） | 管理 |

**Phase 10: 鍼灸院・整骨院特化（3テーブル + カラム追加）**

| テーブル/変更 | 用途 | サイト |
|-------------|------|--------|
| `symptoms` | 対応症状マスタ（30症状シード、カテゴリ別） | 検索 |
| `facility_symptoms` | 施設×症状対応表（description付き） | 検索・管理 |
| `facility_certifications` | 資格・認定情報（柔道整復師/はり師等） | 検索・管理 |
| ALTER `facility_menus` | `insurance_covered BOOLEAN`, `insurance_note TEXT`, `insurance_price INT` 追加 | 検索・管理 |
| ALTER `staff_profiles` | `certifications TEXT[]` 追加 | 検索・管理 |

**Phase 11: 決済+紹介（3テーブル + カラム追加）**

| テーブル/変更 | 用途 | サイト |
|-------------|------|--------|
| `facility_cancel_policies` | 店舗別キャンセルポリシー（無料期限/遅延料率/無断料率） | 管理 |
| `referral_codes` | 紹介コード（ユーザー別、8文字コード、使用回数） | マイページ |
| `referral_uses` | 紹介コード使用記録（紹介者/被紹介者、ポイント付与済みフラグ） | マイページ |
| ALTER `bookings` | `payment_status TEXT`, `stripe_payment_intent_id TEXT`, `paid_amount INT`, `points_used INT DEFAULT 0` 追加。CHECK制約: `unpaid/paid/failed/refunded/partial_refund`（v8.10で`failed`追加） | 予約 |
| `stripe_events` | Stripe Webhook 冪等性管理（event.id PK・service_role専用RLS・二重処理防止） | 決済 |
| `facility_jobs` | 施設別求人情報（id PK/facility_id FK→facility_profiles/title/job_type[美容師/看護師/介護士等]/employment_type[正社員/アルバイト/業務委託]/salary_min INT/salary_max INT/salary_note TEXT/description/requirements/benefits/is_seed/created_at/updated_at、v8.11、`/jobs` 一覧+`/jobs/[id]` 詳細+admin/jobs CRUD で利用） | 求人 |
| ALTER `facility_profiles.is_seed` | `BOOLEAN DEFAULT false`（v8.11追加）。`scripts/seed-facilities.mjs` で生成したダミー施設を `scripts/cleanup-seed.mjs` で一括削除するためのフラグ。部分インデックス付き | 検索 |

**Phase 12: GBP（Google ビジネスプロフィール）統合（2テーブル + カラム追加、v8.12）**

| テーブル/変更 | 用途 | サイト |
|-------------|------|--------|
| `gbp_posts` | GBP投稿管理（title/body/post_type/photo_url/cta_type/cta_url/status/scheduled_at/published_at/facility_id） | 管理 |
| `gbp_audit_cache` | GBP診断スコアキャッシュ（facility_id UNIQUE/score/details JSONB/fetched_at） | 管理 |
| ALTER `facility_profiles` | `gbp_place_id TEXT`, `gbp_cid TEXT`, `gbp_connected_at TIMESTAMPTZ`, `google_rating NUMERIC(2,1)`, `google_review_count INTEGER DEFAULT 0` 追加 | 検索・管理 |
| `facility_card_view` (VIEW更新) | `google_rating`, `google_review_count` を含むよう再定義 | 検索 |

### 6.1.1 マイグレーションファイル一覧（29ファイル、`combined_phase2_to_6.sql`を含む）

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
| `20260330_phase_c_infra.sql` | push_subscriptions, facility_card_view（VIEW、検索カード用集約）, 追加インデックス |
| `20260331_data_enrichment.sql` | シードデータ: スタッフ経験年数, スケジュール, ブログ, カタログ, エリア階層 |
| `20260331_push_subscriptions_and_indexes.sql` | push_subscriptions再構築（制約+RLS） |
| `combined_phase2_to_6.sql` | Phase 2-6統合マイグレーション（冪等トランザクション） |
| `20260404_line_integration.sql` | Phase 8: LINE連携（line_user_links/facility_line_settings/line_notification_logs + RLS + インデックス） |
| `20260404_dashboard_enhancement.sql` | Phase 9: ダッシュボード強化（daily_revenue_summary/customer_segments/facility_notification_settings + RLS + インデックス） |
| `20260404_acupuncture_specialization.sql` | Phase 10: 鍼灸院特化（symptoms 30件シード/facility_symptoms/facility_certifications + facility_menus ALTER×3 + staff_profiles ALTER×1） |
| `20260405_booking_conflict_constraint.sql` | 予約競合防止RPC（create_booking_atomic、FOR UPDATEロック） |
| `20260405_stripe_and_policies.sql` | Stripe決済（bookingsにpayment_status/stripe_payment_intent_id/paid_amount追加）+ facility_cancel_policies |
| `20260405_referral_program.sql` | 紹介プログラム（referral_codes/referral_uses） |
| `20260406_rls_authenticated_fixes.sql` | RLS修正: authenticated SELECT権限追加（facility_profiles/menus/photos/reviews/inquiries）+ bookings INSERT権限 + bookings.points_usedカラム追加 |
| `20260407_stripe_events.sql` | Stripe Webhook冪等性用 `stripe_events` テーブル新設（id PK/type/processed_at、service_role専用RLS）+ `bookings.payment_status` CHECK制約に `'failed'` 追加 |
| `20260407_seed_flag_and_jobs.sql` | `facility_profiles.is_seed BOOLEAN DEFAULT false` 追加（`scripts/cleanup-seed.mjs` で一括削除する用フラグ、部分インデックス付き） + `facility_jobs` テーブル新設（id/facility_id FK/title/job_type/employment_type/salary_min INT/salary_max INT/salary_note/description/requirements/benefits/is_seed/created_at/updated_at、求人管理用、RLS有効） |
| `20260417_gbp_integration.sql` | Phase 12: `gbp_posts` テーブル新設（GBP投稿管理）+ `gbp_audit_cache` テーブル新設（診断スコアキャッシュ）+ `facility_profiles` に `gbp_place_id/gbp_cid/gbp_connected_at` 追加（v8.12） |
| `20260417_google_rating_columns.sql` | `facility_profiles` に `google_rating NUMERIC(2,1)/google_review_count INTEGER` 追加 + `facility_card_view` 再定義（google_rating/google_review_count を含む）+ `GRANT SELECT TO anon, authenticated`（v8.12） |

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
  is_public BOOLEAN DEFAULT false,
  -- 拡張カラム（20260326_salons_extend.sql）
  contact_phone TEXT DEFAULT '',
  website TEXT DEFAULT '',
  building_name TEXT DEFAULT '',
  nearest_station TEXT DEFAULT '',
  has_parking BOOLEAN DEFAULT false,
  features TEXT[] DEFAULT '{}',
  photo_urls TEXT[] DEFAULT '{}'    -- 最大7枚
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
  birth_date DATE,                -- DATE型（TEXTではない）
  gender TEXT,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  postal_code TEXT,
  address TEXT,
  job_type TEXT NOT NULL,
  certifications TEXT[],
  experience_years INTEGER,       -- INTEGER型
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
  postal_code TEXT,
  prefecture TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  building TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  access_info TEXT,
  phone TEXT,
  website_url TEXT,
  business_hours JSONB,          -- {"mon": {"open":"10:00","close":"19:00"}, "tue": null, ...}
  regular_holiday TEXT,
  seat_count INTEGER,
  staff_count INTEGER,
  parking BOOLEAN DEFAULT false,
  credit_card BOOLEAN DEFAULT false,
  features TEXT[] DEFAULT '{}',
  rating_avg NUMERIC(2,1) DEFAULT 0,   -- トリガーで自動計算
  rating_count INTEGER DEFAULT 0,       -- トリガーで自動計算
  google_rating NUMERIC(2,1),           -- Google Places API（sync-google-ratings Cronで更新）
  google_review_count INTEGER DEFAULT 0, -- Google口コミ件数
  gbp_place_id TEXT,                    -- Google Place ID（GBP管理画面で設定）
  gbp_cid TEXT,                         -- Google GBP CID
  gbp_connected_at TIMESTAMPTZ,         -- GBP連携日時
  is_seed BOOLEAN DEFAULT false,        -- seedスクリプトで生成したダミー施設フラグ
  main_photo_url TEXT,
  view_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','published','suspended'))
);

ALTER TABLE facility_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read published" ON facility_profiles FOR SELECT TO anon USING (status = 'published');
```

#### facility_menus テーブル

```sql
CREATE TABLE facility_menus (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  facility_id UUID REFERENCES facility_profiles(id) ON DELETE CASCADE NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER,
  price_note TEXT,              -- "要相談" など自由テキスト
  duration_minutes INTEGER,
  is_featured BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  photo_url TEXT,
  insurance_covered BOOLEAN DEFAULT false,
  insurance_note TEXT,
  insurance_price INTEGER
);

ALTER TABLE facility_menus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read menus" ON facility_menus FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM facility_profiles WHERE id = facility_menus.facility_id AND status = 'published'));
```

#### facility_photos テーブル

```sql
CREATE TABLE facility_photos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  facility_id UUID REFERENCES facility_profiles(id) ON DELETE CASCADE NOT NULL,
  photo_url TEXT NOT NULL,
  photo_type TEXT NOT NULL CHECK (photo_type IN ('main','interior','exterior','staff','menu','other')),
  caption TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE facility_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read photos" ON facility_photos FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM facility_profiles WHERE id = facility_photos.facility_id AND status = 'published'));
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

### 6.4.1 handle_new_user()（ユーザー自動プロフィール作成）

```sql
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (id, display_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', ''), NEW.email);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

> auth.users INSERT時に profiles レコードを自動作成。`SECURITY DEFINER`（2026-04-06修正）でRLSバイパス。

### 6.4.2 get_available_slots()（空き枠計算RPC）

```sql
CREATE OR REPLACE FUNCTION get_available_slots(
  p_facility_id UUID, p_staff_id UUID, p_date DATE, p_duration_minutes INT
) RETURNS TABLE(slot_start TIME, slot_end TIME)
LANGUAGE plpgsql AS $$
-- 1. schedule_overridesで例外日（休日/特別時間）チェック
-- 2. staff_schedulesで通常スケジュール取得
-- 3. 30分刻みでスロット生成
-- 4. 既存bookingsとの競合チェック（status NOT IN cancelled/no_show）
-- 5. 空きスロットのみ返却
$$;
```

### 6.4.3 create_booking_atomic()（予約競合防止RPC）

```sql
CREATE OR REPLACE FUNCTION create_booking_atomic(...)
RETURNS UUID
LANGUAGE plpgsql AS $$
-- FOR UPDATEロックで排他制御
-- 同一スタッフ×日時の競合検知 → RAISE EXCEPTION
-- 競合なければINSERT → booking_id返却
$$;
```

### 6.5 RLS（Row Level Security）まとめ

| テーブル | anon SELECT | authenticated SELECT | anon INSERT | 条件 |
|---------|:----------:|:------------------:|:----------:|------|
| salons | ❌ | ❌ | ✅ | LP登録のみ |
| job_seekers | ❌ | ❌ | ✅ | LP登録のみ |
| contacts | ❌ | ❌ | ✅ | LP問い合わせのみ |
| facility_profiles | ✅ | ✅ | ❌ | status='published'のみ（anon+authenticated両方） |
| facility_menus | ✅ | ✅ | ❌ | anon: published施設のみ / authenticated: 全件 |
| facility_photos | ✅ | ✅ | ❌ | anon: published施設のみ / authenticated: 全件 |
| facility_reviews | ✅ | ✅ | ✅ | SELECT: anon=publishedのみ, auth=全件 / INSERT: 誰でも |
| facility_inquiries | ❌ | ✅ | ✅ | anon: 投稿のみ / authenticated: 読み取り+投稿 |

**Phase 2以降のRLS**

| テーブル | SELECT | INSERT/UPDATE | 条件 |
|---------|:------:|:------------:|------|
| profiles | auth.uid()=id | auth.uid()=id | 自分のプロフィールのみ |
| favorites | auth.uid()=user_id | auth.uid()=user_id | 自分のお気に入りのみ（ALL操作） |
| areas | ✅（全員） | - | 公開読み取り |
| staff_profiles / staff_photos | ✅（全員） | - | 公開読み取り |
| coupons / coupon_menus / menu_staff | ✅（全員） | - | 公開読み取り |
| staff_schedules / schedule_overrides | ✅（全員） | - | 公開読み取り |
| bookings | auth.uid()=user_id or facility_member | INSERT: 誰でも / UPDATE: 所有者 or facility_member | 予約閲覧は自分 or 施設メンバー |
| facility_members | auth.uid()=user_id | - | 自分のメンバーシップのみ |
| customer_visits | facility_member | facility_member | 施設メンバーのみ |
| treatment_catalogs | ✅（全員） | facility_member | 公開読み取り / 施設メンバーが管理 |
| blog_posts | is_published=true | facility_member | 公開記事のみ / 施設メンバーが管理 |
| review_replies | ✅（全員） | - | 公開読み取り |
| user_points | auth.uid()=user_id | - | 自分のポイントのみ |
| push_subscriptions | auth.uid()=user_id | auth.uid()=user_id | 自分のサブスクリプションのみ |
| facility_cancel_policies | ✅（全員） | owner/admin | 公開読み取り / オーナーが管理 |
| referral_codes | ✅（全員） | auth.uid()=user_id | 公開読み取り / 自分のコードのみ作成 |

### 6.6 Storage（写真アップロード）

#### バケット設定

| バケット名 | 公開設定 | 用途 |
|-----------|---------|------|
| `carelink-uploads` | Public read（匿名アップロード+公開読取） | 施設写真・プロフィール写真等 |

#### ファイルパス形式

```
carelink-uploads/salons/{uuid}/photo.{ext}
```

#### RLSポリシー（storage.objects）

```sql
CREATE POLICY "Allow anonymous upload" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'carelink-uploads');
CREATE POLICY "Allow public read" ON storage.objects FOR SELECT TO anon USING (bucket_id = 'carelink-uploads');
```

### 6.7 登録データの確認方法

管理画面がないため、登録データは以下の方法で確認:

1. **Supabase Dashboard（推奨）**: `https://supabase.com/dashboard/project/xzafxiupbflvgbarrihe` → Table Editor
2. **Slack通知（リアルタイム）**: フォーム送信のたびに通知
3. **SQL Editor（集計）**: Supabase Dashboard → SQL Editor

---

## 7. 業務フロー（全体像）

### 7.1 施設掲載登録フロー（LP: /salon → セルフオンボーディング）

```
【施設オーナー】/salon → /register
  ├─ Step 1: 基本情報（施設名・業種・代表者・担当者・メール・電話）
  ├─ Step 2: 詳細情報（郵便番号・住所・営業時間・定休日・席数・スタッフ数）
  ├─ Step 3: PR情報（PR文・写真・希望開始日）
  ├─ 同意チェック → 確認ダイアログ
  ├─ Supabase INSERT(salons) + Storage upload + Slack通知
  └─ 完了画面 → 「アカウントを作成して始める」ボタン

【セルフオンボーディング（v8.3）】
  ├─ /auth/signup（facility_name/business_typeをパラメータ保持）
  ├─ メール認証 → /auth/callback → /admin/onboarding
  ├─ POST /api/facility/setup（facility_profiles自動作成+facility_membersにowner登録）
  │   └─ salonsテーブルから登録済みデータを自動引き継ぎ
  ├─ オンボーディングガイド（メニュー/スタッフ/写真/設定への導線）
  └─ admin/settings「公開」ボタン → status=published → 検索結果に表示
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
  └─ StickyBookingBar: 電話 / 今すぐ予約する(→/booking) / 問合せ(→#contact-section)

【管理者】
  ├─ 口コミ: Supabase Dashboardで status を published/hidden で管理
  └─ 問い合わせ: facility_inquiries テーブルで確認
```

### 7.5 オンライン予約フロー（Phase 4: /facility/[slug]/booking）

```
【ユーザー】/facility/[slug]/booking にアクセス（BookingFlow.tsx、4ステップUI）
  ├─ Step 1「メニュー」: メニュー複数選択 + クーポン選択
  ├─ Step 2「スタッフ」: 指名なし（おまかせ）or スタッフ選択（指名料表示）
  │   └─ 指名なし: 全スタッフの空き枠を並列fetch→マージ
  ├─ Step 3「日時」: 60日間カレンダー + 時間帯選択（RPC get_available_slots）
  ├─ Step 4「確認・予約」: 予約内容確認 + 顧客情報入力 + ポイント利用 → 確定
  ├─ POST /api/booking（競合チェック + サーバー側価格計算 + レート制限 3回/5分）
  └─ 予約完了画面（ICSカレンダーダウンロード付き）

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
| `/` | `page.tsx` | ISR(1h) | トップページ |
| `/salon` | `salon/page.tsx` | Static | 施設掲載LP（CTA→/register） |
| `/salon/demo` | `salon/demo/page.tsx` | Static | 管理画面デモページ（全機能紹介、CTA→/register） |
| `/register` | `register/page.tsx` | Client | 施設掲載登録フォーム（'use client'） |
| `/register/complete` | `register/complete/page.tsx` | Client | 施設掲載登録完了（'use client'、useSearchParams+Suspense、ステップ表示→/auth/signup誘導） |
| `/jobs` | `jobs/page.tsx` | Dynamic | 求人一覧ページ（公開施設の求人を集約、JobPosting JSON-LD） |
| `/jobs/[id]` | `jobs/[id]/page.tsx` | Dynamic | 求人詳細（JobPosting+BreadcrumbList JSON-LD、Google for Jobs対応） |
| `/recruit` | `recruit/page.tsx` | Client | 求人掲載登録（'use client'） |
| `/contact` | `contact/page.tsx` | Client | お問い合わせ（'use client'） |
| `/blog` | `blog/page.tsx` | Static | コラム一覧 |
| `/blog/[slug]` | `blog/[slug]/page.tsx` | Static | コラム記事（revalidate=false + generateStaticParams） |
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
| `/ranking` | `ranking/page.tsx` | ISR(1h) | ランキングページ（revalidate=3600） |
| `/ranking/[area]` | `ranking/[area]/page.tsx` | Dynamic | エリア別ランキング |
| `/compare` | `compare/page.tsx` | Client | 施設比較（localStorage比較リスト最大3件横並び、'use client'） |

**SEOエリアページ（動的生成）**

| パス | ファイル | レンダリング | 説明 |
|------|---------|:----------:|------|
| `/[prefectureSlug]` | `[prefectureSlug]/page.tsx` | ISR(1h) | 都道府県ページ（generateStaticParams=47県、revalidate=3600） |
| `/[prefectureSlug]/[secondSlug]` | `[prefectureSlug]/[secondSlug]/page.tsx` | ISR(1h) | 市区町村/業種ページ（generateStaticParams+dynamicParams=true） |
| `/[prefectureSlug]/[secondSlug]/[typeSlug]` | `[prefectureSlug]/[secondSlug]/[typeSlug]/page.tsx` | ISR(1h) | 業種×エリア詳細ページ（revalidate=3600+dynamicParams=true） |
| `/type/[typeSlug]` | `type/[typeSlug]/page.tsx` | ISR(1h) | 業種別グローバルページ（generateStaticParams=8業種、47県への内部リンク+ItemList+FAQPage JSON-LD、v8.11） |

**特集ページ**

| パス | ファイル | レンダリング | 説明 |
|------|---------|:----------:|------|
| `/feature` | `feature/page.tsx` | ISR(1h) | 特集一覧（revalidate=3600） |
| `/feature/[slug]` | `feature/[slug]/page.tsx` | ISR(1h) | 特集詳細（generateStaticParams+revalidate=3600） |
| `/symptom/[slug]` | `symptom/[slug]/page.tsx` | Dynamic | 症状別LP（症状解説200-300字+原因+治療+セルフケア+3FAQ+FAQPage/BreadcrumbList JSON-LD、v8.11強化） |
| `/symptom-checker` | `symptom-checker/page.tsx` | Client | 症状チェッカー（体の部位別症状選択→店舗提案、'use client'、v8.7） |

**認証**

| パス | ファイル | レンダリング | 説明 |
|------|---------|:----------:|------|
| `/auth/login` | `auth/login/page.tsx` | Client | ログイン（メール+LINE+Google、'use client'） |
| `/auth/signup` | `auth/signup/page.tsx` | Client | 新規登録（'use client'） |
| `/auth/forgot-password` | `auth/forgot-password/page.tsx` | Client | パスワードリセット申請（'use client'） |
| `/auth/reset-password` | `auth/reset-password/page.tsx` | Client | パスワード再設定（'use client'） |

**マイページ（認証必須）**

| パス | ファイル | レンダリング | 説明 |
|------|---------|:----------:|------|
| `/mypage` | `mypage/page.tsx` | Dynamic | ダッシュボード |
| `/mypage/profile` | `mypage/profile/page.tsx` | Dynamic | プロフィール編集（アバター写真・LINE連携/解除） |
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
| `/admin/onboarding` | `admin/onboarding/page.tsx` | Dynamic | オンボーディングガイド（施設自動作成+初期設定導線） |
| `/admin/help` | `admin/help/page.tsx` | Dynamic | ヘルプセンター/FAQ（4カテゴリ12問、v8.6） |
| `/admin/bookings` | `admin/bookings/page.tsx` | Dynamic | 予約一覧（ステータスフィルタ） |
| `/admin/bookings/[id]` | `admin/bookings/[id]/page.tsx` | Dynamic | 予約詳細（ステータス変更） |
| `/admin/staff` | `admin/staff/page.tsx` | Dynamic | スタッフ管理 |
| `/admin/staff/[id]/edit` | `admin/staff/[id]/edit/page.tsx` | Dynamic | スタッフ編集 |
| `/admin/staff/[id]/schedule` | `admin/staff/[id]/schedule/page.tsx` | Dynamic | スタッフシフト管理 |
| `/admin/coupons` | `admin/coupons/page.tsx` | Dynamic | クーポン管理 |
| `/admin/coupons/new` | `admin/coupons/new/page.tsx` | Dynamic | クーポン作成 |
| `/admin/coupons/[id]/edit` | `admin/coupons/[id]/edit/page.tsx` | Dynamic | クーポン編集 |
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
| `/admin/jobs` | `admin/jobs/page.tsx` | Dynamic | 求人管理一覧（v8.11） |
| `/admin/jobs/new` | `admin/jobs/new/page.tsx` | Dynamic | 求人新規作成（v8.11） |
| `/admin/jobs/[id]/edit` | `admin/jobs/[id]/edit/page.tsx` | Dynamic | 求人編集（v8.11） |
| `/admin/gbp` | `admin/gbp/page.tsx` | Dynamic | GBP管理（4タブ: Place ID設定・診断スコア43項目・Google口コミ表示・GBP投稿下書き管理、v8.12） |

**API Routes**

| パス | メソッド | 説明 |
|------|---------|------|
| `/api/notify` | POST | Slack通知（Zod検証・レート制限） |
| `/api/booking` | POST | 予約作成（競合チェック・レート制限: 3回/5分） |
| `/api/booking/[id]/cancel` | POST | 予約キャンセル（UUID検証・所有者チェック・メール通知） |
| `/api/booking/[id]/change` | POST | 予約日時変更（UUID検証・競合チェック） |
| `/api/admin/booking-status` | POST | 予約ステータス変更（承認/却下・メール通知） |
| `/api/slots` | GET | 空き枠取得（UUID+日付バリデーション・duration 15-480制限） |
| `/api/favorites` | POST | お気に入りトグル（認証必須） |
| `/api/profile` | PUT | プロフィール更新（Zod検証・認証必須） |
| `/api/salons` | GET | 施設検索（キーワード・業種・エリアフィルタ） |
| `/api/auth/line` | GET | LINE OAuthログイン |
| `/api/auth/line/callback` | GET | LINE OAuthコールバック |
| `/api/booking/complete` | POST | 予約完了処理（ステータス変更+ポイント自動付与+来店履歴記録） |
| `/api/availability` | GET | 月間空き状況取得（○×△カレンダー用、レート制限: 10回/min） |
| `/api/facilities/suggest` | GET | 検索オートコンプリート（施設名・エリア候補） |
| `/api/push/subscribe` | POST | Web Pushサブスクリプション登録 |
| `/api/stations` | GET | 駅検索（StationSearchモーダル用） |
| `/api/cron/booking-reminder` | GET | 予約リマインドCron（CRON_SECRET認証） |
| `/api/admin/gbp/place` | GET/POST | GBP診断スコア取得 / Place ID保存（v8.12） |
| `/api/admin/gbp/posts` | GET/POST/PATCH/DELETE | GBP投稿下書き管理（v8.12） |
| `/api/cron/sync-google-ratings` | GET | Google評価一括同期Cron（v8.12） |
| `/sitemap.xml` | GET | 動的サイトマップ（DB全件） |
| `/robots.txt` | GET | robots.txt（/admin/・/mypage/・/auth/ をdisallow） |

> **Static** = ビルド時に静的HTML生成（CDN配信）
> **Client** = `'use client'`指定のクライアントコンポーネント（CSR、インタラクティブフォーム等）
> **Dynamic** = リクエストごとにサーバー実行（`force-dynamic`または動的データ依存）
> **ISR** = Incremental Static Regeneration（キャッシュ + バックグラウンド再生成、`revalidate=N`）

### 8.2 特殊ページ（loading.tsx / error.tsx / not-found.tsx）

**loading.tsx（56ファイル）**

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
| 管理 (26) | `admin/` `admin/settings/` `admin/menus/` `admin/reviews/` `admin/photos/` `admin/bookings/` `admin/bookings/calendar/` `admin/bookings/[id]/` `admin/blog/` `admin/blog/[id]/edit/` `admin/catalog/` `admin/analytics/` `admin/coupons/` `admin/coupons/[id]/edit/` `admin/customers/` `admin/customers/[email]/` `admin/staff/` `admin/staff/[id]/edit/` `admin/staff/[id]/schedule/` `admin/chat/` `admin/qa/` `admin/features/` `admin/inquiries/` `admin/registrations/` `admin/help/` `admin/onboarding/` |

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
| タブ | `TabNavigation` | 常時: Top/メニュー/Q&A/口コミ(件数)/アクセス。条件付き: スタッフ(件数)/カタログ(件数)/クーポン(件数)/施術情報(鍼灸系のみ) |
| Topタブ | - | 紹介文・おすすめメニュー3件・特徴タグ・基本情報 |
| メニュータブ | `MenuList` | カテゴリ別メニュー一覧（価格・時間） |
| 口コミタブ | `ReviewTab` | 評価サマリー+棒グラフ+口コミ一覧(写真・返信・「役に立った」・来店確認バッジ)+投稿フォーム(写真添付可) |
| Q&Aタブ | `QASection` | 質問一覧+投稿フォーム（サロン回答付き） |
| アクセスタブ | `AccessInfo` | 住所・営業時間・特徴・Google Map |
| お問い合わせ | `InquiryForm` | 名前・メール・電話・メッセージ |
| 固定バー | `StickyBookingBar` | 電話ボタン + **今すぐ予約する**ボタン(→/booking) + 問合せボタン(→#contact-section) |

---

## 9. フォーム・バリデーション

### 9.1 バリデーションライブラリ

| ライブラリ | 用途 |
|-----------|------|
| **Zod** | スキーマ定義・バリデーションルール |
| **React Hook Form** | フォーム状態管理（`mode: 'onTouched'`） |
| **@hookform/resolvers** | Zod ↔ React Hook Form 連携 |

### 9.2 LP: 施設掲載フォーム（3ステップ）

**Step 1: 基本情報**

| フィールド | 必須 | バリデーション |
|-----------|:----:|--------------|
| 施設名 | ✅ | 1〜200文字 |
| 業種 | ✅ | セレクト必須（7業種+その他、max 50） |
| 代表者名 | ✅ | 1〜100文字 |
| 担当者名 | ✅ | 1〜100文字 |
| メールアドレス | ✅ | Email形式、max 254 |
| 電話番号 | ✅ | `/^0\d{1,4}-?\d{1,4}-?\d{3,4}$/` |
| 連絡先電話番号 | - | 同上（空文字許可） |
| Webサイト | - | URL形式、max 2000（空文字許可） |

**Step 2: 詳細情報（全て任意）**: 郵便番号（`/^\d{3}-?\d{4}$/`）/ 住所(500文字) / ビル名(200文字) / 最寄り駅(200文字) / 営業時間 / 定休日 / 席数(0-9999) / スタッフ数(0-9999) / 駐車場(boolean) / 特徴(配列、各50文字、max20個)

**Step 3: PR情報（全て任意）**: PR文（1000文字以内）/ 希望掲載開始日

### 9.3 LP: 求職者登録フォーム（3ステップ）

**Step 1**: 氏名(必須) / フリガナ(必須・カタカナ) / 生年月日 / 性別 / 電話(必須) / メール(必須) / 郵便番号 / 住所
**Step 2**: 職種(必須) / 保有資格(複数選択) / 経験年数 / 学歴 / 前職
**Step 3**: 希望雇用形態(複数選択) / 希望勤務地 / 希望年収 / 自己PR(1000文字以内)

### 9.4 LP: お問い合わせフォーム

名前(必須) / メール(必須) / 電話 / 問い合わせ種別(必須) / 内容(必須)

### 9.5 検索: 口コミ投稿フォーム（ReviewForm）

| フィールド | 必須 | バリデーション |
|-----------|:----:|--------------|
| ニックネーム（reviewer_name） | ✅ | 1文字以上 |
| 技術評価（rating_skill） | ✅ | 1〜5（StarRating、ratingAxis） |
| 接客評価（rating_service） | ✅ | 1〜5 |
| 雰囲気評価（rating_atmosphere） | ✅ | 1〜5 |
| 清潔感評価（rating_cleanliness） | ✅ | 1〜5 |
| 説明評価（rating_explanation） | ✅ | 1〜5 |
| コメント | - | 500文字以内 |

> 5軸評価をインラインZodスキーマ（`reviewSchema`）で検証。`ratingAxis = z.number().min(1).max(5)` ヘルパーで共通化。

### 9.6 検索: 施設お問い合わせフォーム（InquiryForm）

| フィールド | 必須 | バリデーション | autocomplete |
|-----------|:----:|--------------|-------------|
| お名前 | ✅ | 1文字以上 | name |
| メールアドレス | ✅ | Email形式 | email |
| 電話番号 | - | 電話番号形式 | tel |
| お問い合わせ内容（message） | ✅ | 1〜1000文字 | - |

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

### 10.0 全APIルート一覧（35エンドポイント）

**v8.11 で表に新規追加された4個**（2026-04-07/08）:
- `GET /api/health` — 外形監視用ヘルスチェック（DB疎通+応答時間+commit hash返却、200/503、UptimeRobot等対応）
- `GET /api/sentry-check` — Sentry動作確認（`?fire=1&token=SENTRY_TEST_TOKEN`でテストエラー実発火、本番安全）
- `POST/GET /api/admin/jobs` — 求人管理API（POST=作成、GET=施設別一覧）
- `GET/PUT/DELETE /api/admin/jobs/[id]` — 求人詳細API（個別取得・編集・削除）

> `/api/og` は既存（route.tsx）。v8.10で「削除済み」と誤記載→v8.11で訂正。


| # | パス | メソッド | 認証 | レート制限 | 概要 |
|---|------|---------|:----:|-----------|------|
| 1 | `/api/notify` | POST | - | 5回/60秒 | Slack通知（Zod discriminatedUnion検証） |
| 2 | `/api/booking` | POST | 任意 | 3回/5分 | 予約作成（競合チェック(指名なし対応)・サーバー側価格計算(special_price+nomination_fee対応)・ポイント原子的消費・LINE通知） |
| 3 | `/api/booking/[id]/cancel` | POST | 必須 | 10回/60秒 | 予約キャンセル（所有者チェック・メール通知） |
| 4 | `/api/booking/[id]/change` | POST | 必須 | 10回/60秒 | 予約日時変更（pending/confirmedのみ・競合チェック・booking_date+start_time+end_time） |
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
| 15 | `/api/cron/booking-reminder` | GET | CRON | - | 予約リマインドメール（毎日9:00 JST・CRON_SECRET Bearer認証） |
| 16 | `/api/auth/line` | GET | - | - | LINE OAuthリダイレクト（CSRFステートCookie設定） |
| 17 | `/api/auth/line/callback` | GET | - | - | LINE OAuthコールバック（セッション確立） |
| 18 | `/api/line/webhook` | POST | - | - | LINE Messaging Webhook（署名検証・フォロー応答・メッセージ応答） |
| 19 | `/api/cron/daily-summary` | GET | CRON | - | 日次売上集計（前日分をdaily_revenue_summaryに集計） |
| 20 | `/api/cron/customer-segment` | GET | CRON | - | 週次顧客RFM分析（customer_segmentsを更新） |
| 21 | `/api/admin/report` | GET | 必須 | - | 売上レポートCSVエクスポート（期間指定・権限チェック） |
| 22 | `/api/facility/setup` | POST | 必須 | 5回/60秒 | 施設自動作成+facility_membersにowner登録（セルフオンボーディング） |
| 23 | `/api/cron/review-request` | GET | CRON | - | 来店後レビュー依頼（完了24h後にメール+LINE送信） |
| 24 | `/api/payment/checkout` | POST | 必須 | 5回/60秒 | Stripe Checkout Session作成（**所有権検証・サーバー側金額決定(total_price→menu.price)・payment_status=paid拒否**、v8.10で金額改ざん/IDOR修正） |
| 25 | `/api/payment/webhook` | POST | 署名検証 | - | Stripe Webhook（署名検証→`stripe_events`へINSERTで冪等化→`checkout.session.completed`/`payment_intent.payment_failed`/`charge.refunded`を処理、v8.10で冪等性+failedハンドラ追加） |
| 26 | `/api/account/delete` | POST | 必須 | 5回/60秒 | アカウント+全データ削除（個人情報保護法対応） |
| 27 | `/api/referral` | GET/POST | 必須 | 5回/60秒 | 紹介コード取得/使用（双方ポイント付与） |
| 28 | `/api/health` | GET | - | - | 外形監視用ヘルスチェック（DB疎通+応答時間+commit hash返却、200/503、UptimeRobot等対応、v8.11） |
| 29 | `/api/sentry-check` | GET | - | - | Sentry動作確認（`?fire=1&token=SENTRY_TEST_TOKEN`でテストエラー実発火、本番安全、v8.11） |
| 30 | `/api/admin/jobs` | POST/GET | 必須 | 5回/60秒 | 求人管理（POST=作成、GET=施設別一覧、v8.11） |
| 31 | `/api/admin/jobs/[id]` | GET/PUT/DELETE | 必須 | 5回/60秒 | 求人詳細（個別取得・編集・削除、v8.11） |
| 32 | `/api/og` | GET | - | - | 動的OG画像生成（@vercel/og、`?title=...&subtitle=...`） |
| 33 | `/api/admin/gbp/place` | GET/POST | 必須 | - | GBP診断スコア取得（GET: Places API呼び出し・43項目スコア計算・gbp_audit_cacheに保存・google_rating/google_review_countをfacility_profilesに反映）/ Place ID保存（POST）、v8.12 |
| 34 | `/api/admin/gbp/posts` | GET/POST/PATCH/DELETE | 必須 | - | GBP投稿下書き管理（GET=一覧、POST=作成、PATCH=更新、DELETE=削除、v8.12） |
| 35 | `/api/cron/sync-google-ratings` | GET | CRON | - | 全施設Google評価一括同期（gbp_place_id設定済み公開施設のgoogle_rating/google_review_countをPlaces APIから更新、毎週日曜3:00 JST、v8.12） |

> **補足**: 上記35エンドポイント中、`/api/og` はroute.tsx（`@vercel/og`使用）。CronエンドポイントはCRON_SECRET Bearer認証必須。

### 10.1 POST /api/notify

Slack Incoming Webhook を使ったフォーム送信通知。

**エンドポイント**: `POST /api/notify`

**Zodバリデーション**: `z.discriminatedUnion('type', [...])` で4つのペイロードタイプを厳密に検証。

**対応タイプ**:

| type | 用途 | サイト |
|------|------|--------|
| `salon` | 施設掲載登録 | LP |
| `contact` | 一般お問い合わせ | LP |
| `facility_inquiry` | 施設宛お問い合わせ | 検索 |
| `facility` | 施設掲載申請 | LP |

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

### 11.2 検索コンポーネント（`components/search/` — 17個）

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
| `MobileFilterButton` | モバイル絞り込みボタン（'use client'、dialog.showModal()、v8.9でsearch/page.tsxから分離） |
| `Pagination` | ページネーション。省略記号(...) + aria-current="page" + aria-label |

### 11.3 施設詳細コンポーネント（`components/facility/` — 31個）

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
| `StickyBookingBar` | 固定下部バー。電話(tel:リンク) + 今すぐ予約する(→/booking) + 問合せ(#contact-sectionスクロール)。3ボタン構成 |
| `BeforeAfterSlider` | Before/After画像比較スライダー。ポインタードラッグ+キーボード矢印対応。role="slider"。ファイルは`catalog/`配下 |
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
| `FacilitySelector` | `admin/FacilitySelector.tsx` | マルチ施設セレクター（'use client'、onChange→window.location遷移、v8.9でlayoutから分離） |
| `AuthButton` | `auth/AuthButton.tsx` | 認証ボタン（ログイン/ログアウト切替） |
| `BookingFlow` | `booking/BookingFlow.tsx` | 予約フロー全体（4ステップ: menu→staff→datetime→confirm）。指名料自動加算・クーポン適用・ポイント利用・指名なし並列fetch対応 |
| `StaffSalesTab` | `admin/analytics/StaffSalesTab.tsx` | スタッフ別売上バーグラフ（月間） |
| `JapanRegionMap` | `home/JapanRegionMap.tsx` | 日本地図エリアマップ（8地方クリック対応） |
| `HomeBelowFold` | `home/HomeBelowFold.tsx` | Below-fold遅延ロード（`dynamic()+ssr:false`、特集バナー/新着サロン/お悩みナビ/エリアマップ/CTAをクライアント側遅延ロード） |
| `StickySignupCta` | `home/StickySignupCta.tsx` | スクロール時スティッキーCTAバナー（未ログインユーザーのみ表示、sessionStorage dismissed管理） |
| `SafeHtmlContent` | `seo/SafeHtmlContent.tsx` | HTMLサニタイザー（許可タグのみ通す） |
| `RelatedLinks` | `seo/RelatedLinks.tsx` | 関連リンク一覧（エリア・業種） |
| `PushPermissionBanner` | `push/PushPermissionBanner.tsx` | Web Push通知許可バナー |
| `RealtimeBookingListener` | `admin/RealtimeBookingListener.tsx` | Supabase Realtimeで新規予約トースト通知（v8.1） |
| `RevenueChart` | `admin/RevenueChart.tsx` | 日別売上折れ線グラフ（recharts、v8.1） |
| `BookingTrendChart` | `admin/BookingTrendChart.tsx` | 予約数推移バーチャート（recharts、v8.1） |
| `CustomerSegmentChart` | `admin/CustomerSegmentChart.tsx` | 顧客セグメント円グラフ（VIP/常連/離脱リスク/離脱/新規、v8.1） |
| `RepeatRateCard` | `admin/RepeatRateCard.tsx` | リピート率表示カード（v8.1） |
| `NotificationSettings` | `admin/NotificationSettings.tsx` | 通知設定トグルUI（Push/メール、v8.1） |
| `InsuranceMenuBadge` | `facility/InsuranceMenuBadge.tsx` | 保険適用バッジ+自己負担額表示（v8.2） |
| `SymptomList` | `facility/SymptomList.tsx` | カテゴリ別対応症状一覧（v8.2） |
| `CertificationList` | `facility/CertificationList.tsx` | 資格・認定一覧（v8.2） |
| `ReviewSummary` | `facility/ReviewSummary.tsx` | 口コミAI要約（3件以上で自動サマリー生成、v8.7） |
| `CancelPolicySettings` | `admin/CancelPolicySettings.tsx` | キャンセルポリシー設定UI（v8.5） |
| `ViewCountCard` | `admin/ViewCountCard.tsx` | 店舗ページ閲覧数カード（v8.4） |
| `JobForm` | `admin/JobForm.tsx` | 求人登録・編集フォーム（title/job_type/employment_type/salary_min/salary_max/salary_note/description/requirements/benefits、Zod検証、`/admin/jobs/new` と `/admin/jobs/[id]/edit` で利用、v8.11） |

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
| 全ページ（layout.tsx） | `WebSite` | サイト名・URL・説明・publisher・potentialAction(SearchAction) |
| 全ページ（layout.tsx） | `Organization` | 運営組織名・URL・ロゴ・説明・founder(Person: 神原良祐)・address(大阪府堺市) |
| 全ページ（layout.tsx） | `FAQPage` | よくある質問4問（mainEntity配列） |
| `/salon`（layout.tsx） | `BreadcrumbList` | トップ → 施設・サロンの方 |
| `/recruit`（layout.tsx） | `BreadcrumbList` | トップ → 求人掲載 |
| `/facility/[slug]` | `LocalBusiness` | 施設名・住所・電話・評価・営業時間・dateModified |
| `/facility/[slug]` | `BreadcrumbList` | トップ → 施設名 |
| `/facility/[slug]/blog/[postSlug]` | `BlogPosting` | 記事タイトル・著者・公開日・画像・本文（JSON-LD） |

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
// export const dynamic = 'force-dynamic'; export const revalidate = 0;
// → 完全動的（CDN静的キャッシュ回避、v8.11で追加）
// 静的ページ + businessTypeTopPages(8) + 全published施設 + 症状 + 求人を動的に生成
```

| URL | 頻度 | 優先度 |
|-----|------|:------:|
| `/` | weekly | 1.0 |
| `/search` | daily | 0.9 |
| `/salon` | weekly | 0.9 |
| `/ranking` | daily | 0.7 |
| `/blog` | weekly | 0.6 |
| `/recruit` | monthly | 0.6 |
| `/salon/demo` | monthly | 0.6 |
| `/symptom-checker` | weekly | 0.7 |
| `/contact` | monthly | 0.5 |
| `/privacy`, `/terms` | monthly | 0.3 |
| `/{prefectureSlug}` (47件) | daily | 0.8 |
| `/{prefectureSlug}/{businessTypeSlug}` (376件) | daily | 0.7 |
| `/{prefectureSlug}/{citySlug}` (283件) | daily | 0.7 |
| `/{prefectureSlug}/{citySlug}/{typeSlug}` (主要10県のみ) | daily | 0.6 |
| `/facility/{slug}` | weekly | 0.8（DB全件） |
| `/symptom/{slug}` | weekly | 0.7（DBから動的） |
| `/feature/{slug}` | weekly | 0.6（DBから動的） |
| `/blog/{slug}` | monthly | 0.6（51記事） |
| `/type/{typeSlug}` | weekly | 0.8（8業種グローバルページ） |
| `/jobs` | daily | 0.7 |
| `/jobs/{id}` | weekly | 0.7（公開施設の求人のみ） |

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
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | HSTS強制 |
| `Content-Security-Policy` | 下記参照 | XSS/インジェクション防止 |

**CSPディレクティブ詳細（`next.config.mjs`）:**

| ディレクティブ | 値 | 備考 |
|--------------|-----|------|
| `default-src` | `'self'` | |
| `script-src` | `'self' 'unsafe-inline'` + GTM/GA/Clarity/Vercel | 外部スクリプト許可 |
| `style-src` | `'self' 'unsafe-inline'` | v8.7でfonts.googleapis.com削除済み |
| `font-src` | `'self'` | v8.7でfonts.gstatic.com削除済み |
| `connect-src` | `'self'` + Supabase/GA/Clarity/Vercel/LINE/Upstash/Sentry/zipcloud | LINE: `access.line.me` `api.line.me`、郵便番号: `zipcloud.ibsnet.co.jp` |
| `img-src` | `'self' data: https: blob:` | |
| `object-src` | `'none'` | |

### 13.2 認証・認可セキュリティ

- **Supabase Auth（PKCE）**: `@supabase/ssr` によるCookie対応認証
- **4種類のクライアント**:
  - `supabase.ts`: 匿名クライアント（公開データ読み取りのみ）
  - `supabase-browser.ts`: ブラウザ用Cookie対応クライアント
  - `supabase-server.ts`: サーバー用匿名クライアント（公開データ読み取り専用、書き込み不可）
  - `supabase-server-auth.ts`: サーバー用認証Cookie対応クライアント
- **middleware.ts**: トークン自動リフレッシュ + 保護ルート（/mypage/*, /admin/*）。`/admin/onboarding`は除外（施設作成前のオーナーがアクセスするため）
- **notFound()ガード**: 全admin/mypageページでuser/membershipのnullチェック（非null assertionゼロ）
- **facility_members権限チェック**: 管理画面は施設メンバーのみアクセス可

### 13.3 データベースセキュリティ

- **RLS**: 全テーブルで適切なポリシー設定（Phase 1〜6の全テーブル）
- **admin用RLS**: facility_membersのroleベースアクセス制御
- **anon key**: RLSにより操作制限。検索側はSELECTのみ、LP側はINSERTのみ
- **サーバーサイドクエリ**: 公開データは `supabase-server.ts`、認証データは `supabase-server-auth.ts` 経由

### 13.4 APIセキュリティ

- **CSRF保護**: Origin/Refererヘッダー検証（`src/lib/csrf.ts`）。トークンベースではなく、リクエスト元ドメインとHostヘッダーの一致を確認。不一致時は403+Sentryログ。対象: 全POST/PUT/DELETEエンドポイント（booking, profile, favorites, push/subscribe, admin/booking-status, notify）
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
- **メッセージ長制限**: お問い合わせフォームは1000文字以内（InquiryForm）/ Slack通知データは2000文字以内

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
| Primary | `--primary` | `#0284C7` | sky-600 |
| Primary Dark | `--primary-dark` | `#0369A1` | sky-700（ホバー） |
| Care Pink | `--care-pink` | `#EC4899` | pink-500 |
| Care Green | `--care-green` | `#059669` | emerald-600 |
| Care Indigo | `--care-indigo` | `#6366F1` | indigo-500 |
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

- **システムフォント**: `globals.css` bodyに設定
  - `-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", Meiryo, "Yu Gothic", sans-serif`
  - macOS/iOS: Hiragino Sans（最優先）
  - Android/Linux: Noto Sans JP（OSプリインストール）
  - Windows: Meiryo / Yu Gothic
- v7.6で`next/font/google` Noto Sans JP削除（191KBレンダリングブロックCSS除去、PageSpeed +25点）

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
| `/privacy` | 2026年3月19日 | 事業者情報・取得情報（外部認証含む）・利用目的・第三者提供・**業務委託先5社の明示（Supabase/Vercel/Google/Microsoft/LINEヤフー）**・**外国にある第三者提供（個情法28条）**・安全管理措置（組織/人的/物理/技術の4分類）・開示等請求・Cookie・苦情申出先（個人情報保護委員会）。v8.10で28条対応・苦情窓口・安全管理措置を追記 |
| `/terms` | 2026年3月19日 | サービス概要・利用条件・禁止事項・免責・準拠法（大阪地裁） |
| `/legal` | 2026年3月26日 | 特定商取引法に基づく表記。事業者名/代表者/所在地/電話・メール（請求時開示）/サービスURL/販売価格/必要料金/支払方法（Visa/Master/JCB/AMEX/Diners）/支払時期/提供時期/申込有効期限/返品特約（キャンセルポリシー）/動作環境。v8.10で必須項目を補完 |

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
| `lib/__tests__/constants.test.ts` | 15 | UUID_REGEX、prefectures 47、businessTypes、regionGroups、dayOrder/dayLabels、SITE_URL |
| `lib/__tests__/csrf.test.ts` | 8 | CSRF検証 |
| `lib/__tests__/rate-limit.test.ts` | 3 | in-memoryフォールバック |
| `lib/__tests__/rate-limit-advanced.test.ts` | 4 | window expiry、limit=0、empty IP、checkRateLimitフォールバック |
| `lib/__tests__/email.test.ts` | 11 | メール送信テスト |
| `lib/__tests__/email-utils.test.ts` | 14 | メールユーティリティ |
| `lib/__tests__/facilities.test.ts` | 17 | 施設DBクエリ |
| `lib/__tests__/staff.test.ts` | 6 | スタッフDBクエリ |
| `lib/__tests__/coupons.test.ts` | 9 | クーポンDBクエリ |
| `lib/__tests__/push.test.ts` | 4 | Web Push送信 |
| `lib/__tests__/seo-constants.test.ts` | 21 | prefectureSlugs、businessTypeSlugs、変換関数 |
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
| 検索データがダミー | Phase 1シードの10施設はダミー。実データは3施設のみ |
| GPS検索がJS側計算 | PostGIS未使用。haversine距離計算をJS側で実行（500件上限→10km以内フィルタ）。大規模データ時はPostGIS移行推奨 |
| ~~NEXT_PUBLIC_BASE_URL未設定~~ | ✅ Vercel環境変数設定済み（v8.9検証時に確認） |
| ~~スタッフスケジュール未設定2名~~ | ✅ 2026-04-07解消（與那城琴美@イマイビル+藤田裕@鍼灸院、Mon-Sat 10-19/Mon-Sat 09-13/18追加） |
| ~~Resend APIキー未設定~~ | ✅ 2026-04-07設定済み。2026-04-14に `carelink-jp.com` ドメイン検証完了（DKIM/SPF）、送信元 `noreply@carelink-jp.com` に切替済み |
| ~~Slack Webhook未設定~~ | ✅ 2026-04-07設定済み（アプリ名「carelink」） |
| Vercel未設定の環境変数 | なし（2026-04-07時点で全主要環境変数設定完了。Stripeはテストモード、本番化はStripe審査後） |
| ~~recruitページのバグ~~ | ✅ 2026-04-07修正（`facilities`→`salons`、`description`→`pr_text`に変更） |
| ~~Supabase Auth Site URL未更新~~ | ✅ 設定済み（`https://www.carelink-jp.com`） |

### 21.2 施設獲得（営業計画）

**戦略**: HPBに月額を払っている小規模サロン/治療院に「同機能が完全無料」を訴求。HPBが弱い鍼灸院・整骨院を最優先ターゲットとする。

**ターゲットリスト（豊中エリア、2026-04-04作成）**

| # | 施設名 | 業種 | 最寄り駅 | 優先度 | 備考 |
|---|--------|------|---------|:------:|------|
| 1 | 小島鍼灸整骨院 | 鍼灸整骨 | 豊中駅3分 | **高** | 土日祝診療 |
| 2 | ジオ鍼灸整骨院 | 鍼灸整骨 | 豊中駅2分 | **高** | 祝日受付 |
| 3 | なごみ鍼灸整骨院 とよなか院 | 鍼灸整骨 | 豊中駅3分 | **高** | 筋膜専門 |
| 4 | ひなた鍼灸整骨院 | 鍼灸整骨 | 上新田 | **高** | キッズスペース |
| 5 | 緑地公園鍼灸整骨院 | 鍼灸整骨 | 緑地公園 | **高** | 産後矯正 |
| 6 | 東豊中まろん鍼灸整骨院 | 鍼灸整骨 | 東豊中 | **高** | 口コミ高評価 |
| 7 | コタニ鍼灸整骨治療院 | 鍼灸整骨 | 豊中 | 高 | 交通事故治療 |
| 8 | みずひ鍼灸整骨院 | 鍼灸整骨 | 豊中 | 高 | - |
| 9 | ビューティーアイラッシュ 豊中駅前店 | まつげ | 豊中駅1分 | 中 | チェーン店 |
| 10 | NICE EYELASH 豊中店 | まつげ | 豊中 | 中 | パリジェンヌ特化 |
| 11 | E'CREA 豊中店 | まつげ | 豊中 | 中 | まつげパーマ専門 |
| 12 | momo 豊中店 | まつげ | 豊中 | 中 | フラットラッシュ専門 |

> 1-8の鍼灸院・整骨院が最優先（HPBが弱い分野、CareLink差別化ポイント）。9-12のまつげサロンはHALの競合のため関係性考慮。

**目標**: 豊中・堺エリアで30-50施設掲載

### 21.3 HPB差別化開発計画（v8.0〜v8.7 ✅ 全Phase完了）

HPBにない機能を開発し、店舗獲得の武器とする。**全5フェーズ実装完了（2026-04-05）。**

| Phase | バージョン | 内容 | 状態 |
|-------|----------|------|:----:|
| v8.0-8.2 | LINE/Dashboard/鍼灸 | LINE連携・recharts分析・症状検索 | ✅ |
| v8.3 | オンボーディング+LP | セルフ店舗作成・HPB比較LP・営業資料5種 | ✅ |
| v8.4 | 全統合 | 作ったコンポーネント13箇所を実ページに統合 | ✅ |
| v8.5 (Phase 1+2) | 動くプロダクト+決済 | 予約競合RPC・レビュー依頼Cron・Stripe・キャンセルポリシー・アカウント削除・医療広告 | ✅ |
| v8.6 (Phase 3) | 成長エンジン | 紹介プログラム・ポイント値引き・RFM自動メール・リピート予約・ヘルプセンター | ✅ |
| v8.7 (Phase 4+5) | 差別化+運用品質 | 症状チェッカー・レビュー要約・Googleカレンダー・CSVエクスポート・CSP修正・rate limiting | ✅ |

> 詳細ロードマップ: [TOP-ROADMAP.md](./TOP-ROADMAP.md)（130タスク）

#### フェーズ1: LINE予約連携（v8.0） ✅ 完了

HPBにはないLINE連携。salon-absence-systemの技術を転用。

**DBスキーマ追加:**
- `line_user_links`: ユーザーのLINE連携（user_id ↔ line_user_id）
- `facility_line_settings`: 施設別LINE通知設定（予約/キャンセル/リマインド）
- `line_notification_logs`: 通知ログ

**API追加:**
- `POST /api/line/webhook` — LINE Webhook受信（署名検証）
- `POST /api/line/link` — CareLink↔LINEアカウント連携
- `POST /api/line/notify` — LINE Pushメッセージ送信（内部API）

**UI変更:**
- マイページに「LINE連携」ボタン（LIFF Login）
- admin/settingsに「LINE通知設定」セクション
- 予約完了ページに「LINEでリマインド受け取る」導線

**環境変数:** `LINE_CHANNEL_ACCESS_TOKEN_CARELINK`, `LINE_CHANNEL_SECRET_CARELINK`, `NEXT_PUBLIC_LINE_LIFF_ID`

**新規lib:** `src/lib/line.ts` — Push送信ユーティリティ（salon-absence-systemの`line_utils.py`相当）

**注意:** salon-absence-system用LINEチャネルとは別チャネルを作成（Webhook URLは1チャネル1つのため）

#### フェーズ2: ダッシュボード強化（v8.1） ✅ 完了

施設オーナーが「HPBよりCareLink使いたい」と思えるレベルに。

**DBスキーマ追加:**
- `daily_revenue_summary`: 日次売上集計（Cronバッチ）
- `customer_segments`: 顧客RFM分析（VIP/常連/離脱リスク/離脱）
- `facility_notification_settings`: 通知設定（Push/メール）

**API追加:**
- `POST /api/cron/daily-summary` — 日次集計Cron
- `POST /api/cron/customer-segment` — 週次RFM分析Cron
- `GET /api/admin/report` — CSV/PDFエクスポート

**新規コンポーネント:**
- `RealtimeBookingListener.tsx` — Supabase Realtimeで新規予約をリアルタイム表示
- `RevenueChart.tsx` — 日別売上折れ線グラフ（recharts）
- `CustomerSegmentChart.tsx` — 顧客セグメント円グラフ
- `BookingTrendChart.tsx` — 予約数推移
- `RepeatRateCard.tsx` — リピート率表示

**既存強化:**
- admin/bookingsにRealtimeサブスクリプション追加（ページリロードなしで新規予約表示）
- キャンセル時・口コミ投稿時のPush通知追加
- admin/settingsに通知設定UI追加

**依存追加:** `recharts`（チャートライブラリ、dynamic import + ssr:false）

#### フェーズ3: 鍼灸院・整骨院特化（v8.2） ✅ 完了

HPBが弱い鍼灸院・整骨院向け機能。CareLink独自の差別化。

**DBスキーマ追加:**
- `symptoms`: 対応症状マスタ（腰痛/肩こり/膝痛等、30-50件）
- `facility_symptoms`: 施設×症状対応表
- `facility_certifications`: 資格・認定情報（柔道整復師/はり師/きゅう師等）
- ALTER `facility_menus`: `insurance_covered BOOLEAN`, `insurance_note TEXT`, `insurance_price INT` 追加
- ALTER `staff_profiles`: `certifications TEXT[]` 追加

**検索拡張:**
- `searchFacilities()`に`symptom`/`insurance`パラメータ追加
- SearchFiltersに「症状から探す」フィルタ（鍼灸院選択時のみ表示）
- 「保険適用メニューあり」チェックボックス

**新規コンポーネント:**
- `InsuranceMenuBadge.tsx` — メニュー一覧で「保険適用」バッジ+自己負担額表示
- `SymptomList.tsx` — 対応症状一覧
- `CertificationList.tsx` — 資格・認定一覧

**新規ページ:**
- `src/app/symptom/[slug]/page.tsx` — 症状別LP（SEO用、例: `/symptom/low-back-pain`）

**管理画面拡張:**
- admin/menusに「保険適用」トグル+自己負担額入力
- admin/settingsに「対応症状」「資格情報」管理セクション

#### 技術的注意事項

- LINEチャネル分離: salon-absence-system用と別チャネル必須
- Vercel Cronプラン制限: Hobbyは1日1回、Proなら自由
- rechartsはdynamic import + ssr:falseでadmin画面のみロード
- facility_menusへのカラム追加: `DEFAULT false`で既存データ影響なし

### 21.4 その他の開発予定

| 優先度 | 機能 | 説明 |
|:------:|------|------|
| 中 | Supabase Auth Site URL | carelink-jp.comに更新（ブラウザで手動） |
| 中 | 職業紹介事業届出 | 届出取得後にマッチング機能実装 |
| 低 | PostGIS移行 | GPS検索のDB側距離計算（スケール対策） |
| 低 | E2Eテスト | Playwright導入 |

### 21.5 実データ移行状況（2026-04-07時点）

3施設の実データ移行済み:

| 施設 | facility_id | メニュー | スタッフ | スケジュール | クーポン |
|------|------------|:-------:|:-------:|:----------:|:-------:|
| ハル 豊中本店（HAL） | 130830f4 | 28 | 3 | 3名分 ✅ | 10 |
| ハル イマイビル店（HAL） | 7eab63f1 | 28 | 3 | 3名分 ✅（v8.9で完了） | 10 |
| 訪問専門 神原鍼灸院 | 906ef10d | 2 | 2 | 2名分 ✅（v8.9で完了） | - |

**facility_members（管理権限）**: 3施設ともowner権限でuser `d90f83a6`（tokuhal.jimuin0@gmail.com）に紐付け済み（2026-04-06設定）

### 21.5.1 ローンチ前 残タスク（2026-04-07時点）

| 優先度 | タスク | 内容 |
|:---:|------|------|
| 高 | Stripe 本番化 | テストモード（sk_test_）→ 本番モード（sk_live_）切替。審査通過後にVercelの`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`をlive用に入れ替え、本番Webhookエンドポイント再登録。コードがハンドリングする3イベント（`checkout.session.completed` / `payment_intent.payment_failed` / `charge.refunded`）を最低限購読すること |
| 高 | Google Search Console サイトマップ送信 | `https://carelink-jp.com/sitemap.xml` をGSCに登録（`/compare` `/legal` `/register` 等v8.10追加分含む） |
| 高 | Supabase Auth Site URL 更新 | Supabase Dashboard → Auth → URL Configuration を `https://carelink-jp.com` に統一 |
| 中 | 実データ投入拡大 | 3施設→目標30施設。写真アップロード・メニュー/スタッフ・営業時間の充実 |
| ~~中~~ | ~~Resend ドメイン認証~~ | ✅ 2026-04-14完了。`carelink-jp.com` Resend verified + Cloudflare DNS(DKIM/SPF)追加 + Supabase Auth カスタムSMTP設定済み |
| 低 | LINE OAuth コールバックURL最終確認 | `https://carelink-jp.com/api/auth/callback/line` がLINE Developers Consoleに登録済みか再確認 |

### 21.6 SEOブログ

合計20本のSEO記事を投稿済み:

| 施設 | 記事数 |
|------|:------:|
| ハル 豊中本店 | 7 |
| ハル イマイビル店 | 6 |
| 訪問専門 神原鍼灸院 | 7 |

---

## 型定義一覧（`src/types/index.ts`）

**Phase 1: LP + 検索**

| 型名 | 用途 | サイト |
|------|------|--------|
| `Salon` | 施設掲載登録データ | LP |
| `JobSeeker` | 求職者登録データ | LP |
| `Contact` | お問い合わせデータ | LP |
| `Facility` | 施設公開プロフィール（全カラム）。v8.12追加: `google_rating: number \| null`, `google_review_count: number`, `gbp_place_id: string \| null`, `gbp_cid: string \| null` | 検索 |
| `FacilityCardData` | 検索結果カード用（軽量版）。v8.12追加: `google_rating: number \| null`, `google_review_count: number` | 検索 |
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
| `searchFacilities(params)` | SearchParams | 施設検索（20件/ページ、ILIKE、GPS距離検索対応） |
| `getPopularFacilities(limit)` | limit(default 6) | 人気施設取得（rating_count降順） |
| `getSimilarFacilities(...)` | facilityId, businessType, prefecture, limit | 類似施設取得（同業種・同エリア） |
| `getNearbyFacilities(...)` | facilityId, prefecture, city, limit | 近隣施設取得（同市区町村） |
| `getLatestFacilities(limit)` | limit(default 6) | 新着施設取得 |
| `getFacilityBySlug(slug)` | slug | 施設詳細取得 |
| `getFacilityMenus(facilityId)` | UUID | メニュー取得（sort_order順） |
| `getFacilityPhotos(facilityId)` | UUID | 写真取得（sort_order順） |
| `getFacilityReviews(facilityId)` | UUID | 口コミ取得（published, 新しい順） |
| `getAvailableFacilityIds(...)` | facilityIds, dateStr, timeSlot? | 日時指定検索用（空き施設IDセット取得） |
| `getMonthlyBookingCounts(...)` | facilityIds | 月間予約数取得（人気順ソート用） |

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
| `getCouponsByMenuId(menuId)` | UUID | メニューに紐付くクーポン |
| `hasCoupons(facilityId)` | UUID | クーポン有無チェック |

**予約関連（API Route内に直接実装、`bookings.ts`は存在しない）**

| API Route | 用途 |
|-----------|------|
| `POST /api/booking` | 予約作成（競合チェック付き） |
| `POST /api/booking/[id]/cancel` | 予約キャンセル |
| `POST /api/booking/[id]/change` | 予約日時変更 |

**`src/lib/schedules.ts`**

| 関数 | 引数 | 用途 |
|------|------|------|
| `getStaffSchedules(staffId)` | UUID | 週間シフト取得 |
| `getAvailableSlots(...)` | facilityId, staffId, date, durationMinutes | 空き枠計算（RPC） |

**`src/lib/user.ts`**

| 関数 | 引数 | 用途 |
|------|------|------|
| `getUserProfile()` | - | ログインユーザーのプロフィール |
| `updateUserProfile(updates)` | Partial\<Profile\> | プロフィール更新 |
| `getUserFavorites()` | - | お気に入り一覧（施設カードデータ付き） |
| `toggleFavorite(facilityId)` | UUID | お気に入りトグル |
| `checkFavorite(facilityId)` | UUID | お気に入り状態チェック |

**`src/lib/areas.ts`**

| 関数 | 引数 | 用途 |
|------|------|------|
| `getAreasByParent(parentId)` | parentId \| null | 子エリア取得 |
| `getAreaBySlug(slug)` | slug | エリア詳細取得 |
| `getAreaBreadcrumb(area)` | Area | パンくずリスト生成 |

**`src/lib/catalogs.ts` / `src/lib/blog.ts` / `src/lib/rankings.ts`**

| 関数 | 用途 |
|------|------|
| `getCatalogsByFacility(facilityId)` | ヘアカタログ一覧 |
| `getBlogsByFacility(facilityId)` | ブログ記事一覧 |
| `getBlogPost(facilityId, slug)` | ブログ記事詳細 |
| `getRankedFacilities(prefecture?, limit)` | ランキング（評価順、default 20件） |

**`src/lib/push.ts`**

| 関数 | 用途 |
|------|------|
| `sendPushToUser(userId, payload)` | 特定ユーザーへWeb Push送信 |
| `sendPushToFacilityOwners(facilityId, payload)` | 施設オーナー全員へPush送信 |

**`src/lib/rate-limit.ts`**

| エクスポート | 用途 |
|------------|------|
| `bookingRateLimit` | Upstash Ratelimit（3回/5分、sliding window） |
| `notifyRateLimit` | Upstash Ratelimit（5回/60秒、sliding window） |
| `mutationRateLimit` | Upstash Ratelimit（10回/60秒、sliding window） |
| `inMemoryRateLimit(ip, limit, windowMs, prefix)` | Upstash未設定時のフォールバック |
| `checkRateLimit(limiter, ip, fallbackLimit, fallbackWindowMs, prefix)` | 統合チェック関数（Redis→in-memory自動切替） |

**`src/lib/line.ts`（v8.0）**

| 関数 | 用途 |
|------|------|
| `sendLinePush(lineUserId, messages)` | LINE Pushメッセージ送信（リトライ付き） |
| `sendLineText(lineUserId, text)` | テキストメッセージ送信（簡易版） |
| `sendBookingConfirmation(lineUserId, booking)` | 予約確認LINE通知 |
| `sendBookingCancellation(lineUserId, booking)` | キャンセルLINE通知 |
| `sendBookingReminder(lineUserId, booking)` | リマインドLINE通知 |
| `verifyLineSignature(body, signature)` | Webhook署名検証（HMAC-SHA256） |
| `sendLineReply(replyToken, messages)` | Reply送信（Webhook応答用） |

**`src/lib/admin.ts`**

| 関数 | 用途 |
|------|------|
| `getCustomerVisits(facilityId, email?)` | 来店履歴取得（メール指定で絞り込み） |
| `getUniqueCustomers(facilityId)` | 顧客一覧（来店回数・最終来店日付き） |

**`src/lib/features.ts`**

| 関数 | 用途 |
|------|------|
| `getPublishedFeatures(limit)` | 公開特集一覧（default 10件） |
| `getFeatureBySlug(slug)` | 特集詳細取得 |

**その他のユーティリティlib**

| ファイル | 用途 |
|---------|------|
| `analytics.ts` | GA4イベント追跡（`trackEvent()`関数） |
| `area-seo.ts` | エリアSEOコンテンツ取得（`getAreaSeoContent()`, `enrichSeoContent()`、DBにジェネリックseed済みのため `seo-snippets.ts` の生成器を優先） |
| `seo-constants.ts` | SEO用定数（prefectureSlugs, businessTypeSlugs, getPrefectureSlug/Name, getBusinessTypeSlug/Name, isValid*Slug） |
| `seo-snippets.ts` | SEOスニペット生成器（v8.11新規）。`businessTypeContext`（8業種×{keyword/description/searchPoints/faqs}）+ `generatePrefTypeContent()` / `generateCityContent()` / `generateCityTypeContent()` で都道府県×業種・市区町村・市×業種ページの固有テキスト・H2・FAQをサーバーレンダリング。`prefecture-seo.ts` の県固有データと組み合わせて3700+ページを唯一化。 |
| `constants.ts` | サイト全体定数。`SITE_URL` は `normalizeSiteUrl()` で trim+末尾スラ除去+www→apex強制（v8.11追加。Vercel環境変数末尾改行混入事案への恒久対策） |
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
| `ReviewForm.tsx`内インライン | `reviewSchema` | 口コミ投稿フォーム |
| `InquiryForm.tsx`内インライン | `inquirySchema` | 施設お問い合わせフォーム |
| `validations-auth.ts` | `loginSchema`, `signupSchema` | 認証フォーム |
| `validations-booking.ts` | `bookingSchema` | 予約フォーム（UUID/日付/時間検証、JST日付計算対応） |
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

- **保護ルート**: `/mypage/*`, `/admin/*` → 未認証時は `/auth/login?redirect=<元のパス>` にリダイレクト
- **admin権限チェック**: `/admin/*`（`/admin/onboarding`除く）→ `facility_members`で`role IN ('owner', 'admin')`を検証。未権限は`/mypage`にリダイレクト
- **認証済みリダイレクト**: `/auth/login`, `/auth/signup` → 認証済みユーザーは`/mypage`にリダイレクト
- **Matcher除外**: 静的アセット(`_next/static`, `_next/image`, `favicon`, `images`, `icons`, `sw.js`, `manifest.json`)はスキップ
- **最適化**: 公開ページ（`/`, `/search`, `/facility/*`, `/salon`, `/recruit` 等）は認証チェックをスキップ（パフォーマンス向上）

---

## エラー監視（Sentry）

- `@sentry/nextjs` 導入、設定ファイル3種（`sentry.client.config.ts`/`sentry.server.config.ts`/`sentry.edge.config.ts`）で構成
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

## PageSpeed最適化

### 計測結果（2026-04-04時点）

| デバイス | パフォーマンス | ユーザー補助 | おすすめ | SEO |
|---------|:------------:|:----------:|:------:|:---:|
| モバイル（Slow 4G） | **98** | 93 | 92 | 100 |
| デスクトップ | 95 | - | - | - |

> v7.5→v7.6でモバイルスコア 62→**98**（+36点）に改善。全指標グリーン達成。

### 主要メトリクス（モバイル）

| メトリクス | v7.5 | v7.6 | 改善率 |
|-----------|:----:|:----:|:-----:|
| FCP (First Contentful Paint) | 5.1s | **0.9s** | -82% |
| LCP (Largest Contentful Paint) | 7.3s | **~1.2s** | -84% |
| SI (Speed Index) | 5.8s | **~1.3s** | -78% |
| TBT (Total Blocking Time) | 0ms | 0ms | 維持 |
| CLS (Cumulative Layout Shift) | 0 | 0 | 維持 |
| レンダリングブロック | 5,760ms | **100ms** | -98% |

### 実施した最適化

**v7.6（2026-04-04）— PageSpeed 62→87**

- **システムフォント化**: `next/font/google` Noto Sans JP削除→システムフォントスタック（Hiragino Sans/Noto Sans JP/Meiryo）。249個の@font-face宣言=**191KBのレンダリングブロックCSS完全除去**（CSSファイル: 2ファイル246KB → 1ファイル55KB）
- **below-fold遅延ロード**: `HomeBelowFold`コンポーネント切り出し（`dynamic()` + `ssr: false`）。特集バナー/新着サロン/お悩みナビ/エリアマップ/CTA/コラムをクライアント側遅延ロード化。初期HTML: 219KB → 97KB（**-56%**）
- **hero画像超軽量静的配信**: `/_next/image`サーバーレス関数（TTFB 1.45s）→ 3.2KB静的WebP（`hero-tiny.webp`、240px q10）をCDN直接配信。80%グラデーションオーバーレイ下で視覚的影響なし。layout.tsxにpreloadリンク追加
- **施設データ取得のクライアント化**: `getLatestFacilities()`をサーバー→クライアントSupabase呼び出しに変更（HomeBelowFold内）

**v7.5以前の最適化（継続有効）**

- **ホームページISR**: `revalidate=3600`（1時間キャッシュ、CDNヒット率向上）
- **画像WebP変換**: hero.webp 165KB→71KB、cta.webp 83KB→28KB（JPEG偽装→本物WebP変換）
- **preload重複削除**: 不要な`<link rel="preload">`を削除（LCP大幅改善）
- **robots.txt修正**: `robots.ts`の未使用import削除
- **コントラスト改善**: テキスト/背景のコントラスト比をWCAG基準に修正
- **見出し順序修正**: h1→h2→h3の正しい階層構造に修正
- **タップターゲット改善**: モバイルのボタン/リンクサイズを48px以上に拡大
- **検索ページ動的import**: SearchFilterDialogを`dynamic()`でコード分割
- **middleware最適化**: 公開ページは認証チェックスキップ

### LCPボトルネック解決の経緯

LCP 3.8sの主因は`/_next/image`サーバーレス関数のTTFB（1.45秒）だった。hero画像を3.2KBの静的WebPに差し替え、CDN直接配信+preloadリンクで解決。LCP ~1.2sを達成し、スコア98に到達。

## 画像最適化

| ファイル | 変換前 | 変換後 | 削減率 | 備考 |
|---------|:------:|:------:|:------:|------|
| hero-tiny.webp | 165KB（JPEG偽装） | **3.2KB** | **98%** | 240px q10、80%グラデーション下で使用。CDN静的配信 |
| hero.webp | 165KB（JPEG偽装） | 71KB（本物WebP） | 57% | オリジナル保持（他ページ用） |
| cta.webp | 83KB（JPEG偽装） | 28KB（本物WebP） | 66% | HomeBelowFold内でlazy load |

> hero画像は`/_next/image`（TTFB 1.45s）を経由せず、`hero-tiny.webp`をCDN直接配信。layout.tsxにpreloadリンク設定済み。

## Vercel 環境変数 末尾空白問題（CRON_SECRET / NEXT_PUBLIC_BASE_URL）

### CRON_SECRET
末尾の空白文字（whitespace）が含まれるとビルドが失敗する。

### NEXT_PUBLIC_BASE_URL（v8.11で発覚）
末尾改行 `\n` または `www.` プレフィックス混入で**sitemap.xml が壊れた**事案あり:
- 症状: `<loc>https://www.carelink-jp.com\n/search</loc>` という改行入りURLが配信され、Google が全URL拾えずインデックス0件
- 恒久対策: `src/lib/constants.ts` に `normalizeSiteUrl()` 実装（trim+末尾スラ除去+www→apex強制）。環境変数が壊れていてもコード側で正規化される
- 二次対策: `src/app/sitemap.ts` に `export const dynamic = 'force-dynamic'` 追加（CDN静的キャッシュ完全回避）

**教訓**: Vercel環境変数を設定する際は値の前後に余分なスペース・改行がないことを確認。URL系は `.trim()` を入れる癖を。

## OG Image

- **v8.11 訂正**: `/api/og` は実際には存在し、`@vercel/og` で動的生成されている（`src/app/api/og/route.tsx`）。
- 各ページは `${SITE_URL}/api/og?title=...&subtitle=...` でOG画像URLを生成（facility/[slug]、jobs/[id]、feature/[slug]、blog/[slug]、[prefectureSlug] 等で利用）。
- 静的OG画像 `/og-image.png` は LP のフォールバックとして併存。

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

39回の品質監査で合計330件以上の問題を修正:

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
| 21(v7.4) | ~10件 | 実データ移行3施設・SEOブログ20本・テスト日付修正（UTC依存排除）・a11y SearchHeader aria-label・構造化データ強化（sameAs/hasMenu/review/dateModified・BlogPosting JSON-LD） |
| 22(v7.5) | ~10件 | PageSpeed最適化（モバイル62/デスクトップ95）・GSC認証・画像WebP変換（hero 57%/cta 66%削減）・ホームページISR化・検索dynamic import・middleware公開ページスキップ・robots.ts修正・コントラスト/見出し/タップターゲット改善 |
| 23(v7.6) | 4件 | **PageSpeed 62→98**: システムフォント化(191KB CSS除去)・below-fold遅延ロード(HTML 219KB→97KB)・hero超軽量静的配信(3.2KB、/_next/image TTFB 1.45s回避) |
| 24(v8.0) | 5件 | **LINE Messaging API統合**: DB3テーブル(line_user_links/facility_line_settings/line_notification_logs)・lib/line.ts・Webhook署名検証・予約/キャンセルLINE通知・マイページLINE連携UI |
| 25(v8.1) | 10件 | **ダッシュボード強化**: DB3テーブル(daily_revenue_summary/customer_segments/facility_notification_settings)・Cron2本(daily-summary/customer-segment)・CSVレポートAPI・recharts4チャート・RealtimeBookingListener・NotificationSettings |
| 26(v8.2) | 7件 | **鍼灸院・整骨院特化**: DB3テーブル(symptoms 30件シード/facility_symptoms/facility_certifications)・ALTER2(facility_menus+staff_profiles)・コンポーネント3(InsuranceMenuBadge/SymptomList/CertificationList)・症状別LP(/symptom/[slug]) |
| 27(v8.3) | 4件 | **セルフオンボーディング+LP強化+営業資料**: /api/facility/setup(施設自動作成)・/admin/onboarding(初期設定ガイド)・/register/complete→セルフ開始フローに変更・admin/settings公開トグル追加 |
| 28(v8.3) | 2件 | **施設向けLP全面リニューアル+営業資料5種**: /salon HPB比較15項目+機能9種+CTA強化、sales-templates.md(メール/DM/チラシ/LINE/電話スクリプト) |
| 29(v8.3) | 5件 | **P0-P2バグ修正**: middleware onboarding除外・signup施設名パラメータ保持・booking API special_price+nomination_fee+null staff競合チェック・JST日付計算・salonsテーブル自動引き継ぎ |
| 30(v8.3) | 2件 | **P3バグ修正**: スロットマージstaff_id保持(AvailableSlot型拡張)・LINEアカウント重複防止(既存user_id検索) |
| 31(v8.4) | 13件 | **全コンポーネント統合**: admin/analyticsにチャート4種・admin/layoutにRealtime通知・admin/settingsに通知設定・facility詳細に施術情報タブ・MenuListに保険バッジ・SearchFiltersに症状検索+保険フィルタ・vercel.json Cron3本・FacilityMenu型拡張 |
| 32(v8.5) | 9件 | **Phase 1+2**: 予約競合RPC・レビュー依頼Cron・進捗チェックリスト・検索0件対応・Stripe決済(Checkout+Webhook)・キャンセルポリシー・アカウント削除・医療広告警告 |
| 33(v8.6) | 5件 | **Phase 3**: 紹介プログラム(referral_codes/uses+API)・ポイント値引き・RFM離脱リスク自動メール・リピート予約ボタン・ヘルプセンター |
| 34(v8.7) | 9件 | **Phase 4+5**: 症状チェッカー(/symptom-checker)・ReviewSummary(口コミ要約)・Googleカレンダー+iCal・顧客CSVエクスポート・CSPフォント参照削除・loading5件追加・rate limiting4API |
| 35(v8.11) | 50+件 | **SEO基盤完成+本番運用基盤+整合監査**: sitemap壊れ駆除/47都道府県固有SEO/3700+ページ生成器SEO/ブログ51本/30症状ページ強化/業種別グローバル8ページ新設/health+sentry-check API新設/LAUNCH-CHECKLIST.md作成/MANUAL整合監査（API27→31, migration26→27, components78→80, blog5→51, /jobsの誤記載復活, /api/og実存訂正） |
| 36(v8.11.1) | 13件 | **MANUAL二次深調査監査**: §4.1環境変数表 `NEXT_PUBLIC_GSC_VERIFICATION_APEX`/`SENTRY_TEST_TOKEN` 追加（Critical 2件）。§4.3 .env.example コード例同期（Critical 1件）。§6.1.1 `20260407_seed_flag_and_jobs.sql` 追加（Critical 1件）。§6.1 Phase11テーブル一覧に `facility_jobs` + `facility_profiles.is_seed` ALTER 追加（Critical 2件）。§10.0 API数 31→32、`/api/og` 説明追加（Critical 1件 + Major 2件）。§3 ディレクトリ構成に `scripts/` (seed-facilities.mjs/cleanup-seed.mjs) と `LAUNCH-CHECKLIST.md` 追加（Minor 2件）。Critical 8件 / Major 3件 / Minor 2件 を全駆除 |
| 37(v8.11.2) | 3件 | **MANUAL三次深調査監査（深層検証）**: 過去2回が見落とした個別カラム名・個別ファイル名レベルの精密突合。**Critical 2件**: (1) §6.1 `facility_jobs` テーブルのカラム定義に存在しない `working_hours/holiday/is_active` を誤記載していた + 実在する `salary_note/is_seed/created_at/updated_at` を未記載 → CREATE TABLE文の実態に完全準拠した記述に訂正（§6.1 Phase11 + §6.1.1 migration両方）。(2) §10.0 APIエンドポイント表本体に #28-#32 の5行が記載されておらず、見出し「31エンドポイント」と本体27行で矛盾 → #28 /api/health, #29 /api/sentry-check, #30 /api/admin/jobs, #31 /api/admin/jobs/[id], #32 /api/og の5行を表本体に追記。**Major 1件**: §11.5 `JobForm` コンポーネント未記載 → 求人登録・編集フォームの説明追加。これでテーブルカラム定義・API表本体・コンポーネント名すべて実コードと完全一致 |
| 38(v8.11.3) | 8件 | **MANUAL四次深調査監査（メール・DNS・フォント）**: **Critical 5件**: (1-3) EMAIL_FROM `onboarding@resend.dev` → `noreply@carelink-jp.com` を§1.7/§4.1/§21の3箇所で修正。(4) §3 ADMIN-LAUNCH-TASKS.md 未記載→追加。(5) §1.7 Resendドメイン検証状況を「後日」→「verified（DKIM/SPF設定済み、Supabase Auth カスタムSMTP設定済み）」に更新。**Major 2件**: (6) §12.5 sitemap.ts に `force-dynamic + revalidate=0` 記載追加。(7) §1.4 技術スタック フォント設定「システムフォント」→「next/font Noto Sans JP（v8.11 Phase2で再導入）」に訂正。**Minor 1件**: (8) §21 Resendドメイン認証の制限事項を完了済みに更新 |
| 39(v8.11.4) | 4件 | **MANUAL五次深調査監査（デザイン・API数精密）**: **Critical 1件**: §16.1 Primaryカラー値逆転（`#0EA5E9` sky-500→実装は `#0284C7` sky-600、Primary Darkも `#0284C7`→実装 `#0369A1` sky-700）。**Major 2件**: (1) §16.1 拡張カラー3色未記載（care-pink `#EC4899`/care-green `#059669`/care-indigo `#6366F1`）。(2) API数 32→31に訂正（route.ts+route.tsx実ファイル数=31、/api/ogは表外補足に移動）。**Minor 1件**: テスト実数245件（MANUAL「200テスト」は概数として許容） |
| 42(v8.12.2) | 5件 | **MANUAL八次深調査監査（コンポーネント・env・ツリー）**: **Critical 3件**: (1) §3ディレクトリツリーで `HomeBelowFold.tsx` がJapanRegionMapの子として誤インデント→sibling修正 + `StickySignupCta.tsx` 未記載→追加。(2) §11.5コンポーネント表に `HomeBelowFold`/`StickySignupCta` 未記載→追加。(3) `LINE_CHANNEL_ACCESS_TOKEN_CARELINK`/`LINE_CHANNEL_SECRET_CARELINK` が実コードで使用中（lib/line.ts + booking/webhook API）なのに `.env.example` と §4.3コード例から漏れていた→両方に追加 |
| 41(v8.12.1) | 3件 | **MANUAL七次深調査監査（ページ表精密）**: **Critical 3件**: (1) §8.1 LP表に `/salon/demo`（管理画面デモ、Static）未記載→追加。(2) §8.1 LP表に `/register/complete`（施設掲載登録完了、Client+Suspense）未記載→追加。(3) §8.1 認証表に `auth/callback/route.ts`（OAuthコールバック）を誤ってpage扱いで記載→削除（API routes表に既存掲載） |
| 40(v8.12.0) | 15件 | **GBP（Google ビジネスプロフィール）統合 + MANUAL六次整合監査**: **新機能実装**: (1) Phase 12 DB: `gbp_posts`/`gbp_audit_cache` テーブル + `facility_profiles` に5カラム追加（gbp_place_id/gbp_cid/gbp_connected_at/google_rating/google_review_count）+ `facility_card_view` 再定義（2migration）。(2) `/src/lib/gbp.ts`: `fetchPlaceDetails()`/`calculateGbpScore()`/`getScoreGrade()` 新規。(3) `/admin/gbp` 管理ページ（4タブ: Place ID設定・43項目診断・Google口コミ・投稿下書き）。(4) API 4本追加: `/api/admin/gbp/place`(GET/POST)/`/api/admin/gbp/posts`(GET/POST/PATCH/DELETE)/`/api/cron/sync-google-ratings`(週次自動同期)。(5) Vercel Cron 4→5本。(6) 公開ページ: FacilityCard・FacilityHeaderにGoogleバッジ、施設詳細ページ住所に「地図を見る」リンク、口コミタブに「Googleで口コミを書く」ボタン。(7) `Facility`/`FacilityCardData` 型拡張。**MANUAL整合**: API 31→35、Cron 4→5、migration 27→29、admin loading 22→26、GBP機能全セクション追加、`GOOGLE_MAPS_API_KEY` 環境変数追加、`facility_profiles` DDL に6カラム追加記載 |

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
| 2026-04-08 | 8.11 | **SEO基盤完成 + 本番運用基盤 + マニュアル整合監査**: (1) **致命バグ修正**: sitemap.xml が `https://www.carelink-jp.com\n` で壊れていた根本原因を駆除。Vercel環境変数 `NEXT_PUBLIC_BASE_URL` の末尾改行+wwwが原因。`src/lib/constants.ts` に `normalizeSiteUrl()` 防御層追加（trim+apex強制）+ `sitemap.ts` を `force-dynamic` 化（CDN静的キャッシュ完全回避）。(2) **47都道府県固有SEOコンテンツ**: `src/data/prefecture-seo.ts` 新規（47県×{intro 200-300字+highlights 4項目+3FAQ}、事実ベース）。`area_seo_contents` テーブルに seed 済みのジェネリックテンプレを上書きする「ハードコード優先」ロジックに変更。(3) **3700+ページ生成器SEO**: `src/lib/seo-snippets.ts` 新規（businessTypeContext 8業種 + `generatePrefTypeContent()` / `generateCityContent()` / `generateCityTypeContent()` の3レイヤー生成器）。pref×type 376P / city 283P / city×type 数千Pすべてに事実ベースの固有テキスト・H2・FAQを配信。(4) **ブログ記事 20→51本**: 医療8/美容10/福祉5/エリア特集4/求人3を追加（`src/data/articles.ts`）。(5) **30症状ページSEO強化**: `src/data/symptom-seo.ts` 新規（30症状×{intro+causes+treatments+selfCare+3FAQ}）。`/symptom/[slug]` を Next.js 15準拠の Promise<{slug}> に修正、FAQPage+BreadcrumbList JSON-LD追加、症状解説・原因・治療・FAQをサーバーレンダリング。(6) **業種別グローバル8ページ新設**: `/type/[typeSlug]` 新ルート（generateStaticParams=8業種）。47県への内部リンク+人気施設12件+ItemList+FAQPage JSON-LD。sitemap.ts に `businessTypeTopPages` 追加。(7) **本番運用基盤**: `/api/health`（DB疎通+応答時間+commit hash返却、UptimeRobot等の外形監視用） / `/api/sentry-check`（Sentry動作確認、`?fire=1&token=...` でテストエラー実発火）新設。`docs/LAUNCH-CHECKLIST.md` 新規（Phase A: GSC/UptimeRobot/Sentry, Phase B: Stripe本番化5ステップ, Phase C: 実機E2E, Phase D: 法令, Phase E: ソフトローンチ）。(8) **マニュアル整合監査（35回目+36回目の二次監査）**: API 27→**32**, migration 26→27, コンポーネント 78→80, ブログ 5→51 に修正。`/jobs` `/jobs/[id]` `/type/[typeSlug]` をページ表に追加（特に `/jobs` は v8.10時点で「削除済み」と誤記載されていたが実装存在を確認し復活）。`/api/og` 削除済みの記述も実態と異なるため訂正（実際は存在し動的生成中）。§4.1環境変数表に `NEXT_PUBLIC_GSC_VERIFICATION_APEX` `SENTRY_TEST_TOKEN` 追加。§4.3 .env.exampleコード例も同期。§6.1 Phase11テーブル一覧に `facility_jobs` テーブル+`facility_profiles.is_seed` ALTER追加。§6.1.1 Migration一覧に `20260407_seed_flag_and_jobs.sql` 追加。§3 ディレクトリ構成に `scripts/` (seed-facilities.mjs/cleanup-seed.mjs) と `LAUNCH-CHECKLIST.md` 追加。 |
| 2026-04-07 | 8.10 | **インフラ全面有効化+Stripe決済バグ修正+法務改訂**: (1) Vercel環境変数追加=`NEXT_PUBLIC_SENTRY_DSN`/`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`/`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`(テストモード)/`NEXT_PUBLIC_LINE_CHANNEL_ID`/`LINE_CHANNEL_SECRET`（Sentry・Upstash分散レート制限・Stripe・LINE OAuth稼働開始）。(2) Stripe決済バグ3件修正=金額改ざん(client送信amount廃止→サーバー側`bookings.total_price ?? menu.price`で決定)/IDOR(`booking.user_id !== user.id`で403)/冪等性(`stripe_events`テーブルでevent.id重複INSERT拒否)。(3) `payment_intent.payment_failed`ハンドラ追加→`payment_status='failed'`更新。Stripe Webhook受信イベント7件（checkout.session.completed + subscription 3種 + invoice 2種 + payment_intent.payment_failed）。(4) DB migration `20260407_stripe_events.sql`=`stripe_events`テーブル新設+`bookings.payment_status` CHECK制約に`'failed'`追加。(5) privacy/legal大改訂=個情法28条対応（業務委託先5社明示/外国第三者提供）、安全管理措置4分類、開示等請求、苦情窓口（個人情報保護委員会）、特商法必須項目補完（販売価格/支払時期/申込有効期限/返品特約/動作環境）。(6) sitemap.ts に `/compare` `/legal` `/register` 追加。(7) layout.tsx に Twitter Card(summary_large_image)追加。(8) robots.ts Sitemap URL を apex ドメイン(`https://carelink-jp.com/sitemap.xml`)に修正。migration 25→26ファイル（`combined_phase2_to_6.sql`含む）、外部サービス設定状況を全項目✅に更新 |
| 2026-04-07 | 8.9 | **環境変数実態反映+ローンチ準備**: Sentry/Upstash/Stripe/LINE OAuth未設定を明記、Slack/Resend設定済み更新、Server Component bug修正（FacilitySelector/MobileFilterButtonをclient component化）、admin layout redirect干渉修正、recruit page facilities→salonsテーブル修正、bookings.points_used追加、プライバシーポリシーGoogle追記、sitemap新ページ追加、RLS migration、コンポーネント数78（うちsearch 17）、`/api/og`削除（@vercel/og未導入）、API 27エンドポイント |
| 2026-04-05 | 8.7 | **Phase 4+5（差別化+運用品質）**: 症状チェッカー(/symptom-checker)、ReviewSummary(口コミ要約)、Googleカレンダー+iCalボタン、顧客CSVエクスポート、CSPフォント参照削除、loading.tsx 5件追加（56件）、rate limiting 4 API追加 |
| 2026-04-05 | 8.6 | **Phase 3（成長エンジン）**: 紹介プログラム（referral_codes/referral_uses+API、紹介者500pt/被紹介者300pt）、ポイント値引き（booking APIでpoints_used減算）、RFM離脱リスク自動メール（60日超で自動フォロー）、リピート予約ボタン、ヘルプセンター(/admin/help 4カテゴリ12問FAQ) |
| 2026-04-05 | 8.5 | **Phase 1+2（動くプロダクト+決済）**: 予約競合RPC(create_booking_atomic)、レビュー依頼Cron(/api/cron/review-request)、ダッシュボード進捗チェックリスト、検索0件フォールバック、Stripe決済(Checkout Session+Webhook)、キャンセルポリシー(facility_cancel_policies+CancelPolicySettings)、アカウント削除(/api/account/delete+個人情報保護法対応)、医療広告ガイドライン警告 |
| 2026-04-05 | 8.4 | **全コンポーネント統合+P3修正**: admin/analyticsにrecharts4チャート統合、admin/layoutにRealtimeBookingListener統合、admin/settingsにNotificationSettings統合、facility/[slug]に施術情報タブ(SymptomList/CertificationList)追加、MenuListにInsuranceMenuBadge統合、SearchFiltersに症状検索+保険適用フィルタ追加、vercel.json Cron3本設定、FacilityMenu型+AvailableSlot型拡張、P3修正2件（スロットマージ+LINEアカウント重複防止） |
| 2026-04-05 | 8.3(fix) | **P0-P2バグ修正5件**: middleware /admin/onboarding除外、signup→onboarding施設名パラメータ保持、booking APIにspecial_price割引+nomination_fee指名料+null staff_id競合チェック追加、予約日付バリデーションJST対応、facility/setup APIでsalonsテーブル自動引き継ぎ |
| 2026-04-05 | 8.3 | **セルフオンボーディング+LP+営業資料**: 施設自動作成API（/api/facility/setup）、オンボーディングガイド（/admin/onboarding）、登録完了ページを「今すぐ始める」フローに変更、admin/settings公開/非公開トグル、施設向けLP全面リニューアル（HPB比較15項目/機能9種/CTA強化）、営業資料テンプレート5種（docs/sales-templates.md） |
| 2026-04-04 | 8.2 | **鍼灸院・整骨院特化**: DB3テーブル（symptoms 30症状シード/facility_symptoms/facility_certifications）、facility_menus ALTER×3（insurance_covered/note/price）、staff_profiles ALTER（certifications）、InsuranceMenuBadge/SymptomList/CertificationList、症状別LP（/symptom/[slug]） |
| 2026-04-04 | 8.1 | **ダッシュボード強化**: DB3テーブル（daily_revenue_summary/customer_segments/facility_notification_settings）、Cron2本（daily-summary日次売上集計/customer-segment週次RFM分析）、CSVレポートエクスポート（/api/admin/report）、recharts4チャート（RevenueChart/BookingTrendChart/CustomerSegmentChart/RepeatRateCard）、RealtimeBookingListener（Supabase Realtime）、NotificationSettings（Push/メールトグル） |
| 2026-04-04 | 8.0 | **LINE Messaging API統合**: DB3テーブル（line_user_links/facility_line_settings/line_notification_logs + RLS + インデックス）、lib/line.ts（Push送信/署名検証/リトライ/通知テンプレート4種）、POST /api/line/webhook（署名検証+フォロー応答+メッセージ応答）、予約作成/キャンセルAPIにLINE通知統合、マイページにLINE連携/解除UI、Vercel環境変数3つ（TOKEN/SECRET/CHANNEL_ID）、Bot ID: @549rbbyi |
| 2026-04-04 | 7.6 | **PageSpeed 62→98（+36点、全指標グリーン）**: システムフォント化（next/font Noto Sans JP→システムフォント、191KBレンダリングブロックCSS除去）、below-fold遅延ロード（HomeBelowFold ssr:false切り出し、HTML 219KB→97KB）、hero超軽量静的配信（3.2KB WebP、/_next/image TTFB 1.45s回避、preloadリンク追加）。FCP 5.1s→0.9s(-82%)、LCP 7.3s→~1.2s(-84%)、SI 5.8s→~1.3s(-78%)、レンダリングブロック 5,760ms→100ms(-98%) |
| 2026-04-03 | 7.5(MANUAL) | **MANUAL v7.5更新**: v7.3以降の全改善反映。GSC設定済み、PageSpeedセクション追加、実データ移行3施設完了、SEOブログ20本、画像WebP最適化、構造化データ強化（sameAs/hasMenu/review/dateModified/BlogPosting）、ホームページISR化、middleware最適化、CRON_SECRET注意事項追加 |
| 2026-04-02 | 7.5 | **SEO・パフォーマンス総合強化**: GSC認証（HTMLタグ方式）、PageSpeed最適化（モバイル62/デスクトップ95）、ホームページISR化（revalidate=3600）、画像WebP変換（hero 57%削減/cta 66%削減）、構造化データ強化（LocalBusiness sameAs/hasMenu/review/dateModified、BlogPosting JSON-LD）、検索ページdynamic import、robots.ts修正、コントラスト・見出し順序・タップターゲット改善、middleware公開ページ認証スキップ |
| 2026-04-01 | 7.4 | **実データ移行+SEOブログ**: 3施設移行完了（ハル豊中本店28メニュー/3スタッフ/10クーポン、ハルイマイビル店28メニュー/3スタッフ/10クーポン、神原鍼灸院2メニュー/2スタッフ）、SEOブログ20本投稿（本店7/イマイビル6/鍼灸院7）、テスト日付修正（booking dateテストのタイムゾーン依存排除）、a11y SearchHeader nav aria-label追加 |
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
