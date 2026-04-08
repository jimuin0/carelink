# CareLink 本番ローンチ チェックリスト

> 本気運用に向けた最終チェック。すべて「神原良祐」名義で実施すること。
> 実顧客のデータには絶対に触れない。

最終更新: 2026-04-08

---

## Phase A: インフラ・監視（最優先）

### A1. GSC apex プロパティ追加
1. [ ] https://search.google.com/search-console を開く
2. [ ] 左上ドロップダウン → 「+ プロパティを追加」
3. [ ] 「URL プレフィックス」を選択
4. [ ] URL欄: `https://carelink-jp.com/`（**wwwなし**、httpsで始まる、末尾スラ）
5. [ ] 「続行」→ 所有権確認 → 「HTMLタグ」方式を選択
6. [ ] `<meta name="google-site-verification" content="..." />` の **content値だけコピー**
7. [ ] **Vercel環境変数**: `NEXT_PUBLIC_GSC_VERIFICATION_APEX` にcontent値を貼り付け
   - 既にコード側で対応済み（layout.tsx でenv経由読み込み）
   - 既存wwwプロパティのtokenはハードコードされたまま並存
8. [ ] Vercel Redeploy
9. [ ] GSC側の「確認」ボタンを押す → 認証成功
10. [ ] 既存wwwプロパティはそのまま残しておく（参考用）

### A2. サイトマップ送信
- [ ] GSC新プロパティ → サイトマップ → `https://carelink-jp.com/sitemap.xml`
- [ ] 送信状態が「成功」になることを確認（数分〜1日）
- [ ] 認識URL数が2900+件であること

### A3. URL検査でインデックス登録リクエスト
以下を1つずつURL検査→「インデックス登録をリクエスト」:
- [ ] `https://carelink-jp.com/`
- [ ] `https://carelink-jp.com/tokyo`
- [ ] `https://carelink-jp.com/osaka`
- [ ] `https://carelink-jp.com/type/hair-salon`
- [ ] `https://carelink-jp.com/type/acupuncture`
- [ ] `https://carelink-jp.com/symptom/low-back-pain`
- [ ] `https://carelink-jp.com/blog`
- [ ] `https://carelink-jp.com/jobs`

