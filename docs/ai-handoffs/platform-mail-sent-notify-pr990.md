# PR #990 運営メール送信時の Slack 通知 — Codex 判定

## Claude経由のCodex判定（2026-11-25・初回・SHA 7c18ac06724d3346b9ed69c5754a81edf67e2f39）

## 判定　不合格

CareLink PR #990 の `git diff main...HEAD` を独立検査しました。同じメールの送信処理が並行し、両リクエストが同じ受付IDを得ると、Slack通知が二重に登録されます。

- 検査対象 `7c18ac06724d3346b9ed69c5754a81edf67e2f39`
- 比較元 `main` の `b3b8b63fc1f2c1e24166c545796990aa4e9c0872`
- ブランチ `claude/platform-mail-sent-notify-a49c3c`

### 指摘 MAIL-990-01　重要度：高

- **箇所** `POST send` の受付確認後にある `notifySent(confirmed)` と、`manage_platform_mail_atomic` の `reserve`・`observe`。 [route.ts](/Users/kam/Projects/carelink/.claude/worktrees/platform-mail-sent-notify-a49c3c/src/app/api/admin/mail/route.ts:194) · [DB関数](/Users/kam/Projects/carelink/.claude/worktrees/platform-mail-sent-notify-a49c3c/supabase/migrations/20261025143701_platform_mail_console.sql:105)
- **期待値** 同じメールの受付に対し、並行リクエストや再試行があってもSlack通知は1回。
- **実際値・再現条件** 同じメールに対する2件の `send` が、最初の受付保存前に `reserve` を通過し、送信サービスから同じ受付IDを得ると、双方が `observe` に成功し、それぞれ応答後の通知を登録します。即時送信と予約送信の両方が該当します。
- **根拠** `reserve` は `pending` の行をそのまま返すため、両リクエストが同じメールIDを送信サービスの冪等キーとして使えます。即時送信では後続の `observe` が既存の `sent` 行を成功として返し、予約送信では `scheduled` 行に `accepted` を再適用して成功します。ルートは受付を初めて保存した呼び出しを判別せず、どちらも通知します。追加された「1回」のテストは、`send` を1回だけ実行しています。 [送信サービス呼び出し](/Users/kam/Projects/carelink/.claude/worktrees/platform-mail-sent-notify-a49c3c/src/lib/platform-mail-delivery.ts:26) · [受付保存](/Users/kam/Projects/carelink/.claude/worktrees/platform-mail-sent-notify-a49c3c/supabase/migrations/20261025143701_platform_mail_console.sql:138) · [追加テスト](/Users/kam/Projects/carelink/.claude/worktrees/platform-mail-sent-notify-a49c3c/src/app/api/admin/mail/__tests__/route.test.ts:282)

### 確認範囲と実行結果

差分と既存経路を読み、即時・予約送信、問い合わせに紐づく場合の `contact_reply_sent` 再利用、紐づかない場合の受付番号先頭8文字と `/admin/mail` リンク、既存の認証・CSRF・管理者権限確認を確認しました。紐づかない通知には宛先・氏名・件名・本文・完全な受付番号が含まれません。通知は `runAfterResponse` に登録され、Slackの失敗応答や例外は送信結果に影響しません。受付結果不明、受付保存未確認、`refresh`・`cancel`・`sync` の経路では通知が登録されません。

`git diff --check main...HEAD` は通過しました。関連Jest 3スイートは、読み取り専用環境で一時ファイルの作成が拒否され、テスト開始前に停止しました。二重通知の判定はコードとDB関数の実行経路に基づきます。ブラウザ受入と実送信は未実施です。ファイルは変更していません。

## Claude経由のCodex判定（2026-11-25・再検査・SHA 368fc1a50282f83c47d49fe3a2d3f9e082c7341b）

**判定　合格（PR #990 の依頼範囲）**  
**判定対象 SHA** `368fc1a50282f83c47d49fe3a2d3f9e082c7341b`

`git diff 7c18ac06..HEAD` と `git diff main...HEAD` を確認し、関連する Jest 3スイート・132件がすべて成功しました。

**指摘 `MAIL-990-01`（重要度：中）　解消。新規指摘なし。**

- **箇所**　`src/app/api/admin/mail/route.ts:23` の `notifySent`
- **期待値**　同じメールへの並行 `send` が両方とも送信受付の保存に成功しても、Slack 通知は最大1回。
- **実際値・根拠**　各処理は `platform-mail-notify:<id>` をキーに `check_rate_limit` を1回呼び、エラーなしで `false` を得た処理だけが通知します。指定のマイグレーションでは、主キーに対する `INSERT … ON CONFLICT DO UPDATE` がカウントを原子的に更新します。同じキーで競合すると、最初の処理はカウント `1` で `false`、後続は `2` 以上で `true` になります。

**回帰確認**　Slack に氏名・宛先・件名・本文を含めず、新規メールは受付番号の先頭8文字と予約の有無、問い合わせ返信は既存の `contact_reply_sent` を使用します。判定と通知は `runAfterResponse` 内で実行され、RPC や Slack の失敗で送信結果は変わりません。送信結果不明、受付結果の保存失敗、`refresh`、`cancel` では通知を登録しません。

読み取り専用環境のため、Jest はキャッシュの永続化を止めて実行しました。並行処理の原子性は SQL 定義で確認し、実 DB での並行試験と実 Slack 送信は未実施です。ファイル変更はありません。
