# CareLink 実機E2E 検証台本（神原さん実行用・コマンド付き）

最終更新：2026年7月3日

この台本は LAUNCH-CHECKLIST.md の Phase B/C を、神原さんが【上から順に実行するだけ】で
検証できるよう、クリック手順に加えて Supabase SQL / curl の確認コマンドを埋め込んだもの。

- テスト用の名前は全て「神原良祐」で統一（既存 docs/TEST-CHECKLIST.md 準拠）。
- テスト用メールは自分の受信できるアドレス（例：kambara.gimu+e2e@gmail.com のように +タグ）。
- SQL は Supabase SQL Editor で実行。curl はターミナルで実行。
- 実顧客データには絶対に触れない（WHERE 句で必ずテスト対象を絞る）。
- 完了後は最後の「後片付け」で作成したテストデータを削除。

---

## 0. 事前疎通（コード側は準備済み・env と配線の確認）

### 0-1. ヘルスチェック（依存の生死）
```
curl -s https://carelink-jp.com/api/health | head -c 400
```
期待：`"status":"healthy"`（Critical 依存＝Supabase DB / rate-limit RPC が生きていれば healthy）。
`degraded` は Stripe/Resend/Slack のいずれかが未設定でも 200（本番前に env を埋める）。

### 0-2. Slack アラート疎通（Sentry は廃止済み・A5 の現行版）
Vercel 環境変数に `ALERT_CHECK_TOKEN`（20字以上のランダム文字列）と
`SLACK_BOT_TOKEN` / `SLACK_DEFAULT_CHANNEL` を設定して Redeploy 後：
```
curl -s "https://carelink-jp.com/api/alert-check?fire=1&token=（ALERT_CHECK_TOKENの値）"
```
期待：`{"ok":true,"fired":true,"slackConfigured":true,...}` かつ Slack の該当チャンネルに
1分以内に 🔴 ERROR [alert-check] のテスト通知が届く。
- `"slackConfigured":false` → SLACK_BOT_TOKEN / SLACK_DEFAULT_CHANNEL 未設定。
- `{"ok":false,"message":"invalid token"}` → ALERT_CHECK_TOKEN の値が不一致。

---

## 1. Phase C1：ユーザー新規登録〜予約〜キャンセル

1. `/auth/signup` でテスト用メールで新規登録 → 認証メール受信 → ログイン。
2. `/search` で検索 → 施設詳細 → メニュー → 日時 → 予約完了。氏名は「神原良祐」。
3. 予約確認メール受信を確認。

### 1-1. 予約が作成されたか（SQL）
```sql
select id, status, payment_status, booking_date, start_time, customer_name, created_at
from bookings
where customer_name = '神原良祐'
order by created_at desc
limit 5;
```
期待：最新行が `status = 'pending'`（自動確定施設なら 'confirmed'）。id を控える。

### 1-2. マイページ表示 → キャンセル
`/mypage/bookings` で該当予約を確認 → キャンセル実行。

### 1-3. キャンセルが反映されたか（SQL・id は 1-1 で控えた値）
```sql
select id, status from bookings where id = '（1-1のid）';
```
期待：`status = 'cancelled'`。

---

## 2. Phase B：Stripe 本番決済（1円テスト・神原さん立ち会い必須）

> 事前に ADMIN-LAUNCH-TASKS タスク6 で Stripe 本番キー・Webhook を設定済みであること。
> 【重要】決済 Webhook の構成は要確認事項あり（別紙：本ファイル末尾「決済 Webhook 確認事項」）。

1. テスト用施設で1円メニューを作成 → 神原良祐アカウントで予約 → 決済画面 → 実カードで1円課金。

### 2-1. 予約が支払い済みになったか（SQL）
```sql
select id, status, payment_status, paid_amount, stripe_payment_intent_id
from bookings
where customer_name = '神原良祐'
order by created_at desc
limit 3;
```
期待：`payment_status = 'paid'` かつ `paid_amount = 1`。ここが 'pending' のままなら Webhook 未達
（末尾「決済 Webhook 確認事項」を参照）。

### 2-2. 決済セッションの整合（SQL・領収書可否）
```sql
select stripe_session_id, status, amount, booking_id
from stripe_sessions
order by created_at desc
limit 3;
```
期待：`status = 'paid'`。'pending' のままだと `/api/stripe/receipt` が領収書を発行できない
（末尾「決済 Webhook 確認事項」PAY-2 を参照）。

3. Stripe Dashboard で決済完了を確認 → 直後に全額返金 → 1円メニューを削除/非公開化。

### 2-3. 返金が反映されたか（SQL）
```sql
select id, payment_status from bookings where id = '（2-1のid）';
```
期待：`payment_status = 'refunded'`（部分返金なら 'partial_refund'）。

---

## 3. 検索まわりの動作確認（今回修正した2点）

### 3-1. 人気順（SEARCH-1 根治：旧実装は常に0件だった）
`/search?sort=popular` を開く → 結果が0件でなく評価件数の多い順に並ぶこと。

### 3-2. GPS 検索＋絞り込み（SEARCH-2 根治：GPS時に絞り込みが無視されていた）
現在地検索をONにした状態で「都道府県」「評価」「価格」を指定 → 指定した条件で件数が絞られること
（features / キーワードとの併用は RPC 拡張が必要＝別紙 SQL）。

---

## 4. 後片付け（テストデータ削除）

```sql
-- テスト予約を物理削除（顧客名で厳密に絞る）
delete from bookings where customer_name = '神原良祐';
```
テスト施設・テストメニュー・テストアカウントは admin 画面 or Auth 画面から削除。

---

## 決済 Webhook 確認事項（Claude からの申し送り・要神原さん確認）

コード監査で、決済の Webhook 構成に本番前に必ず確認すべき点が見つかった（詳細は会話本文）。
1円テスト前に Stripe Dashboard で【登録されている Webhook エンドポイントの数と URL、各署名シークレット】
を確認してほしい。要点：

- PAY-1：`/api/stripe/webhook` と `/api/payment/webhook` の2つが両方 `STRIPE_WEBHOOK_SECRET`
  という同一 env を使う。Stripe はエンドポイントURLごとに別の署名シークレットを発行するため、
  2つ登録すると片方は必ず署名検証に失敗する。→ どちらを本番に使うかを確定する必要がある。
- PAY-2：本番想定の `/api/payment/webhook` は `stripe_sessions.status` を 'paid' に更新しないため、
  その経路で払うと領収書が発行できない（2-2 で 'pending' のままなら該当）。
- PAY-3/PAY-4：`/api/stripe/webhook` には全額決済(full)の分岐が無い、`/api/stripe/checkout` が
  デポジット種別(percent/fixed)を無視する、という決済金額に関わる論点。

これらは金銭に関わるためコード側で勝手に変更していない。Stripe Dashboard の実態を教えてもらえれば、
正しい方向（単一 Webhook への統合 or env 分離）を確定して根治する。