### A4. UptimeRobot 外形監視
- [ ] [uptimerobot.com](https://uptimerobot.com) で無料アカウント作成
- [ ] Monitor追加: `https://carelink-jp.com/api/health` を5分間隔
  - 期待ステータス: 200
  - レスポンスに `"status":"healthy"` を含むこと
- [ ] アラート通知先: 自分のメール+SMS（無料枠）
- [ ] テスト: 一度Monitor pauseで通知が来るか確認

### A5. Sentry 動作確認
- [ ] Vercel環境変数に `SENTRY_TEST_TOKEN=任意の長い文字列` 追加
- [ ] Redeploy後、ブラウザで以下にアクセス:
  ```
  https://carelink-jp.com/api/sentry-check?fire=1&token=YOUR_TOKEN
  ```
- [ ] レスポンスに `"fired":true` が出ること
- [ ] Sentry Dashboard に1分以内にテストエラーが表示されること
- [ ] **アラートルール設定**: Sentry → Alerts → Create Alert
  - 条件: 新規エラー発生時
  - 通知先: メール or Slack Webhook（既設の `SLACK_WEBHOOK_URL`）

### A6. Vercel 環境変数最終チェック
- [ ] `NEXT_PUBLIC_BASE_URL=https://carelink-jp.com`（末尾改行・スペース・wwwなし）
- [ ] `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 設定済み
- [ ] `RESEND_API_KEY` 設定済み（メール送信）
- [ ] `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` / `NEXT_PUBLIC_LINE_CHANNEL_ID` 設定済み
- [ ] `NEXT_PUBLIC_SENTRY_DSN` 設定済み
- [ ] `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` 設定済み（rate limit用）
- [ ] `SLACK_WEBHOOK_URL` 設定済み（通知用）
- [ ] `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` ← **A7で本番化**
- [ ] `CRON_SECRET` 設定済み（末尾空白なし）

---

## Phase B: Stripe本番化（決済を使うなら必須）

### B1. Stripe審査確認
- [ ] [dashboard.stripe.com](https://dashboard.stripe.com/) → 設定 → ビジネス情報
- [ ] 「アカウント有効化」が完了していること
- [ ] 銀行口座登録済み

### B2. 本番APIキー取得
- [ ] Dashboard右上の「テストモード」スイッチを **OFF**
- [ ] 開発者 → APIキー → シークレットキーを「キーを表示」してコピー
- [ ] **重要**: シークレットキーは絶対に共有・スクショ不可

### B3. Vercel環境変数差替
- [ ] `STRIPE_SECRET_KEY` を `sk_live_...` に更新
- [ ] **Production環境のみ**に設定（PreviewはTest用残しても良い）

### B4. Stripe Webhook 本番再登録
- [ ] Dashboard 開発者 → Webhooks → エンドポイント追加
- [ ] URL: `https://carelink-jp.com/api/payment/webhook`（実際のpath要確認）
- [ ] イベント選択（最低限）:
  - `checkout.session.completed`
  - `payment_intent.payment_failed`
  - `customer.subscription.created/updated/deleted`
  - `invoice.paid` / `invoice.payment_failed`
- [ ] 作成後、署名シークレット `whsec_...` をコピー
- [ ] Vercel環境変数 `STRIPE_WEBHOOK_SECRET` を更新→Redeploy

### B5. 1円実機決済テスト（神原良祐名義）
- [ ] **テスト用施設で1円のテストメニューを作成**
- [ ] 神原良祐アカウントで予約 → 決済画面まで進む
- [ ] 実カード（神原様本人名義）で1円課金
- [ ] Stripe Dashboard で決済完了確認
- [ ] CareLink管理画面で予約ステータス `paid` 確認
- [ ] **直後に全額返金**（Stripe Dashboardから1clickでrefund）
- [ ] 1円テストメニューを削除/非公開化

---

## Phase C: 実機E2Eテスト（神原良祐名義）

### C1. ユーザー新規登録〜予約
- [ ] `/auth/signup` で新規アカウント作成（メール: 神原良祐用）
- [ ] 認証メール受信→クリック→ログイン
- [ ] `/search` で検索
- [ ] 施設詳細を開く
- [ ] メニュー選択→日時選択→予約完了
- [ ] **メール通知**: 予約確認メール受信
- [ ] **管理画面**: 予約が `pending` で表示される
- [ ] マイページ `/mypage/bookings` で予約確認
- [ ] **キャンセル**実行→ステータス `cancelled` 確認

### C2. LINE連携
- [ ] マイページ `/mypage/profile` でLINE連携ボタン押下
- [ ] LINE公式アカウント友だち追加
- [ ] アカウント連携完了
- [ ] 新規予約 → **LINE通知受信**確認
- [ ] 連携解除→再連携が動くか

### C3. 口コミ投稿
- [ ] 完了予約から口コミ投稿
- [ ] 写真添付テスト
- [ ] 「来店確認バッジ」が自動付与されること
- [ ] 管理画面で口コミ承認/返信テスト

### C4. オーナー側
- [ ] `/register` から施設新規登録
- [ ] `/admin/onboarding` の進捗チェックリスト全項目完了
- [ ] メニュー追加・スタッフ追加・写真アップロード・スケジュール設定
- [ ] 公開設定ON→検索結果に表示される
- [ ] 自分の予約を入れて管理画面で確認
- [ ] CSVエクスポート動作確認

### C5. 検索・パフォーマンス
- [ ] `/search` でキーワード検索
- [ ] 都道府県絞り込み
- [ ] 業種絞り込み
- [ ] 並び替え（人気/評価/新着）
- [ ] GPS現在地検索
- [ ] PageSpeed Insights で各ページ確認:
  - [ ] `/` → 90+
  - [ ] `/search` → 80+
  - [ ] `/facility/{slug}` → 80+

### C6. メール到達性
- [ ] Resend Dashboard で送信数・到達率確認
- [ ] スパムフォルダに入らないか各キャリア（Gmail/iCloud/Yahoo）でテスト
- [ ] DKIM/SPF/DMARC設定済みか確認

---

## Phase D: 法令・コンプライアンス最終確認

- [ ] `/privacy` プライバシーポリシー最新（個情法28条対応済み）
- [ ] `/terms` 利用規約最新
- [ ] `/legal` 特商法表記最新（販売価格・支払時期・返品特約・動作環境）
- [ ] Cookie同意バナー表示確認
- [ ] 医療広告ガイドライン警告（Before/After写真投稿時）
- [ ] アカウント削除機能の動作確認（マイページから）

---

## Phase E: ソフトローンチ

### E1. クローズドβ（1週間）
- [ ] 知人施設1-2軒に試用依頼
- [ ] 知人ユーザー5-10名にβテスト依頼
- [ ] 1週間運用→Sentryエラー0件 / Uptime 99.9%以上を確認
- [ ] フィードバック収集→緊急バグ修正

### E2. パブリックローンチ
- [ ] SNS公式アカウント（X/Instagram）開設・初投稿
- [ ] プレスリリース（PR TIMES等）
- [ ] 営業展開: 豊中・堺の鍼灸院/整骨院 30-50軒

---

## 緊急時連絡先・ロールバック手順

### ロールバック
```
git revert HEAD
git push
# Vercel自動デプロイで前バージョンに戻る
```

または Vercel Dashboard → Deployments → 安定版を「Promote to Production」

### サービス停止が必要な場合
- Vercel Dashboard → Settings → General → Pause Deployment

### Stripe緊急停止
- Dashboard → 開発者 → APIキー → 「ロール」（rotate）でキー失効

---

## 完了サイン

- [ ] Phase A 全完了
- [ ] Phase B 全完了（決済使う場合）
- [ ] Phase C 全完了
- [ ] Phase D 全完了
- [ ] Phase E1 1週間問題なし

すべてチェック済みになったら**本番ローンチ可能** 🚀
