# Vercel デプロイ失敗 Runbook

| 項目 | 値 |
|---|---|
| 重要度 | 🟡 中 |
| 想定対応時間 | 15分 |
| 最終訓練日 | 2026-05-25 |

---

## 1. 検知方法

### 自動検知パス
- **Slack `#alerts-prod`**: Vercel Deployment failed Webhook
- **GitHub Actions**: `Deploy Watch` ワークフロー（Phase 2 で導入）が red
- **GitHub PR**: build dry-run の Check が ❌

### 手動検知パス
- `vercel` CLI 実行時に `Error: ...` 表示
- Vercel Dashboard → Deployments タブで Status=`Error`

---

## 2. 初動 5 分

1. **Vercel Dashboard → Deployments** で失敗 deployment の Build Logs を開く
2. エラーメッセージ末尾 20 行をコピーし Slack `#alerts-prod` に貼る
3. 直近 commit の hash と差分を `git log -1` で確認
4. 失敗が「本番のみ」か「PR preview でも再現」かを切り分ける
5. 神原さんに「観測事実のみ」を報告（推測でロールバックを始めない）

---

## 3. 判断分岐

- **条件 A — build エラー（TypeScript / ESLint / Next.js compile）**
  → 手順 X: ローカルで `npm run build` 再現 → 修正 PR → 再デプロイ
- **条件 B — `cron_jobs_limits_reached`（Hobby プラン制約）**
  → 過去事例あり（commit `d2a2441 fix: Vercel Hobby cron制約を回避してGitHub Actions に移行`）。
  Vercel cron を増やさず **GitHub Actions** に移行する
- **条件 C — 環境変数欠落（`SUPABASE_URL undefined` 等）**
  → Vercel Dashboard → Settings → Environment Variables で **キー名のみ** 確認（値は表示しない）
  → 欠落キーを神原さんに報告し「Vercel に直接入力してください」と依頼
- **条件 D — Vercel API / インフラ側障害**
  → [external-dep-down.md](./external-dep-down.md) の Vercel セクションへ

---

## 4. 復旧手順

### 4-1. 直近 deploy にロールバックする場合
1. Vercel Dashboard → Deployments → 最後に成功した deployment を選択
2. `...` メニュー → **Promote to Production**
3. 数分待ち、本番 URL で動作確認
4. CLI で実施する場合: `vercel rollback <deployment-url>`

### 4-2. Vercel API 経由で再デプロイする場合
- エンドポイント: `POST https://api.vercel.com/v13/deployments`
- 認証トークンの所在: `~/Library/Application Support/com.vercel.cli/auth.json`
- トークンは会話に貼らない（マスクして扱う）

### 4-3. force-push 判断基準
- **原則: 通常 NG**。`main` は Phase 1 ブランチ保護で **force-push 禁止** に設定済み
- 例外: secret 漏洩で履歴改変が必要な時のみ → [secret-leak.md](./secret-leak.md) 参照
- 上記以外で force-push が必要だと感じたら **必ず神原さんの明示承認** を取る

---

## 5. 事後対応
- インシデントレポート作成（時刻 / 検知経路 / 原因 / 復旧手順 / 再発防止）
- `audit_logs` テーブルで該当時間帯の異常 mutation が無いか確認
- 環境変数 / プラン制約が原因なら ADR 起票
- 同種を防ぐため CI チェック追加を検討（Phase 2 build dry-run 強化）

---

## 6. 連絡先・参考
- Vercel Dashboard: https://vercel.com/dashboard
- Vercel Status: https://www.vercel-status.com
- 神原さん（責任者）
- 関連 commit: `d2a2441`（Hobby cron 制約回避）
