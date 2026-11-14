# 決済を Stripe から PAY.JP へ移した記録（2026年11月14日）

本人決定「Stripe は使用しない。PAY.JP を利用する」（2026年11月14日）に従い、残っていた Stripe 前提のコードを PAY.JP に置き換えた。
どの機能も本番では未公開（予約の前払いは「近日公開」表示だけ）。

## 機能ごとの扱い（本人に確認済み）

| 機能 | 以前（Stripe） | 今（PAY.JP） |
|---|---|---|
| 予約の前払い | `/api/payment/checkout`・`/api/stripe/checkout`（Checkout） | `/api/payment/charge` の 1 本。payjp.js のトークンで支払いを作って即時に確定する。金額は予約金額（full）か店舗の前払い設定（deposit：fixed＝円・percent＝予約金額の割合）だけから決める。店舗が前払いを設定していない（`deposit_type='none'`）予約は受け付けない |
| 領収書 | `/api/stripe/receipt?session_id=cs_...` | `/api/payment/receipt?payment_id=<booking_payjp_charges.id>` |
| 返金・チャージバック | Stripe webhook の `charge.refunded` / `charge.dispute.*` | PAY.JP webhook の `charge.refunded` / `dispute.created` で `booking_payjp_charges` と `bookings.payment_status` に写す。返金そのものは PAY.JP の管理画面で行う |
| 有料オプションの月額 | `/api/options/checkout`（Checkout の subscription） | 同じパスで PAY.JP の定期課金。施設の customer は広告枠と共用（`facility_payjp_customers`）。プランはオプションと税込月額ごとに `carelink_option_<key>_<価格>` を自動で作る。entitlement は定期課金の状態で決まる（`src/lib/options-payjp.ts`） |
| キャンセル料 | `/api/booking/[id]/cancel-fee`（以前から 404 の停止中スタブ） | 変更なし（下記「残っていること」） |
| 広告枠 | 2026年11月13日に PAY.JP 化済み（PR #930） | customer の用意を共通化しただけ |

webhook は `/api/payjp/webhook` 1 本で、`src/lib/payjp-webhook.ts` が振り分ける（`metadata.option_key` のある subscription.* → 有料オプション、それ以外の subscription.* → 広告枠、charge.* / dispute.created → 予約の前払い）。

## 本人がする設定

1. PAY.JP の管理画面で API キー（秘密鍵 `sk_live_...`・公開鍵 `pk_live_...`）と webhook の照合トークン（`whook_...`）を確かめる。
2. webhook の送信先に `https://carelink-jp.com/api/payjp/webhook` を登録する。
3. 置き場所：
   - `PAYJP_SECRET_KEY` / `PAYJP_WEBHOOK_TOKEN` … Cloudflare Worker の秘密値
   - `NEXT_PUBLIC_PAYJP_PUBLIC_KEY` … GitHub のリポジトリ変数（ビルド時に埋め込む公開値）
   - `PAYJP_FEATURED_PLAN_ID` … 広告枠を売るときだけ
4. 旧 `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` は、コードから参照が無くなったので Worker・Vercel から消してよい。Stripe の webhook 登録も不要。
5. 予約の前払いをお客様に出すときは、payjp.js で **3D セキュア付きのトークン**（`createToken(element, { three_d_secure: true, card: { name, email } })`）を作って `/api/payment/charge` に送る画面を作る（今は画面が無い）。PAY.JP 管理画面の「全てのトークン作成に対し3Dセキュアを必須とする」を有効にしておけば、指定漏れでも 3DS がかかる。

## DB

- migration `20261114100000_payjp_booking_and_option_payments.sql`：`booking_payjp_charges`・`facility_option_payjp_subscriptions` を追加（RLS 有効・service_role 専用）。**アプリの配信より前に適用する。**
- 旧 Stripe の表・列は残置（アプリからは読まない）。本番の行数を確かめてから、撤去する migration を別に作る。

## 残っていること（後続の判断）

- **キャンセル料の徴収**：`src/lib/cancel-fee.ts` の仕様は「客に金額を通知するだけで、徴収は店舗と客が直接やり取りする」（神原さん仕様）。PAY.JP で徴収するには、予約時にカードを預かる（customer 作成）同意と仕様の決め直しが要るので、今回は停止中のまま変えていない。
- **オプションの解約**：2026年11月14日に追加（`/api/options/subscription`・管理画面のリマインダー設定に「解約」）。期間末で解約し、期間末に webhook が entitlement を止める。
- **店舗からの返金操作**：PAY.JP の管理画面で行う前提。管理画面に返金ボタンは無い。
- `dispute.created` のデータの形（`charge` 項目）は公式ドキュメントで明記を確認できなかった。本番でテスト送信して確かめること。
