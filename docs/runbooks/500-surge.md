# 5xx 急増 Runbook

| 項目 | 値 |
|---|---|
| 重要度 | 🔴 高 |
| 想定対応時間 | 15分 |
| 最終訓練日 | 2026-05-25 |

---

## 1. 検知方法

### 自動検知パス
- **Sentry**: error rate スパイク通知
- **Vercel Logs**: Functions タブで 5xx 集中
- **Slack `#alerts-prod`**: error / cron 失敗通知
- **`/api/health`**: 外形監視タイムアウト

### 手動検知パス
- ユーザー報告（フォーム送信できない / API 401・500）
- 自分でアクセスして 5xx を再現

---

## 2. 初動 5 分

1. **Sentry** → 過去 30 分の top error を 1 件確認（メッセージとスタック）
2. **Vercel Logs** → 該当 endpoint の生ログを 10 行確認
3. **Slack `#alerts-prod`** → 直近の通知タイムラインを確認
4. 観測順序: **Sentry → Vercel logs → Slack** で並べ、時系列を Slack に投稿
5. 直近 deploy 時刻と error 開始時刻の相関を確認

---

## 3. 判断分岐

- **条件 A — 直近 deploy 直後にエラー開始**
  → 手順 X: `vercel rollback <last-good-deployment-url>` で即時ロールバック
- **条件 B — deploy と無関係 / 外部 SaaS 起因**
  → [external-dep-down.md](./external-dep-down.md) へ
- **条件 C — DB エラー（`PGRST` / `RLS` / connection refused）**
  → [database-incident.md](./database-incident.md) へ
- **条件 D — 特定 endpoint のみ 5xx（rate-limit / Upstash）**
  → 過去事例あり: **Upstash DNS 喪失で全 mutation API 500**。
  commit `5ebfe30 fix: checkRateLimit を Upstash 障害時に in-memory フォールバック` の fail-safe で復旧
  → 現状の fail-safe が効いているか `lib/rate-limit` のログ確認

---

## 4. 復旧手順

### 4-1. ロールバック優先（迷ったらまずこれ）
1. Vercel Dashboard → Deployments → 直前 success deployment を Promote
2. もしくは `vercel rollback <deployment-url>`
3. 5xx が止まるか Sentry / Vercel logs で確認

### 4-2. ロールバックで止まらない場合（外部依存起因確定）
1. 該当 SaaS の status page を確認
2. fail-safe（in-memory rate-limit 等）が機能しているかログで確認
3. 顧客影響範囲を Slack に投稿し神原さんと方針相談

### 4-3. hotfix が必要な場合
- 必ず `main` 直 push せず PR 経由
- CI green 確認 → 神原さん承認 → merge → 自動デプロイ
- ブランチ保護のため `--force` push は禁止

---

## 5. 事後対応
- インシデントレポート作成
- `audit_logs` で 5xx 期間中の不正 mutation 痕跡を確認
- Sentry の error count / 影響ユーザー数を記録
- 再発防止用 ADR を起票（外部依存のフォールバック設計など）
- L7 監視（startup_check / /health）が機能していたか振り返り

---

## 6. 連絡先・参考
- Sentry Dashboard
- Vercel Logs: https://vercel.com/dashboard
- Slack `#alerts-prod`
- 神原さん（責任者）
- 関連 commit: `5ebfe30`（Upstash fail-safe）
