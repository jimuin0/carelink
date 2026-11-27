# PR #996 未完了問い合わせを Slack のボタンから解決済みにする

- リポジトリ：jimuin0/carelink、ブランチ：claude/carelink-inquiry-backlog-1ce8ab、比較元：cabf39d9
- 依頼：毎朝の未完了通知に「解決済みにする」ボタンを付ける。自動では閉じない（2026-11-27 本人指示）

## Claude経由のCodex判定（2026-11-27・対象 33f7f33364a8b88f1222877f29f8f426a10b3a98）

**判定：不合格。** CareLink PR #996 の `33f7f33364a8b88f1222877f29f8f426a10b3a98` を、`git diff origin/main...33f7f333` で独立検査しました。比較元は `cabf39d9b515d3f85f13a2701ecd1f4231a8fd91` です。

| ID | 重要度 | 該当箇所 | 期待値 | 実際値・根拠 |
|---|---|---|---|---|
| PR996-01 | 高 | `src/lib/slack.ts:83,232`、`src/lib/preview-capabilities.ts:4` | Preview ではボタン付き通知も操作結果も Slack に送らない。 | 抑止条件は `VERCEL_ENV=preview` かつサービスロールキー未設定です。合成キーを設定した Preview 条件では通知と操作結果がそれぞれモックの `fetch` に到達し、キーなしではどちらも到達しないことを確認しました。基準 (3) に違反します。 |
| PR996-02 | 中 | `src/lib/slack.ts:220`、`src/lib/inquiry-slack-actions.ts:81`、`supabase/migrations/20260820000004_salons_profiles_email_canonical.sql:79` | Slack と CareLink で同じメールを持つ運営管理者がボタンから解決できる。 | Slack 側は前後の空白除去と小文字化だけですが、DB の `email_canonical` は Gmail のドットと `+` タグも除去します。両側の元アドレスが同じ `admin.example+tag@gmail.com` でも、DB 側の生成値は `adminexample@gmail.com` です。この条件をモックで確認し、`not_admin` が返って RPC が呼ばれないことを再現しました。 |
| PR996-03 | 中 | `src/lib/inquiry-slack-actions.ts:23,29–39`、`src/lib/inquiry-backlog.ts:211` | 朝の通知対象になった問い合わせを、Slack のボタンから解決できる。 | 21件を渡すとボタンは20個で、残りは管理画面へのリンクにまとめられます。古い20件が残り続けると、21件目以降には翌日以降もボタンが付きません。21件でのボタン数は対象コードを使って確認しました。 |

コード上では、署名検証がアクションの起動に先行し、管理者検索後も RPC が書き込み前に `is_platform_admin` を再確認します。朝の集計には問い合わせを自動で閉じる書き込みがなく、通知用の取得列にはメール・電話・本文が含まれません。既存の文章通知の呼び出しは残っており、新規の Slack 送信は `slack.ts` を経由します。解決処理とその例外処理は `runAfterResponse` に登録され、HTTP 200 の返却は処理完了を待ちません。

ファイル変更と実 Slack 送信はありません。`git diff --check` は通過しました。Jest は読み取り専用環境でキャッシュを書き込めず、起動前に停止しました。既存通知の実配信と interactions の3秒以内の応答時間は未計測です。
tokens used
63,795

## 指摘への対応（Claude）

- PR996-01：変更なし。Slack 送信の止め方は既存の postToSlack と同じ isPublicReadOnlyPreview（service-role の無い Preview）に揃えている。service-role を入れた Preview は公開閲覧専用ではない既存の扱いで、CLAUDE.md の運用でも Preview に service-role は置かない。送信の出口と止め方を1つに保つため、この PR では判定を変えない。
- PR996-02：修正。Slack のメールを canonicalizeEmail（DB の email_canonical と同じ規則）で揃えてから照合する。
- PR996-03：修正。20件で切らず、20件ごとに分けて全件にボタンを付ける。
