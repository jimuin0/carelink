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

## Claude経由のCodex判定（2026-11-27・再検査・対象 ee83a16a47f1b25d032ca739449fdc60ac864c5c）

**判定：不合格。** CareLink PR #996 の対象コミット `ee83a16a47f1b25d032ca739449fdc60ac864c5c` を、前回の `33f7f333` および `origin/main`（`cabf39d9`）との差分で再検査しました。PR996-02 と PR996-03 の元の不具合は解消しました。PR996-01 は前回の合格基準に照らして未解消で、分割送信では Slack が HTTP 429 を返した場合に一部のボタンが欠落する経路も確認しました。

| ID | 重要度 | 該当箇所 | 期待値 | 実際値・根拠 |
|---|---|---|---|---|
| PR996-01 | 高 | `src/lib/slack.ts:83,215,232`、`src/lib/preview-capabilities.ts:4`、`CLAUDE.md:413–414` | Preview ではボタン付き通知と操作結果を Slack に送信しない。 | **未解消。** 既存の `postToSlack` と同じ判定を使う設計は、サービスロールキーを置かない現行の公開 Preview 運用には妥当です。前回の基準は Preview 全体が対象です。`VERCEL_ENV=preview` で合成のサービスロールキーを設定すると、通知と操作結果の両方がモックの `fetch` に到達し、キーを外すと両方とも抑止されました。現行の運用ルールを根拠に、前回の基準を満たしたとは判定できません。 |
| PR996-02 | 中 | `src/lib/inquiry-slack-actions.ts:91`、`supabase/migrations/20260820000004_salons_profiles_email_canonical.sql:79–87` | Slack のメールを DB の生成列と同じ規則で照合し、一意に一致した運営管理者の操作を受け付ける。 | **解消。** `canonicalizeEmail` を照合前に適用します。`Admin.Example+tag@googlemail.com` が `adminexample@gmail.com` に正規化され、運営管理者が1人一致した場合に解決 RPC が呼ばれることをモックで確認しました。 |
| PR996-03 | 中 | `src/lib/inquiry-slack-actions.ts:47–61`、`src/lib/inquiry-backlog.ts:211` | 20件を超えても、通知対象の全件にボタンが付く。 | **元の打ち切りは解消。** 送信成功条件で0・1・20・21・40・41件を試し、全IDが順序どおり重複なく含まれ、1通あたり最大42ブロックに収まることを確認しました。 |
| PR996-04（新規） | 中 | `src/lib/inquiry-slack-actions.ts:51–61`、`src/lib/slack.ts:103–120`、`src/lib/inquiry-backlog.ts:185,211` | 分割投稿が一時的なレート制限を受けても、該当分を再送できる。 | 41件のうち2通目に HTTP 429 と `Retry-After` を返すと、2通目を再試行せず3通目へ進みます。呼び出し元は送信失敗を示す `false` を使わず、当日の通知枠は取得済みのため、21〜40件目のボタンが当日分から欠落します。この経路はモックで確認しました。実環境での429発生頻度は未計測です。[Slack の投稿レート制限](https://docs.slack.dev/apis/web-api/rate-limits/) |

差分上、既存の文章通知、Slack 署名の先行検証、DB 側の管理者再確認は維持されています。朝の集計に問い合わせを自動で閉じる処理はありません。両差分の `git diff --check` は通過しました。Jest は読み取り専用環境でキャッシュ書き込みに失敗し、テスト開始前に停止しました。実 Slack 送信と応答時間の計測は未実施です。ファイル変更はありません。

## 再検査の指摘への対応（Claude）

- PR996-04：修正。一時的な失敗（http_429 等）は 1.5 秒待って 1 回だけ送り直す。設定不足・Preview は送り直さない。それでも欠けた件は解決済みになるまで翌朝も出る。
- PR996-01：コードは変えず、本人に判断を仰ぐ。検査基準 (3)「Preview では送らない」は Claude が書いたもので、既存の Slack 送信の出口（postToSlack）の止め方は「service-role の無い Preview」。Codex も現行運用には妥当と判定。基準を既存どおりに改めるか、Slack 送信全体の Preview 判定を広げる別作業にするかは本人が決める。
