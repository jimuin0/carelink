> ⚠️ **移設ノート（2026-08-09）**: このスキルは元々 `soel` リポジトリに集約されていたが、
> セッションがそのプロジェクト自身を開いた時にだけ自動で読み込まれるよう、このリポジトリへ移設した。
> パス参照はリポジトリ相対に機械置換したが、venv パス・ローカル worktree の状態など
> Mac ローカル運用に固有の記述が残っている可能性がある。矛盾を見つけたら、
> このリポジトリ自身の CLAUDE.md（存在する場合）を正として扱うこと。

# /perfect-code-carelink — CareLink 全コード完全レビュー＆修正

## 実行方法（必須）
**Agent ツールを使って以下6つを1つのメッセージで同時呼び出しする（並行実行）。**
順番に実行しない。6つ全て同時に起動すること。

---

## 優先順位（矛盾が出た場合）
セキュリティ > 正確性（バグ・null安全） > 型安全 > コード品質

## 触らない範囲（過剰修正禁止）
- 動作確認済みのビジネスロジック（レセプト計算・予約競合チェック・Stripe価格計算）
- スタイル・リファクタリング（バグでない限り変えない）
- コメント追加・変数名変更（明示的に問題でない限り）

---

## ファイル読み取り鉄則（全エージェント共通・必須）
- **500行超のファイルは必ず先に `wc -l` で行数確認し、offset/limit で全行を分割読みすること**
  例: 1,500行のファイル → Read(offset=0,limit=500) → Read(offset=500,limit=500) → Read(offset=1000,limit=500)
