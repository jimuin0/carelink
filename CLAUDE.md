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
| L1 | ESLint / tsc | ✅ | エラー 0（2026-06-03 確認、HPB同等化＋8観点監査の根本対策反映後） |
| L2 | Jest ユニットテスト | ✅ | 4840 テスト全通過、201 スイート（2026-06-03、round4 監査でクーポン適用条件/PickUp原子化のテスト追加） |
| L3 | Jest ブランチカバレッジ 100% | ✅ | 変更・新規の全API/lib で branch 100% 維持（booking/availability/slots/menus/coupons/blog/reviews/customer-note/booking-suspension/daily-capacity/reorder/lib(blog,suspensions)）。2026-06-03 |
| L4 | Stryker ミューテーション | ✅ | 全12ファイル survived=0（2026-06-03、lib/suspensions.ts を追加し mutation score 100%）。lib/blog.ts は supabase IO ありで L4基準「外部副作用なし」非該当のため対象外。 |
| L5 | fast-check プロパティベース | ✅ | 31テスト全通過（db-fallback の isMissingColumnError/omitKeys プロパティ5件追加、2026-06-01） |
| L6 | npm audit / 認証テスト | ✅ | critical=0・high=0（moderate 5）、menu-remarks の認証/IDOR テスト追加（2026-06-01） |
| L7 | 構造化ログ + Slack + 外形監視 | ✅ | 2026-05-25 達成（A〜D 全基準） |

### 8観点監査 ラウンド4（2026-06-03）

8体エージェント＋統合で被らない8観点（並行性再検査 / React hooks / N+1 / 認可横断 / 参照整合 / round3回帰 / 予約e2e / 表示境界）を監査。
認可横断・参照整合FK・round3回帰の3観点は指摘なし（健全確認）。確認した12件のうち10件を根本修正済み・2件は判断保留で記録。

**修正済み（発症前の恒久対策）:**
- #A クーポンのメニュー限定(coupon_menus)を確定層で検証（対象外メニューへの不正割引を防止）
- #B クーポン種別(new_customer/repeat)の対象者検証を確定層に追加
- #C service_packages.menu_id の参照先を facility_menus に是正（ソース＋冪等是正マイグレーション）
- #D ListingBoard コールバックを useCallback 安定化（60秒タイマー由来の掲載6テーブル無駄再取得を解消）
- #E /api/slots の suspensions+capacity を並列化
- #F お客様一覧をサーバ集計RPC化（PostgREST 1000行上限の集計欠落を解消）
- #H 管理予約RPCに施設×日 advisory lock（capacity超過の理論窓を封鎖）
- #I 注目口コミPickUpを施設lock下の原子RPC化（並行PATCHの0件/2件競合を排除）
- #J reorder RPCに施設×テーブル advisory lock（並行reorderの交錯防止）
- #K rangeBookings の section ガード / 顧客フィルタ空状態 / hpbLen 半角カナ0.5換算

**判断保留（神原さん確認待ち・事実として未修正）:**
- #G availability の per-date×per-staff RPC（最悪310往復）。集約RPC化が理想だが status導出ロジックが
  jestテスト済みJSから未テストのplpgsqlへ移りL3カバレッジが実質低下するトレードオフがあるため保留。
  既存は early-exit＋5日並列で典型ケースは緩和済み。
- 予約e2e #3 サーバ再計算した確定額がAPI応答/完了画面に返らず確認画面表示と乖離し得る（価格の保存・
  メール送信は正常＝データ不整合なし、UX改善事項）。

**🔴 神原さん 適用待ちマイグレーション（ファイル名順）:**
1. `20260604_facility_status_gate.sql` / `20260604_booking_status_cancel_fee.sql` / `20260604_daily_capacity_dedup_index.sql`（round3）
2. `20260604_service_packages_menu_fk_fix.sql`（#C・既存環境向け是正）
3. `20260604_concurrency_hardening.sql`（#H/#I/#J）
4. `20260604_facility_customers_rpc.sql`（#F）
