# シークレット漏洩 Runbook

| 項目 | 値 |
|---|---|
| 重要度 | 🔴 高 |
| 想定対応時間 | 60分 |
| 最終訓練日 | 2026-05-25 |

---

## 1. 検知方法

### 自動検知パス
- **GitHub Push Protection**: push 時に secret detection で reject
- **GitHub Secret Scanning Alerts**: Security タブの notification
- **gitleaks / pre-commit hook**: ローカル commit 時の検知（Phase 1 で導入）
- **Slack `#alerts-prod`**: secret scanner 通知

### 手動検知パス
- コードレビューで `.env` 値・トークンが diff に混入
- ログ / Slack 投稿に API key・Webhook URL が貼られた
- 第三者からの指摘

---

## 2. 初動 5 分

1. **絶対に該当値を会話・Slack に再掲しない**（マスクして扱う）
2. 漏洩したシークレットの **種別・範囲** を特定（どの SaaS / どの権限 / 公開 repo か private か）
3. 神原さんに「漏洩疑い」を即報告（5 分以内）
4. **Revoke 優先** か **履歴除去優先** かを神原さんと判断
5. 漏洩 commit hash / file path / line を控える（後の filter-repo 用）

---

## 3. 判断分岐

- **条件 A — 第三者がアクセス可能な状態（public repo / 公開 Slack channel）**
  → 手順 X: **即時 Revoke が最優先**。履歴除去は後でよい
- **条件 B — private repo 内のみで第三者アクセス不能**
  → 手順 Y: Revoke と履歴除去を並行で実施
- **条件 C — GitHub Push Protection でブロックされた（まだ remote に出ていない）**
  → 手順 Z: 履歴改変のみで OK（Revoke 不要）。ただし疑わしければ Revoke

---

## 4. 復旧手順

### 4-1. 即時 Revoke 順序（影響範囲別）

優先度が高い順に実施:

1. **金銭直結**: Stripe Secret Key / Webhook Signing Secret
2. **書込 SaaS**: Supabase Service Role Key / Resend API Key / LINE Channel Secret
3. **通知系**: Slack Webhook URL
4. **読取系**: Supabase anon key（影響軽微だが念のため）

各 SaaS の Dashboard で **rotate / revoke** を実行し、新キーを Vercel 環境変数に **直接入力**（会話に貼らない）。

### 4-2. git 履歴からの除去

過去事例: **Slack Webhook URL 漏洩（commit `28aa5da`）** を `git filter-repo --replace-text` で履歴除去した実績あり。

手順:
1. 漏洩文字列を `secrets.txt` に列挙（`<漏洩文字列>==><REDACTED>` 形式）
2. `git filter-repo --replace-text secrets.txt --force` を実行
3. 全ブランチ・タグで除去されたか `git log --all -p | grep -F "<部分文字列>"` で確認
4. 共同作業者全員に「履歴改変したので再 clone してください」と通知

### 4-3. force-push 判断基準

- **原則 NG**: `main` は Phase 1 でブランチ保護 force-push 禁止
- **例外**: シークレット履歴除去のみ許可。ただし **神原さんの明示承認必須**
- 承認後: GitHub Settings → Branches → 一時的に保護を緩める → force-push → 即座に保護を戻す
- 実施後は必ず Slack `#alerts-prod` に「force-push 完了」を投稿

### 4-4. GitHub Push Protection エラー時の対応

- 「Push cannot contain secrets」エラー画面 URL を確認
- **bypass を選ばない**（誤検知でない限り）
- 該当 commit を `git reset --soft HEAD~N` で巻き戻し
- 該当行を除去 → 新規 commit → push
- 既に他ブランチに残っているなら 4-2 の filter-repo を実施

---

## 5. 事後対応
- インシデントレポート作成（漏洩値はマスク）
- `audit_logs` で漏洩期間中の該当 SaaS 経由の異常操作を確認
- ADR 起票: 「なぜ漏洩したか・再発防止策」
- pre-commit hook / gitleaks の設定見直し
- 共同作業者への通知（履歴改変した場合は re-clone 依頼）

---

## 6. 連絡先・参考
- 神原さん（責任者）
- Slack `#alerts-prod`
- GitHub Security tab
- 各 SaaS Dashboard（Stripe / Supabase / Slack / Resend / LINE）
- 過去事例: commit `28aa5da`（Slack Webhook URL 漏洩 → filter-repo 除去）
