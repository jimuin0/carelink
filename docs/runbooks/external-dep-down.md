# 外部依存ダウン Runbook

| 項目 | 値 |
|---|---|
| 重要度 | 🔴 高 |
| 想定対応時間 | 60分（外部復旧待ち含む） |
| 最終訓練日 | 2026-05-25 |

---

## 1. 検知方法

### 自動検知パス
- **Sentry**: `fetch failed` / `ENOTFOUND` / `ETIMEDOUT` の急増
- **Vercel Logs**: Functions が外部 API 呼出で 5xx
- **Slack `#alerts-prod`**: SaaS 障害通知（外形監視 or status page Webhook）
- **startup_check / `/api/health`**: 起動時依存系チェック NG

### 手動検知パス
- 各 SaaS の Status Page を直接確認
- 自分のブラウザで CareLink を操作し、特定機能のみ NG を確認

---

## 2. 初動 5 分

1. **症状から該当 SaaS を特定**（決済 → Stripe、認証/DB → Supabase 等）
2. 下表の **Status Page URL** を開き、incident 発表有無を確認
3. Sentry / Vercel Logs で「自社コードの bug」か「外部依存起因」かを切り分ける
4. 観測事実を Slack `#alerts-prod` に投稿
5. 影響範囲（特定機能 / 全体 / 一部ユーザー）を見極める

---

## 3. 判断分岐

- **条件 A — 該当 SaaS が status page で incident 公表中**
  → 手順 X: 外部復旧待ち。フォールバック挙動（下表）を確認 + 顧客告知判断
- **条件 B — status page は緑だが自社からだけ NG**
  → 手順 Y: 自社側の API キー失効 / ネットワーク / DNS を疑う
  ([secret-leak.md](./secret-leak.md) で Revoke 履歴を確認)
- **条件 C — 複数 SaaS が同時に NG**
  → 手順 Z: Vercel / 上流 CDN / DNS を疑う

---

## 4. 復旧手順

### 4-1. 外部依存マッピング表

| SaaS | Status Page URL | 用途 | フォールバック挙動 |
|---|---|---|---|
| Vercel | https://www.vercel-status.com | ホスティング / Functions | なし（ホスティング自体の停止は致命） |
| Supabase | https://status.supabase.com | DB / Auth / Storage | なし。DB 起因は [database-incident.md](./database-incident.md) |
| Stripe | https://status.stripe.com | 決済 / Webhook | Webhook はリトライキューあり（commit `cc08860`） |
| Upstash | https://status.upstash.com | Rate Limit (Redis) | **あり**: in-memory フォールバック（commit `5ebfe30`） |
| Resend | https://resend-status.com | メール送信 | email skip（DB には登録継続） |
| LINE | https://developers.line.biz/console/ + LINE Status | 予約通知 / LIFF | 署名検証 fail → ログ記録のみ（過去 `d43cd11` 参照） |

### 4-2. フォールバックが効いているかの確認
- Upstash: `lib/rate-limit` のログに `fallback to in-memory` が出ているか
- Resend: メール送信失敗ログが `audit_logs` に記録されているか
- LINE: webhook 失敗が queue に積まれているか

### 4-3. 顧客告知判断基準

以下 **いずれかに該当** すれば告知:

- 主要導線（求職者登録 / サロン掲載 / 決済）が **5 分以上** 完全停止
- 既ユーザーの一覧画面・ログインが完全停止
- フォールバックが効かず、データ欠損が発生する恐れ

告知方法:
- LP の trust band に一時的な障害告知バナーを掲示（神原さん承認後）
- 既存顧客には Resend 経由でメール（Resend ダウン中なら手動）

### 4-4. 復旧待ち中の運用
- 15 分ごとに status page を再確認し Slack に経過投稿
- 自社側で hotfix できる場合は PR 経由で対応（force-push 禁止）

---

## 5. 事後対応
- インシデントレポート作成（外部 SaaS 名・incident 公式 URL も記録）
- `audit_logs` で停止中の欠損 / 不整合データを洗い出し
- フォールバック未実装の SaaS があれば ADR 起票（Upstash 5ebfe30 と同様の設計）
- 顧客告知した場合は復旧告知も忘れずに

---

## 6. 連絡先・参考
- 神原さん（責任者）
- Slack `#alerts-prod`
- 各 SaaS Status Page（上表）
- 関連 commit: `5ebfe30`（Upstash in-memory フォールバック）
