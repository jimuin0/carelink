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
| SUPABASE_SERVICE_ROLE_KEY | Supabase service_role キー（cron / 管理 API のサーバ側 DB 操作。RLS バイパス） |
| CRON_SECRET | GitHub Actions cron → `/api/cron/*` 認証用 Bearer トークン（未設定で全 cron 401） |
| CARELINK_BASE_URL | cron workflow が叩く本番ベース URL（例: https://carelink-jp.com） |
| RESEND_API_KEY | Resend メール送信 API キー（未設定でメール系 cron は 503/送信スキップ） |
| NEWSLETTER_UNSUBSCRIBE_SECRET | 月次ニュースレターの配信停止リンク HMAC 署名鍵。**newsletter-digest / unsubscribe で共通必須**（未設定で newsletter-digest は 503・送信不可）。一度設定したら変更しない（既存の配信停止リンク維持） |

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
| L1 | ESLint / tsc | ✅ | エラー 0 |
| L2 | Jest ユニットテスト | ✅ | 4047 テスト全通過、180 スイート |
| L3 | Jest ブランチカバレッジ 100% | ✅ | 5426/5426 branches（2026-05-26 達成） |
| L4 | Stryker ミューテーション | ✅ | agent1 4ソース（i18n / seo-constants / seo-snippets / json-ld）Survived=0 を Stryker 公式実行で確定（2026-05-31）。高負荷下のOOM kill回避のため8分割並列＋順次リトライで完走。seo-snippets.ts の生存1体（`.slice(0,180)` 削除）は到達不能な防御コードに起因する等価変異だったため、180字上限を純粋関数 `truncateText`＋定数 `INTRO_MAX_LENGTH` に抽出し境界テストで kill 可能化（症状抑止ではなく予防的根本解決）。変更範囲 Stryker 再実行で Mutation score 100.00 確認。stryker.config.mjs の mutate は純粋10モジュール（上記4＋constants/safe/image-utils/jobs/validations/validations-booking/validations-auth）を break:100 で列挙済み（ただし上記4以外は未検証＝下記）。**【2026-06-10 恒久対策＋validations.ts 実測完了】**: 過去の「validations.ts 100%確定」誤報告の**根本原因を事実で確定**＝Stryker の TS チェッカーが `tsconfig.json`（`include` に `.next/types/**/*.ts` を含む）経由で **stale な Next.js 生成ルート型（main 不在ルートを参照し TS2307 大量発生）を読み込みクラッシュ**し、ミューテーション実測前に異常終了していた（`.next/types/app/admin/salon-board/page.ts` 等で再現確認済み）。**恒久的根本解決**: Stryker 専用 `tsconfig.stryker.json`（`.next` を一切 include しない・`incremental:false` で本体ビルドキャッシュ非汚染）を新設し、`stryker.config.mjs` の `tsconfigFile` をこれに切替。`.next` の状態・ブランチに依存せず**再現性100%**で TS チェック成立（tsc 実測：`.next/types` エラー 0・全エラー 0）。本体 `tsconfig.json` は無変更＝build/dev/通常 tsc に**副作用ゼロ**（症状ブロック＝手動 `.next` 再生成ではなく構造的予防）。この対策下で **`validations.ts`（124 mutant）の Stryker 本実行を完走**: **Mutation score 100.00%・Survived=0**（Killed 52／Timeout 5／NoCoverage 0／Ignored 66=静的変異 `ignoreStatic`／CompileError 1=TS が拒否＝分母外、所要 36分48秒、concurrency 1）。ログ集計表と `reports/mutation/mutation.json` の独立再計算が一致＝exit code でなく実データで確定。**【2026-06-10 全10モジュール実測完了】**: 上記恒久対策下で `stryker.config.mjs` の mutate 対象**全10モジュールを1ファイルずつ非並行で実測完走し、全て Survived=0（Mutation score 100.00%）を実データ確定**（各モジュールごとにログ集計表と mutation.json を独立再計算して照合・exit code 非依存）。内訳: validations(Killed52/TO5)・constants(Killed11)・safe(Killed13/TO5)・image-utils(Killed7/TO15)・jobs(Killed32/TO6)・validations-booking(Killed35/TO2)・validations-auth(Killed3)＝本日実測、i18n/seo-constants/seo-snippets＝2026-05-31実測（json-ld は 2026-05-30 実測・mutate 列挙外で別途確定）。constants.ts では生存3変異を性質別に恒久対処（URL正規化の境界テスト追加で実 kill／冗長デフォルトを1箇所集約し実 kill 化／dayLabels の静的データ定数 ObjectLiteral は kill 不能な等価変異として既存 disable と一貫させ除外・神原さん承認済み）。他9モジュールは無修正で 100%。**L4 完遂＝全対象モジュールでテストが全変異を捕捉（取りこぼし0）を実データで確定。** |
| L5 | fast-check プロパティベース | ✅ | 26テスト＋safeJsonLd プロパティ7件、バグ3件修正 2026-05-29／json-ld 追加 2026-05-30 |
| L6 | npm audit / 認証テスト | ✅ | critical=0・high=0、認証バイパステスト 21件（HMAC検証・middleware） 2026-05-29 達成 |
| L7 | 構造化ログ + Slack + 外形監視 | ✅ | 2026-05-25 達成（A〜D 全基準） |
