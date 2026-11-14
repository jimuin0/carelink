# 5xx 急増 Runbook

| 項目 | 値 |
|---|---|
| 重要度 | 🔴 高 |
| 想定対応時間 | 15分 |
| 最終訓練日 | 2026-05-25 |

---

## 1. 検知方法

### 自動検知パス
- **Slack `#alerts-prod`（エラー通知）**: `withRoute` の catch／500 応答と `instrumentation.ts` の onRequestError が `alertCaughtError` → `src/lib/alert.ts` 経由で通知（Sentry は廃止済み・`safeCaptureException` は console.error を出すだけ）
- **Vercel Logs**: Functions タブで 5xx 集中
- **Slack `#alerts-prod`**: cron 失敗通知
- **`/api/health`**: 外形監視タイムアウト

### 手動検知パス
- ユーザー報告（フォーム送信できない / API 401・500）
- 自分でアクセスして 5xx を再現

---

## 2. 初動 5 分

1. **Slack `#alerts-prod`** → 過去 30 分のエラー通知（route・status・tag）を確認し、最多の endpoint を特定
2. **Vercel Logs** → 該当 endpoint の生ログ（`safeCaptureException` の console.error を含む）を 10 行確認
3. 観測順序: **Slack → Vercel logs** で並べ、時系列を Slack に投稿
4. 注意: `withRoute` を使っていない route.ts の「return による 500」は通知されない（`src/__tests__/silent-500-guard.test.ts` の台帳）。Slack が静かでも Vercel Logs を必ず見る
5. 直近 deploy 時刻と error 開始時刻の相関を確認

---

## 3. 判断分岐

- **条件 A — 直近 deploy 直後にエラー開始**
  → 手順 X: `vercel rollback <last-good-deployment-url>` で即時ロールバック
- **条件 B — deploy と無関係 / 外部 SaaS 起因**
  → [external-dep-down.md](./external-dep-down.md) へ
- **条件 C — DB エラー（`PGRST` / `RLS` / connection refused）**
  → [database-incident.md](./database-incident.md) へ
- **条件 D — 特定 endpoint のみ 5xx（rate-limit）**
  → レート制限は Supabase RPC `check_rate_limit` を優先し、失敗時は in-memory へ倒す（`src/lib/rate-limit.ts`・本体を 500 化させない）。
  Vercel Logs に `[rate-limit] Supabase RPC failure, falling back to in-memory` が出ていればフォールバック中＝Supabase 側を [database-incident.md](./database-incident.md) で確認
  （過去事例: 旧 Upstash 構成で DNS 喪失により全 mutation API 500。Upstash は撤去済み）

---

## 4. 復旧手順

### 4-1. ロールバック優先（迷ったらまずこれ）
1. Vercel Dashboard → Deployments → 直前 success deployment を Promote
2. もしくは `vercel rollback <deployment-url>`
3. 5xx が止まるか Slack `#alerts-prod` / Vercel logs で確認

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
- Slack 通知件数・Vercel Logs の 5xx 件数 / 影響ユーザー数を記録
- 再発防止用 ADR を起票（外部依存のフォールバック設計など）
- L7 監視（startup_check / /health）が機能していたか振り返り

---

## 6. 連絡先・参考
- Vercel Logs: https://vercel.com/dashboard
- Slack `#alerts-prod`
- 神原さん（責任者）
- 関連: レート制限は Supabase RPC `check_rate_limit`＋in-memory フォールバック（`src/lib/with-route.ts`・Upstash は撤去済み）