- Read ツールはデフォルトで最大2000行。「全体を読む」指示でも2000行超は自動打ち切りになる
- **データファイル（*.csv / config/*.json / *.bak 等）は絶対に触らない（Edit 厳禁）**
  billing.csv・addresses.csv・atsumaru_name_map.csv 等はコードと無関係

---

## エージェント報告品質ルール（全エージェント共通・必須）

セキュリティチェック項目は **「問題なし」の一言禁止**。各項目を以下の形式で必ず記載すること:

- ✓ **項目名** (line XX): `確認したコード片`
- ✗ **項目名** (line XX): [問題内容] → Edit 済み
- ? **項目名**: 未確認（理由）→ 主エージェントが Step 4 で確認

全セキュリティ項目を上記形式で列挙してから、修正内容をまとめること。`?` が出た項目は主エージェントが grep で直接確認する。

---

## セキュリティ共通パターン（全APIルートで厳守）

### 通常 API ルートの実装順序
1. `checkCsrf(req)` → 失敗で 403
2. `inMemoryRateLimit()` または `checkRateLimit()` → 超過で 429
3. Supabase `getUser()` / `getAdminInfo()` → 未認証で 401
4. `schema.safeParse()` → 不正で 400
5. `createServiceRoleClient()` で DB 操作
6. `writeAuditLog()` (fire-and-forget)
7. メール/Slack 通知 (fire-and-forget)

### Cron ルートの実装順序
1. `checkCronAuth(req)` → 失敗で 401
2. バッチ処理メイン
3. `logCronRun()` または `withCronLog()` でログ記録
4. 返却: `{ processed: N, skipped: M }`

---

## Agent 1 への指示文（そのままコピーして渡す）

```
src/app/api/admin/ 配下の全 route.ts を Read ツールで確認し、以下を各ルートで検証・修正してください。

対象ルート（61本）:
accounting-export, ai-support, api-keys/[id], api-keys, backup, blog/[id], blog,
booking-status, catalog, chain/bulk-coupon, chain/bulk-publish, chat/[roomId],
community/posts/[id]/likes, community/posts/[id]/replies, community/posts,
coupons/[id], coupons, facility-verify, feature-flags/[id], feature-flags,
featured-ads, features/[id], features, gbp/place, gbp/posts, inquiries/[id],
job-applications/[id], job-applications, jobs/[id], jobs, menus/[id], menus,
moderation/[id], newsletter/[id], newsletter, packages/[id], packages,
payments-settings, platform-blog/[id], platform-blog, qa, registrations/[id],
registrations, report, review-summary, settings, staff/[id], staff/[id]/schedule,
staff, subscription-plans/[id], subscription-plans, telehealth/[id], telehealth,
treatment-plans/[id], treatment-plans, treatment-records/[id], treatment-records,
user-packages, user-subscriptions, white-label, white-label/verify

【セキュリティ実装順序（最優先）】
各ルートが以下の順序を守っているか確認:
1. checkCsrf(req) → 403
2. inMemoryRateLimit() または checkRateLimit() → 429
3. getAdminInfo() → 401（管理者認証）
4. schema.safeParse() → 400（Zodバリデーション）
5. createServiceRoleClient() で DB 操作
6. writeAuditLog() (fire-and-forget)

【IDOR・所有権チェック】
- facility_id / user_id をクエリパラメータで受け取る場合、getAdminInfo() で取得した facility_id と一致するか確認しているか
- admin が他施設のデータを取得・更新できないか

【エラーレスポンス】
- catch ブロックで error.message / stack がクライアントに漏れていないか
- 全て { error: '〜' } 形式のみ返しているか

問題があれば Edit で即修正。最後に修正箇所を番号付きリストで報告（問題なしの場合も「問題なし」と明記）。
ファイル数が多い場合は重大度順に確認し、問題が見つかれば即修正してから継続すること。

最後に TypeScript 構文確認:
cd . && npx tsc --noEmit 2>&1 | head -20
```

---

## Agent 2 への指示文（そのままコピーして渡す）

```
以下のファイルを Read ツールで確認し、セキュリティ・ロジックを検証・修正してください。

対象（予約・決済・認証・LINE関連）:
- src/app/api/booking/route.ts
- src/app/api/booking/[id]/cancel/route.ts
- src/app/api/booking/[id]/change/route.ts
- src/app/api/booking/[id]/cancel-fee/route.ts
- src/app/api/booking/[id]/ical/route.ts
- src/app/api/booking/complete/route.ts
- src/app/api/payment/checkout/route.ts
- src/app/api/payment/webhook/route.ts
- src/app/api/stripe/checkout/route.ts
- src/app/api/stripe/webhook/route.ts
- src/app/api/stripe/receipt/route.ts
- src/app/api/auth/line/route.ts
- src/app/api/auth/line/callback/route.ts
- src/app/api/line/webhook/route.ts
- src/app/api/liff/auth/route.ts
- src/app/api/liff/bookings/route.ts
- src/app/api/liff/coupons/route.ts
- src/app/api/liff/link/route.ts
- src/app/api/liff/points/route.ts
- src/app/api/google-calendar/route.ts
- src/app/api/google-calendar/callback/route.ts
- src/app/api/google-calendar/sync/route.ts

【セキュリティ実装順序（最優先）】
各ルートが以下の順序を守っているか確認:
1. checkCsrf(req) → 403（GET以外）
2. inMemoryRateLimit() または checkRateLimit() → 429
3. Supabase getUser() → 401（認証必要なルート）
4. schema.safeParse() → 400
5. createServiceRoleClient() で DB 操作

【予約・決済ロジック（重要）】
- POST /api/booking: サーバーサイドでメニュー価格を再計算しているか（クライアント渡し価格を信用しないか）
- POST /api/payment/webhook および /api/stripe/webhook: Stripe署名検証（constructEvent）が最初に行われているか
- POST /api/booking/[id]/cancel: 認証済みユーザーが自分の予約のみキャンセルできるか（IDOR）
- POST /api/booking/[id]/change: 認証済みユーザーが自分の予約のみ変更できるか（IDOR）
- LINE Webhook: X-Line-Signature 検証が行われているか

【グループ予約】
- src/app/api/group-booking/route.ts
- src/app/api/group-booking/[id]/route.ts
- src/app/api/group-booking/join/route.ts
上記3ファイルも確認（IDOR・重複参加防止）

【エラーレスポンス】
- catch ブロックで内部エラー情報がクライアントに漏れていないか

問題があれば Edit で即修正。最後に修正箇所を番号付きリストで報告（問題なしの場合も「問題なし」と明記）。

最後に TypeScript 構文確認:
cd . && npx tsc --noEmit 2>&1 | head -20
```

---

## Agent 3 への指示文（そのままコピーして渡す）

```
以下のファイルを Read ツールで確認し、セキュリティ・ロジックを検証・修正してください。

対象（ユーザー向けAPI・その他ルート）:
- src/app/api/profile/route.ts
- src/app/api/account/delete/route.ts
- src/app/api/review/route.ts
- src/app/api/favorites/route.ts
- src/app/api/recommendations/route.ts
- src/app/api/contact/route.ts
- src/app/api/chat/route.ts
- src/app/api/availability/route.ts
- src/app/api/slots/route.ts
- src/app/api/waitlist/route.ts
- src/app/api/salons/route.ts
- src/app/api/report/route.ts
- src/app/api/notify/route.ts
- src/app/api/nps/route.ts
- src/app/api/push/subscribe/route.ts
- src/app/api/referral/route.ts
- src/app/api/unsubscribe/route.ts
- src/app/api/intake/route.ts
- src/app/api/ab-test/route.ts
- src/app/api/facilities/suggest/route.ts
- src/app/api/facility/setup/route.ts
- src/app/api/symptoms/suggest/route.ts
- src/app/api/stations/route.ts
- src/app/api/health/route.ts
- src/app/api/sentry-check/route.ts
- src/app/api/v1/bookings/route.ts
- src/app/api/v1/customers/route.ts

【セキュリティ実装順序（最優先）】
各ルートが以下の順序を守っているか確認:
1. checkCsrf(req) → 403（GET以外）
2. inMemoryRateLimit() または checkRateLimit() → 429
3. Supabase getUser() → 401（認証必要なルート）
4. schema.safeParse() → 400
5. createServiceRoleClient() で DB 操作

【IDOR・所有権チェック】
- DELETE /api/account/delete: 認証済みユーザー自身のアカウントのみ削除できるか
- POST /api/review: 認証済みユーザーが他人の名義でレビューを投稿できないか
- POST /api/report: 認証確認が行われているか
- GET /api/v1/bookings, /api/v1/customers: APIキー認証が正しく実装されているか

【エラーレスポンス】
- catch ブロックで内部エラー情報がクライアントに漏れていないか

問題があれば Edit で即修正。最後に修正箇所を番号付きリストで報告（問題なしの場合も「問題なし」と明記）。

最後に TypeScript 構文確認:
cd . && npx tsc --noEmit 2>&1 | head -20
```

---

## Agent 4 への指示文（そのままコピーして渡す）

```
src/app/api/cron/ 配下の全 route.ts を Read ツールで確認し、以下を検証・修正してください。

対象 Cron（12本）:
booking-reminder, daily-summary, customer-segment, review-request,
sync-google-ratings, onboarding-followup, birthday-coupon, flag-reviews,
favorites-digest, waitlist-notify, webhook-retry, newsletter-digest

【Cron セキュリティ実装順序（最優先）】
各 Cron ルートが以下の順序を守っているか:
1. checkCronAuth(req) → 失敗で 401
2. バッチ処理メイン
3. logCronRun() または withCronLog() でログ記録
4. 返却: { processed: N, skipped: M }

【バッチロジック安全性】
- null / undefined アクセスで実行中断しないか（?.演算子・nullチェック）
- DB クエリのエラーが個別処理を超えてバッチ全体を止めないか（try/catch per item）
- waitlist-notify の CAS ガード: 競合通知防止ロジックが正しいか

【返却値】
- 全 Cron ルートが { processed: N, skipped: M } 形式で返しているか

問題があれば Edit で即修正。最後に修正箇所を番号付きリストで報告（問題なしの場合も「問題なし」と明記）。

最後に TypeScript 構文確認:
cd . && npx tsc --noEmit 2>&1 | head -20
```

---

## Agent 5 への指示文（そのままコピーして渡す）

```
以下のファイルを Read ツールで確認し、セキュリティ・堅牢性を検証・修正してください。

対象（セキュリティ基盤・lib）:
- src/middleware.ts
- src/lib/csrf.ts
- src/lib/rate-limit.ts
- src/lib/audit-logger.ts
- src/lib/cron-auth.ts
- src/lib/admin.ts
- src/lib/user.ts
- src/lib/validations.ts
- src/lib/validations-booking.ts
- src/lib/recaptcha.ts
- src/lib/webhook-queue.ts
- src/lib/redis.ts
- src/lib/feature-flags.ts

【middleware.ts】
- 認証チェックが必要なルートに正しく適用されているか
- HMAC署名付きキャッシュの TTL（5分）が正しく設定されているか
- 管理者ルート（/admin）への未認証アクセスが適切にブロックされるか

【csrf.ts】
- Origin/Referer ヘッダー検証が正しく実装されているか
- 両方なし or host不一致 → 403 を返しているか
- タイミング攻撃に対して安全か

【rate-limit.ts】
- Upstash Redis 優先、未設定時 In-memory フォールバックが正しく動作するか
- In-memory が 500 エントリ超過で自動クリーンアップされているか
- レート制限超過時に 429 を返しているか

【audit-logger.ts】
- writeAuditLog が fire-and-forget（await なし）で使われているか
- diffValues() が変更フィールドのみ記録しているか
- DB エラー時にサービス全体が止まらないか（try/catch）

【cron-auth.ts】
- timingSafeEqual でタイミング攻撃対策がされているか
- Bearer トークン検証が正しいか

【webhook-queue.ts】
- 失敗時のリトライロジックが正しく実装されているか
- 最大リトライ回数超過後の dead-letter 処理があるか

【redis.ts】
- 接続エラー時のフォールバックが実装されているか
- セッション管理で適切な TTL が設定されているか

問題があれば Edit で即修正。最後に修正箇所を番号付きリストで報告（問題なしの場合も「問題なし」と明記）。

最後に TypeScript 構文確認:
cd . && npx tsc --noEmit 2>&1 | head -20
```

---

## Agent 6 への指示文（そのままコピーして渡す）

```
以下のファイルを Read ツールで確認し、セキュリティ・型安全・null安全を検証・修正してください。

対象（pages・components・lib）:
- src/app/admin/gbp/page.tsx
- src/app/admin/settings/page.tsx
- src/app/facility/[slug]/page.tsx
- src/components/booking/BookingFlow.tsx
- src/app/mypage/profile/page.tsx
- src/app/register/page.tsx
- src/app/[prefectureSlug]/[secondSlug]/page.tsx
- src/app/[prefectureSlug]/page.tsx
- src/components/facility/ReviewForm.tsx
- src/components/facility/ReviewList.tsx
- src/lib/facilities.ts
- src/lib/gbp.ts
- src/lib/email.ts
- src/lib/line.ts
- src/lib/integrations/line-works.ts
- src/lib/push.ts
- src/lib/coupons.ts

【pages・components の確認項目】
- ユーザー入力をそのままサーバーアクション / fetch に渡していないか（XSS・インジェクション）
- next/navigation の useRouter / redirect が正しく使われているか
- 認証状態のチェックが Client Component で行われていないか（サーバー側で確認しているか）
- BookingFlow.tsx: 価格や枠の情報をクライアント側だけで計算していないか

【lib ファイルの確認項目】
- facilities.ts: SQL インジェクション対策（プレースホルダー使用）がされているか
- gbp.ts: Google API キーが環境変数から取得されているか、レスポンスのnullチェックがあるか
- email.ts: HTMLインジェクション防止がされているか、FROM アドレスがハードコードされていないか
- line.ts: LINE API トークンが環境変数から取得されているか、署名検証があるか
- push.ts: VAPID キーが環境変数から取得されているか

【null安全・型安全】
- optional chaining (?.) が必要な箇所で使われているか
- as unknown as T など危険なキャストが使われていないか
- 配列アクセス [0] などで undefined になりえる箇所に対してチェックがあるか

問題があれば Edit で即修正。最後に修正箇所を番号付きリストで報告（問題なしの場合も「問題なし」と明記）。

最後に TypeScript 構文確認:
cd . && npx tsc --noEmit 2>&1 | head -20
```

---

## 6エージェント完了後: 自分でクロスファイル整合性を確認

6エージェントの報告を受け取ったら、自分で以下を確認して追加修正:

1. middleware.ts の保護対象ルート ↔ 実際の API ルート実装の認証チェックが二重になっているか（多重防御として正常）、または片方だけの場合に漏れがないか
2. Stripe webhook / LINE webhook の署名検証がそれぞれ最優先で行われているか
3. 全エージェントの TypeScript エラーレポートを統合し、未解消のエラーがあれば追加修正する

## コミット前に私（主エージェント）が必ず実施すること

### Step 1: 想定外ファイルの排除
```bash
git diff --stat
```
→ *.csv / CLAUDE.md / config/*.json 等が含まれていれば即 `git checkout -- <file>` で戻す

### Step 2: 全差分の目視確認
```bash
git diff
```
→ エージェント報告と実際の差分が一致しているか確認する
→ 想定外の削除・追加がないか確認してからコミット

### Step 3: コミット後テスト
```bash
python -m pytest tests/ -q 2>&1 | tail -3
```

### Step 4: 私による自動セキュリティスキャン（エージェントの ? 項目と機械的補完）
```bash
cd src
grep -rn "error\.stack\|err\.stack" --include="*.ts" . | grep -v "test\|//"
grep -rn '`SELECT\|`INSERT\|`UPDATE\|`DELETE' --include="*.ts" . | grep -v "test"
grep -rn "\beval\b" --include="*.ts" . | grep -v "test\|//"
```
→ 出力があれば該当行を Read して確認・修正する

---

### 共通後処理（universal 委譲・自動最新化）

プロジェクト固有の確認完了後、`~/.claude/skills/perfect-code-universal/skill.md` を **Read** し、
**Step 4-0（?項目全件フォロー）と Step 5（最終報告フォーマット）** を実行・使用すること。
プロジェクト固有の確認結果（上記）も Step 5 のフォーマットに統合する。

> このセクションは変更しない。universal を改善すれば全専用スキルに自動反映される。
