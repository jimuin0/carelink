# CareLink 実機E2E 検証台本（神原さん実行用・コマンド付き）

最終更新：2026年7月3日

この台本は LAUNCH-CHECKLIST.md の Phase B/C を、神原さんが【上から順に実行するだけ】で
検証できるよう、クリック手順に加えて Supabase SQL / curl の確認コマンドを埋め込んだもの。

- テスト用の名前は全て「神原良祐」で統一（既存 docs/TEST-CHECKLIST.md 準拠）。
- テスト用メールは自分の受信できるアドレス（自分の Gmail 等に `+e2e` のような +タグを付けたもの。台本には実アドレスを書かない）。
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
`degraded` は PAY.JP/Resend/Slack のいずれかが未設定でも 200（本番前に env を埋める）。

### 0-2. Slack アラート疎通（Sentry は廃止済み・A5 の現行版）
Vercel 環境変数に `ALERT_CHECK_TOKEN`（20字以上のランダム文字列）と
`SLACK_BOT_TOKEN` / `SLACK_DEFAULT_CHANNEL` を設定して Redeploy 後：
```
curl -s -H "Authorization: Bearer （ALERT_CHECK_TOKENの値）" "https://carelink-jp.com/api/alert-check?fire=1"
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

## 2. Phase B：PAY.JP 本番決済（神原さん立ち会い必須）

> 2026年11月14日に決済を Stripe から PAY.JP へ移した。本番の鍵・webhook は設定済み（ADMIN-LAUNCH-TASKS タスク6）。
> 予約の前払いは「近日公開」でお客様向けの画面が無いので、実機テストは有料オプションの月額で行う。

1. テスト用施設の管理画面（設定 → リマインダー設定）で有料オプションの「購入する」→ 実カードで申し込む。

### 2-1. 契約と利用権が有効になったか（SQL）
```sql
select facility_id, option_key, status, payjp_subscription_id, current_period_end
from facility_option_payjp_subscriptions
order by created_at desc
limit 3;

select facility_id, option_key, status, current_period_end
from facility_entitlements
order by updated_at desc
limit 3;
```
期待：契約の `status = 'active'`、利用権の `status = 'active'`。契約が 'pending' のままなら webhook 未達
（`select * from payjp_webhook_events order by received_at desc limit 5;` で受信と `error` を見る）。

2. 同じ画面で「解約」→ 「解約予約済み（○月○日まで利用可）」になることを確かめる。

### 2-2. 解約が反映されたか（SQL）
```sql
select option_key, status from facility_option_payjp_subscriptions where facility_id = '（テスト施設の id）';
```
期待：`status = 'canceled'`（期間末に PAY.JP の subscription.deleted が届くと 'deleted' になり、利用権が canceled になる）。

3. PAY.JP 管理画面（ライブモード）の「定期課金」「売上」で状態を確かめ、テストの売上は返金する。

---

## 3. 検索まわりの動作確認（今回修正した2点）

### 3-1. 人気順（SEARCH-1 根治：旧実装は常に0件だった）
`/search?sort=popular` を開く → 結果が0件でなく評価件数の多い順に並ぶこと。

### 3-2. GPS 検索＋絞り込み（SEARCH-2 根治：GPS時に絞り込みが無視されていた）
現在地検索をONにした状態で「都道府県」「評価」「価格」を指定 → 指定した条件で件数が絞られること
（features / キーワードとの併用は RPC 拡張が必要＝別紙 SQL）。

---

## 4. 後片付け（テストデータ削除）

氏名だけで絞って削除しないこと（同姓同名の実顧客や、テスト以外で同じ名前を使った予約を巻き添えにする）。
**テスト用メールアドレス（+タグ付き）・テスト施設・検証日の3条件**で絞り、まず SELECT で件数と中身を確認してから削除する。

```sql
-- 1) まず対象を確認する（件数と中身が自分の作ったテスト予約だけであること）
select id, facility_id, customer_name, email, booking_date, status, payment_status, created_at
from bookings
where email = '<テスト用メールアドレス（+タグ付き）>'
  and facility_id = '<テスト施設の facility_id>'
  and created_at >= '<検証開始日時（例: 2026-07-03 00:00+09）>';

-- 2) 上の結果が想定どおりのときだけ、確認した id を列挙して削除する
--    （決済済み payment_status='paid' の行が含まれる場合は削除せず、先に PAY.JP 側の返金・記録を確認する）
delete from bookings
where id in ('<確認したid1>', '<確認したid2>');
```
テスト施設・テストメニュー・テストアカウントは admin 画面 or Auth 画面から削除。

---

## 決済 Webhook 確認事項（解消済み）

Stripe 時代の論点（PAY-1〜PAY-4：webhook が 2 本あり同じ署名シークレットを使う・領収書の状態・金額の分岐）は、
2026年11月14日に決済を PAY.JP へ移したことで解消した。webhook は `/api/payjp/webhook` の 1 本で、
`X-Payjp-Webhook-Token` を照合し、`src/lib/payjp-webhook.ts` が広告枠・有料オプション・予約の前払いへ振り分ける。
前払いの金額は予約金額と店舗の前払い設定（fixed／percent）だけから決める（`src/lib/booking-payjp.ts`）。
