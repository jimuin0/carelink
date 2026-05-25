# DB（Supabase）起因インシデント Runbook

| 項目 | 値 |
|---|---|
| 重要度 | 🔴 高 |
| 想定対応時間 | 60分 |
| 最終訓練日 | 2026-05-25 |

---

## 1. 検知方法

### 自動検知パス
- **Sentry**: `PGRST` / `permission denied` / `connection refused` エラー
- **Vercel Logs**: Functions で Supabase クライアントが timeout
- **Slack `#alerts-prod`**: DB error 集中通知
- **`/api/health`**: Supabase 依存チェック NG

### 手動検知パス
- ログインできない / 新規登録できない報告
- 自分のブラウザで再現確認
- Supabase Dashboard で error rate スパイク

---

## 2. 初動 5 分

1. **Supabase Dashboard** → Project Health / Logs を開く
2. **症状を 3 分類に切り分け**:
   - 接続不能（DNS / token 失効 / Supabase ダウン）
   - マイグレーション失敗
   - RLS 違反検知 / trigger 異常
3. Sentry の top error メッセージを Slack に投稿
4. Supabase status page を確認（[external-dep-down.md](./external-dep-down.md) 参照）
5. 直近の DB マイグレーション / トリガー変更 commit を `git log` で確認

---

## 3. 判断分岐

- **条件 A — 全 API が 5xx / 接続不能**
  → 手順 X: Supabase status 確認 → 緑なら token 失効疑い
- **条件 B — マイグレーション直後にエラー開始**
  → 手順 Y: マイグレ rollback（4-2 参照）
- **条件 C — 特定機能のみ permission denied / RLS 違反**
  → 手順 Z: 該当テーブルの RLS policy 確認
- **条件 D — Google OAuth 経由ユーザーの表示名が空 / プロフィール異常**
  → 過去事例: **`handle_new_user` trigger が Google OAuth `name` を拾えず空ユーザー量産**
    （commit `ed0f98d fix: Google OAuth ユーザーの表示名空欄問題＋登録ログのaudit_logs統合`）
  → trigger SQL を確認し、`raw_user_meta_data` の `name` / `full_name` / `given_name` 全パスを拾えているか

---

## 4. 復旧手順

### 4-1. 接続不能（DNS / token 失効）
1. Supabase Dashboard → Settings → API でキー類が有効か確認（**値は会話に貼らない**）
2. token rotate された痕跡があれば Vercel 環境変数を更新（直接入力）
3. DNS 起因の場合は status page 経過観察 + [external-dep-down.md](./external-dep-down.md) 参照

### 4-2. マイグレーション rollback 手順
1. 失敗したマイグレーション SQL を特定（`supabase/migrations/` 配下 or Dashboard SQL Editor 履歴）
2. 影響テーブルの **直前 snapshot** が Supabase backup にあるか確認
3. 逆方向 SQL を用意（`DROP COLUMN` の逆は `ADD COLUMN` 等）
4. **Staging で先に検証** してから本番適用（時間がかかっても確実性優先）
5. 適用後 `audit_logs` で副作用を確認

### 4-3. RLS 違反検知時
1. 該当テーブルの RLS policy を Supabase Dashboard で確認
2. policy 変更 commit を `git log -- supabase/` で特定
3. policy を旧版に戻す PR を作成（直 push 禁止）
4. 違反期間中のデータ漏洩 / 改変有無を `audit_logs` で確認

### 4-4. trigger 異常時（過去事例: `handle_new_user`）
1. Supabase SQL Editor で `\df handle_new_user` 相当を確認
2. trigger 内の `INSERT` 列マッピングが OAuth `raw_user_meta_data` 構造と整合か確認
3. 修正 SQL を staging で適用 → 本番適用
4. 既に量産された不整合ユーザーは別途 backfill スクリプトで修復

---

## 5. 事後対応
- インシデントレポート作成（影響行数・テーブル名を明記）
- `audit_logs` で異常期間中の mutation を全件確認
- 不整合データがあれば backfill スクリプト作成 → 神原さん承認 → 実行
- ADR 起票（trigger / RLS / マイグレ設計の再発防止）
- 同種 trigger を持つ他テーブルも横展開で点検

---

## 6. 連絡先・参考
- 神原さん（責任者）
- Slack `#alerts-prod`
- Supabase Dashboard / Status: https://status.supabase.com
- 関連 commit: `ed0f98d`（handle_new_user trigger 修正）
- 関連 runbook: [external-dep-down.md](./external-dep-down.md), [500-surge.md](./500-surge.md)
