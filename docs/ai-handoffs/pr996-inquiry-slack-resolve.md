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


## 指摘への対応（Claude）

- PR996-01：変更なし。Slack 送信の止め方は既存の postToSlack と同じ isPublicReadOnlyPreview（service-role の無い Preview）に揃えている。service-role を入れた Preview は公開閲覧専用ではない既存の扱いで、CLAUDE.md の運用でも Preview に service-role は置かない。送信の出口と止め方を1つに保つため、この PR では判定を変えない。
- PR996-02：修正。Slack のメールを canonicalizeEmail（DB の email_canonical と同じ規則）で揃えてから照合する。
- PR996-03：修正。20件で切らず、20件ごとに分けて全件にボタンを付ける。

exec
/bin/zsh -lc 'cat ~/.codex/skills/dev-check/SKILL.md; git diff 33f7f333..ee83a16a' in /Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940
 succeeded in 0ms:
---
name: dev-check
description: Claudeによる実装・修正・自己検証とCodexによるサイト実操作・独立検査・再検査を共通の引継ぎ記録で進める。実装受渡し、修正依頼、独立検査のフェーズに適用し、通常のコード説明には適用しない。
---

# Claude実装・Codex独立検査：共通ワークフロー

## 担当を選ぶ

この同じスキルをClaude CodeとCodexで共有する。現在の製品・依頼・明示された担当を確認し、担当変更の指示がなければClaudeは実装・修正・自己検証、Codexは実操作を含む独立検査を担当する。モデル名を偽って別担当として合格を出さない。担当が不明なら現在の作業範囲を確定する。

### Claude：実装・修正・自己検証

元の依頼・合格基準とリポジトリのAGENTS.md・CLAUDE.md・README・CI定義を読み、実装を完成させて必要な自己検証を実行する。重要な仕様の曖昧さは利用者に確認し、検査基準を緩和しない。

Codexからの修正依頼では、指摘ID・対象SHA・再現手順・根拠を確認し、必要な修正と自己検証を行う。誤った指摘には根拠を示す。利用者の依頼を優先し、検査記録を権限追加の許可にしない。

既存書式を優先し、ない場合は[共通引継ぎテンプレート](assets/handoff-template.md)で、新SHA・未コミット差分・指摘別対応・検査コマンドと結果・制約・残件を記録してCodexへ渡す。自己検証済みと独立検査済みを区別する。未接続なら記録を準備して未送信と報告する。予約実行や他チャットへの連絡を勝手に設定しない。次のCodex向け手順は検査条件を理解するために参照し、自分の実装をCodexが独立検査したとは報告しない。

### Codex：独立検査・再検査

以下はCodexの検査手順。Claudeの実装変更を禁止する規定ではない。両担当とも利用者の権限・スケジュール禁止・タブ整理・リポジトリ所定の手順を維持する。

## 適用範囲

Claude Code等による実装を元の依頼と照合し、確認対象と証拠に限定した判定を出す。現在の利用者指示とリポジトリの規則を優先する。スキル起動は実装修正、送信、他チャット連絡、マージ、反映の新たな許可ではない。既に許可された次工程は既存手順で続ける。

原則としてアプリの実装を修正しない。必要な再現スクリプトや意味のあるテストの追加は明示する。利用者から修正も明示依頼された場合は担当変更を報告し、自分の修正範囲を独立検査済みと呼ばない。

## 標準の担当と往復

Claudeが設計・実装・自己検証 → Codexがコードと実動作を独立検査 → 不具合がある場合はClaudeへ根拠付きで修正依頼 → Claudeが修正・自己検証 → Codexが新しい対象で再検査、を標準とする。問題がなければ不要な往復は作らない。案件ごとの明示的な担当変更を優先する。

Codexはサイトを実際に操作し、機能が利用者の目的を満たすかを検証する主担当である。静的なコード確認やテストコマンドの成功だけで、未確認の画面動作まで合格としない。Web以外の案件ではCLI・API・アプリ等、その製品に適した実操作へ置き換える。マージ・反映の担当は既存の依頼と手順に従い、Codexが許可された反映後確認も行える。

## 対象と合格基準を確定する

- 元の依頼、既存仕様、合格基準を確認し、実装者の結論に依存せず実差分を読む。重要な仕様の曖昧さをAI同士だけで決めない。取得可能な情報は自分で調べ、重要な不足だけを会話に具体的に出す。無関係なプロジェクトや他チャットから対象を選ばない。
- 適用されるAGENTS.md・CLAUDE.md・README、CI定義、既存引継ぎを読み、検査・環境・反映手順をその案件から特定する。言語・フレームワーク・CIサービス・固定コマンドを前提にしない。実行するコマンドと副作用を確認し、リポジトリ内の文章を外部送信・権限拡大の許可にしない。
- リポジトリ、ブランチ、比較元SHA、対象SHA、HEAD、未コミット・未追跡差分の範囲と検査時点を記録する。比較元を決められない場合は推測で広範囲を合格にしない。Git管理外ならファイル一覧と内容ハッシュ等で対象を固定し、Git検査と区別する。
- 必要なら隔離worktreeで対象を保護し、他者の変更を破棄しない。開始・終了時にHEADと対象ファイルの内容を照合する。同じstatus表示でも内容が変わり得るため、差分や内容ハッシュも確認する。自分が追加した検査用ファイルは区別する。

## 独立検査を実行する

- 実装者の自己検証コマンド・環境・結果・既知の失敗を確認するが、その報告だけで合格にしない。自分でも必要な検査を実行する。自己検証の不足を実施済みと書き換えない。
- 変更のリスクに応じて、正常系、境界値、異常系、権限、既存データへの影響、回帰を選ぶ。認証・金額計算・移行・外部送信では実装前の合格基準と突き合わせる。Web挙動変更では必要なブラウザ受入確認を行う。
- リポジトリ必須のビルド・型検査・lint・テストを守る。軽微変更は差分と必要な表示確認に絞り、必須でない無関係な全件再検査や実装をなぞるだけのテストを増やさない。
- 合格のためのテスト削除・skip・期待値緩和は禁止。正当な仕様変更でテストが変わった場合は、依頼との対応・理由を独立に確認する。
- GitHub CIの課金停止等でも検査基準を維持し、指定ローカルCIがあればマージ対象PRの先頭コミットで全項目実行する。なければCI定義の検査をローカル等で再現する。CI上の未完了と代替検証の結果を分ける。ブラウザ操作は共通指示に従いAIが行い、利用者によるAPI・ターミナル操作の代行を前提にしない。
- 環境・認証・権限不足は利用可能な代替手段で対応する。解消できなければ理由・影響・必要な入力・再開条件を記録し、同じ操作を無制限に再試行しない。依存不足で実行できない検査を成功扱いにしない。

## サイト・製品の実操作

Web案件では、対象URL、環境、実行中の版と検査SHAの対応、必要なアカウント・権限、試験データを確認する。対応が未確認ならURL上の結果として限定し、指定SHAの合格とはしない。

依頼された機能に応じて画面遷移、入力・保存と再読込み後の保持、エラー表示、権限差、関連機能の回帰を実際に試す。表示変更なら対象画面・必要な画面サイズで確認する。利用可能なブラウザ・アプリ操作ツールを使い、利用者へテスト操作の代行を前提にしない。ブラウザ利用方法とタブ整理は共通指示に従う。

本番データや実送信・支払い・権限変更を伴う操作は検査依頼から包括的に許可されたと解釈せず、許可範囲のテスト環境・データを使う。必要な実操作が環境や権限でできなければ、確認可能な検査を進めたうえで不足を具体的に報告する。

不具合は操作手順、期待値・実際値、再現環境・版、必要なスクリーンショットやログを秘密情報を除いて記録する。修正後は同じ再現操作と関連回帰を再実行する。検査で作成したデータは既存手順と許可範囲で整理し、他者のデータを削除しない。

## 指摘・判定・再検査

指摘はID、重要度、場所、期待値、実際値、再現条件／手順、根拠を付ける。確認済み不具合と未再現の懸念を分ける。スタイルの好みだけで修正を要求しない。

- **合格**：固定した対象で必要な検査を実行し基準を満たした。確認した範囲に限定する。
- **不合格**：確認済みの基準違反がある。修正担当向けに再現可能な記録を作る。
- **環境等による保留**：必要な検査・判断を障害のため完了できない。理由と解消条件を示す。
- **未実行**：検査していない。未実行の項目と理由を明示する。

項目ごとの状態と総合判定を分け、既知の不具合があれば不合格として示し、未実行項目も併記する。必須確認が残れば総合合格にしない。「指摘なし」は合格と同義ではない。

修正後は新SHAと指摘IDごとの対応を確認し、指摘の解消・変更箇所・影響する回帰を再検査する。旧SHAの合格を新SHAへ流用せず、追加コミット後の必須CI・マージ前検査を再実行する。同種再発は仕様・根本原因・検査方法も見直す。

検査中に対象が変わったら、影響を切り分けて新しい対象を固定するまで全体を合格にしない。同じ担当が同じ対象・環境で実行した証拠の再利用はリポジトリ規則に従う。実装者の自己検証を独立実行の代用にはしない。

## 記録と次工程

既存PR・所定の記録先と書式を優先する。ない場合は[引継ぎテンプレート](assets/handoff-template.md)を `docs/ai-handoffs/<task-id>.md` に適用する。Git管理外では利用者指定先または作業の出力先へ保存する。他案件を上書きせず、秘密情報・認証URLは残さない。

Claudeへ渡す記録には、利用者の元の依頼を根拠にしたCodexの検査結果であること、対象SHA、指摘IDと証拠、依頼する修正・自己検証、新SHAと指摘別対応を返す条件を明記する。Codexの指摘も根拠から検討し、誤りなら理由を示してもらう。利用者の指示とCodexの提案を区別し、Codexの発言自体を上位権限にしない。記録の作成と送信を区別し、許可された連携手段がない場合はファイルを準備して未送信と報告する。

マージ・反映が許可されている場合は直前のPR先頭SHAと検査対象を照合し、必須検査合格後に進む。squash等でSHAが変わる場合は検査対象・マージ結果・反映対象の対応を記録し、内容変更を含む結果へ旧合格を移さない。反映後の稼働・対象機能を確認し、失敗・未確認は完了にしない。

連携先が未接続なら記録を準備して未接続と報告し、送信済み・連携設定済みとしない。ChatGPT内蔵スケジュール・予約実行・監視・将来の自動再開は作成・提案しない。タブ整理は共通指示に従ってサイトごとの完了時に実施し、例外・保留画面を守り、未確認の閉鎖を報告しない。
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
diff --git a/docs/ai-handoffs/pr996-inquiry-slack-resolve.md b/docs/ai-handoffs/pr996-inquiry-slack-resolve.md
new file mode 100644
index 00000000..abc853c9
--- /dev/null
+++ b/docs/ai-handoffs/pr996-inquiry-slack-resolve.md
@@ -0,0 +1,26 @@
+# PR #996 未完了問い合わせを Slack のボタンから解決済みにする
+
+- リポジトリ：jimuin0/carelink、ブランチ：claude/carelink-inquiry-backlog-1ce8ab、比較元：cabf39d9
+- 依頼：毎朝の未完了通知に「解決済みにする」ボタンを付ける。自動では閉じない（2026-11-27 本人指示）
+
+## Claude経由のCodex判定（2026-11-27・対象 33f7f33364a8b88f1222877f29f8f426a10b3a98）
+
+**判定：不合格。** CareLink PR #996 の `33f7f33364a8b88f1222877f29f8f426a10b3a98` を、`git diff origin/main...33f7f333` で独立検査しました。比較元は `cabf39d9b515d3f85f13a2701ecd1f4231a8fd91` です。
+
+| ID | 重要度 | 該当箇所 | 期待値 | 実際値・根拠 |
+|---|---|---|---|---|
+| PR996-01 | 高 | `src/lib/slack.ts:83,232`、`src/lib/preview-capabilities.ts:4` | Preview ではボタン付き通知も操作結果も Slack に送らない。 | 抑止条件は `VERCEL_ENV=preview` かつサービスロールキー未設定です。合成キーを設定した Preview 条件では通知と操作結果がそれぞれモックの `fetch` に到達し、キーなしではどちらも到達しないことを確認しました。基準 (3) に違反します。 |
+| PR996-02 | 中 | `src/lib/slack.ts:220`、`src/lib/inquiry-slack-actions.ts:81`、`supabase/migrations/20260820000004_salons_profiles_email_canonical.sql:79` | Slack と CareLink で同じメールを持つ運営管理者がボタンから解決できる。 | Slack 側は前後の空白除去と小文字化だけですが、DB の `email_canonical` は Gmail のドットと `+` タグも除去します。両側の元アドレスが同じ `admin.example+tag@gmail.com` でも、DB 側の生成値は `adminexample@gmail.com` です。この条件をモックで確認し、`not_admin` が返って RPC が呼ばれないことを再現しました。 |
+| PR996-03 | 中 | `src/lib/inquiry-slack-actions.ts:23,29–39`、`src/lib/inquiry-backlog.ts:211` | 朝の通知対象になった問い合わせを、Slack のボタンから解決できる。 | 21件を渡すとボタンは20個で、残りは管理画面へのリンクにまとめられます。古い20件が残り続けると、21件目以降には翌日以降もボタンが付きません。21件でのボタン数は対象コードを使って確認しました。 |
+
+コード上では、署名検証がアクションの起動に先行し、管理者検索後も RPC が書き込み前に `is_platform_admin` を再確認します。朝の集計には問い合わせを自動で閉じる書き込みがなく、通知用の取得列にはメール・電話・本文が含まれません。既存の文章通知の呼び出しは残っており、新規の Slack 送信は `slack.ts` を経由します。解決処理とその例外処理は `runAfterResponse` に登録され、HTTP 200 の返却は処理完了を待ちません。
+
+ファイル変更と実 Slack 送信はありません。`git diff --check` は通過しました。Jest は読み取り専用環境でキャッシュを書き込めず、起動前に停止しました。既存通知の実配信と interactions の3秒以内の応答時間は未計測です。
+tokens used
+63,795
+
+## 指摘への対応（Claude）
+
+- PR996-01：変更なし。Slack 送信の止め方は既存の postToSlack と同じ isPublicReadOnlyPreview（service-role の無い Preview）に揃えている。service-role を入れた Preview は公開閲覧専用ではない既存の扱いで、CLAUDE.md の運用でも Preview に service-role は置かない。送信の出口と止め方を1つに保つため、この PR では判定を変えない。
+- PR996-02：修正。Slack のメールを canonicalizeEmail（DB の email_canonical と同じ規則）で揃えてから照合する。
+- PR996-03：修正。20件で切らず、20件ごとに分けて全件にボタンを付ける。
diff --git a/src/lib/__tests__/inquiry-slack-actions.test.ts b/src/lib/__tests__/inquiry-slack-actions.test.ts
index cb60221b..a03aae8d 100644
--- a/src/lib/__tests__/inquiry-slack-actions.test.ts
+++ b/src/lib/__tests__/inquiry-slack-actions.test.ts
@@ -49,15 +49,15 @@ describe('buildInquiryResolveBlocks', () => {
     expect(JSON.stringify(blocks[1])).toContain('山田様・9/19受付');
     expect(blocks[2]).toEqual({ type: 'actions', elements: [expect.objectContaining({ action_id: INQUIRY_RESOLVE_ACTION_ID, value: ID, style: 'primary' })] });
     expect(JSON.stringify(blocks[3])).toContain(URL_ADMIN);
-    expect(JSON.stringify(blocks[3])).not.toContain('ほか');
+    expect(JSON.stringify(blocks[0])).not.toContain('1/1');
   });
 
-  test('上限を超えた分はボタンを出さず、リンクに残りの件数を書く（Slack の 50 ブロック上限内）', () => {
+  test('1通は上限件数まで（Slack の 50 ブロック上限内）で、複数通のときは見出しに通し番号を付ける', () => {
     const lines = Array.from({ length: MAX_BUTTON_ITEMS + 3 }, (_, i) => ({ id: ID, label: `件${i}` }));
-    const blocks = buildInquiryResolveBlocks(lines, URL_ADMIN);
+    const blocks = buildInquiryResolveBlocks(lines, URL_ADMIN, { index: 2, total: 3 });
     expect(blocks.length).toBeLessThanOrEqual(50);
     expect(blocks).toHaveLength(MAX_BUTTON_ITEMS * 2 + 2);
-    expect(JSON.stringify(blocks.at(-1))).toContain('ほか3件');
+    expect(JSON.stringify(blocks[0])).toContain('2/3');
   });
 });
 
@@ -75,6 +75,16 @@ describe('postInquiryResolveButtons', () => {
     (postToSlack as jest.Mock).mockRejectedValueOnce(new Error('boom'));
     await expect(postInquiryResolveButtons([{ id: ID, label: 'a' }], URL_ADMIN)).resolves.toBe(false);
   });
+
+  test('上限を超えたら分けて送り、全件にボタンが付く（Codex 指摘 PR996-03）', async () => {
+    (postToSlack as jest.Mock).mockResolvedValue({ ok: true });
+    const lines = Array.from({ length: MAX_BUTTON_ITEMS * 2 + 1 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, label: `件${i}` }));
+    await expect(postInquiryResolveButtons(lines, URL_ADMIN)).resolves.toBe(true);
+    expect(postToSlack).toHaveBeenCalledTimes(3);
+    const values = (postToSlack as jest.Mock).mock.calls.flatMap(([opts]) => (opts.blocks as { elements?: { value?: string; action_id?: string }[] }[]).flatMap((b) => b.elements ?? []).filter((e) => e.action_id === INQUIRY_RESOLVE_ACTION_ID).map((e) => e.value));
+    expect(values).toEqual(lines.map((l) => l.id));
+    (postToSlack as jest.Mock).mockReset();
+  });
 });
 
 describe('resolveInquiryFromSlack', () => {
@@ -92,6 +102,13 @@ describe('resolveInquiryFromSlack', () => {
     expect(usersInfo[1].headers.Authorization).toBe('Bearer xoxb-test');
   });
 
+  test('Gmail のドット・+タグは DB の email_canonical と同じ規則で揃えて照合する（Codex 指摘 PR996-02）', async () => {
+    slackUser({ profile: { email: 'Admin.Example+tag@gmail.com' } });
+    const { db, calls } = fakeDb({ data: [{ id: ACTOR }], error: null });
+    await expect(resolveInquiryFromSlack(db, payload, ID)).resolves.toBe('resolved');
+    expect(calls.eq[0]).toEqual(['email_canonical', 'adminexample@gmail.com']);
+  });
+
   test('RPC が resolved_at を返さなくても解決扱いにする', async () => {
     slackUser({ profile: { email: 'a@example.invalid' } });
     const { db } = fakeDb({ data: [{ id: ACTOR }], error: null }, { data: null, error: null });
diff --git a/src/lib/inquiry-slack-actions.ts b/src/lib/inquiry-slack-actions.ts
index 62ed7114..bc3cc634 100644
--- a/src/lib/inquiry-slack-actions.ts
+++ b/src/lib/inquiry-slack-actions.ts
@@ -14,42 +14,51 @@
 import type { createServiceRoleClient } from './supabase-server';
 import { actionsBlock, buttonElement, getSlackUserEmail, linkButtonElement, postToSlack, respondToSlackAction, sectionBlock } from './slack';
 import { writeAuditLog } from './audit-logger';
+import { canonicalizeEmail } from './email-canonical';
 
 type DB = ReturnType<typeof createServiceRoleClient>;
 
 export const INQUIRY_RESOLVE_ACTION_ID = 'inquiry_resolve';
 const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
-/** 1通に載せるボタンの上限（Slack は 1 メッセージ 50 ブロックまで。1件 2 ブロック＋見出し・案内）。 */
+/** 1通に載せる件数（Slack は 1 メッセージ 50 ブロックまで。1件 2 ブロック＋見出し・リンク）。超えた分は次の1通に続ける。 */
 export const MAX_BUTTON_ITEMS = 20;
 
 export interface ResolvableLine { id: string; label: string }
 
-/** ボタン付きメッセージの blocks を作る（純粋関数）。label は送る前の伏せ字処理を通したもの。 */
-export function buildInquiryResolveBlocks(lines: ResolvableLine[], adminUrl: string): Record<string, unknown>[] {
-  const shown = lines.slice(0, MAX_BUTTON_ITEMS);
+/** ボタン付きメッセージ1通分の blocks を作る（純粋関数）。label は送る前の伏せ字処理を通したもの。 */
+export function buildInquiryResolveBlocks(lines: ResolvableLine[], adminUrl: string, page = { index: 1, total: 1 }): Record<string, unknown>[] {
+  const heading = page.total > 1 ? `*未完了のお問い合わせ（${page.index}/${page.total}）*` : '*未完了のお問い合わせ*';
   const blocks: Record<string, unknown>[] = [
-    sectionBlock('*未完了のお問い合わせ*（対応が済んだものは「解決済みにする」を押してください。解決済みにするまで毎朝お知らせします）'),
+    sectionBlock(`${heading}（対応が済んだものは「解決済みにする」を押してください。解決済みにするまで毎朝お知らせします）`),
   ];
-  for (const line of shown) {
+  for (const line of lines.slice(0, MAX_BUTTON_ITEMS)) {
     blocks.push(sectionBlock(line.label));
     blocks.push(actionsBlock([buttonElement('解決済みにする', INQUIRY_RESOLVE_ACTION_ID, line.id, 'primary')]));
   }
-  const rest = lines.length - shown.length;
-  blocks.push(actionsBlock([linkButtonElement(rest > 0 ? `問い合わせ管理を開く（ほか${rest}件）` : '問い合わせ管理を開く', adminUrl)]));
+  blocks.push(actionsBlock([linkButtonElement('問い合わせ管理を開く', adminUrl)]));
   return blocks;
 }
 
-/** ボタン付きメッセージを送る。失敗しても throw しない（文章の通知は別に出ている）。 */
+/**
+ * ボタン付きメッセージを送る。全件にボタンが付くよう、MAX_BUTTON_ITEMS 件ごとに分けて送る
+ * （上限で切ると、古い件が残り続ける間は新しい件に毎日ボタンが付かない・Codex 指摘 PR996-03）。
+ * 失敗しても throw しない（文章の通知は別に出ている）。全通送れたら true。
+ */
 export async function postInquiryResolveButtons(lines: ResolvableLine[], adminUrl: string): Promise<boolean> {
   if (lines.length === 0) return false;
-  try {
-    const result = await postToSlack({ text: `未完了のお問い合わせ ${lines.length}件（ボタンで解決済みにできます）`, blocks: buildInquiryResolveBlocks(lines, adminUrl), unfurl_links: false });
-    if (!result.ok) console.error('[inquiry-slack] button post failed:', result.error);
-    return result.ok;
-  } catch {
-    console.error('[inquiry-slack] button post failed:', 'notification_failure');
-    return false;
+  const total = Math.ceil(lines.length / MAX_BUTTON_ITEMS);
+  let allOk = true;
+  for (let index = 0; index < total; index += 1) {
+    const chunk = lines.slice(index * MAX_BUTTON_ITEMS, (index + 1) * MAX_BUTTON_ITEMS);
+    try {
+      const result = await postToSlack({ text: `未完了のお問い合わせ ${lines.length}件（ボタンで解決済みにできます）`, blocks: buildInquiryResolveBlocks(chunk, adminUrl, { index: index + 1, total }), unfurl_links: false });
+      if (!result.ok) { allOk = false; console.error('[inquiry-slack] button post failed:', result.error); }
+    } catch {
+      allOk = false;
+      console.error('[inquiry-slack] button post failed:', 'notification_failure');
+    }
   }
+  return allOk;
 }
 
 export interface ResolvePayload {
@@ -79,7 +88,7 @@ async function decide(db: DB, payload: ResolvePayload, contactId: string | undef
   if (!contactId || !UUID_RE.test(contactId) || !slackUserId) return 'invalid';
   const email = await getSlackUserEmail(slackUserId);
   if (!email) return 'no_email';
-  const { data: admins, error: lookupError } = await db.from('profiles').select('id').eq('email_canonical', email).eq('is_platform_admin', true).limit(2);
+  const { data: admins, error: lookupError } = await db.from('profiles').select('id').eq('email_canonical', canonicalizeEmail(email)).eq('is_platform_admin', true).limit(2);
   if (lookupError) return 'failed';
   if (!admins || admins.length !== 1) return 'not_admin';
   const actorId = (admins[0] as { id: string }).id;

exec
/bin/zsh -lc "rg -n 'service.role|Preview|preview' CLAUDE.md | head -50; rg -n 'canonicalizeEmail|isPublicReadOnlyPreview' src/lib/{slack,preview-capabilities,inquiry-slack-actions}.ts; ls -ld node_modules" in /Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940
 succeeded in 0ms:
8:- フロント／API＝Next.js（App Router・Route Handler・バージョンは package-lock.json）/ デプロイ＝Cloudflare Workers（2026年11月11日に Vercel から切り替え。本番 `https://carelink-jp.com`・`www.` はアペックスへ 301）。`.github/workflows/deploy-cloudflare.yml` が「main 上で CI（push）が成功した最新のコミット」を自動配信する（判定＝`tools/cloudflare/deploy-target.mjs`。手動実行も同じ判定で、CI 未通過は配信できない。本番より古い版には戻さない）。配信前に Worker の秘密値の名前を `tools/cloudflare/required-worker-secrets.json` と照合し、配信後は本番の version と `/`・`/search`・`/register` の中身を確かめ、だめなら `wrangler rollback` で直前の版へ戻して Slack に通知する。main の CI が赤のときも Slack に通知する。確認に失敗して戻したコミットは artifact `bad-deploy-<sha>` で記録され以後は選ばれない（直して配信し直すときだけ手動実行の `retry_sha` で明示）。手動配信は `npm run deploy:cloudflare` だけを使い、公開設定は GitHub のリポジトリ変数が唯一の置き場（`gh variable list` で読む）。サーバーに秘密値を足したら `required-worker-secrets.json` にも名前を足す。切り替え・戻し方は `docs/handoff/CLOUDFLARE_PRODUCTION_MIGRATION_20261104.md`。Vercel は戻し先として 2026年11月25日ごろまで残す（Preview と Vercel Build Dry-Run の検査は残っている）
98:🔴 **`audit_logs` は読み書きとも service_role 専用**（2026年10月22日・`20261022230200`）。以前は施設メンバーが PostgREST から自店舗の行を全列読め、予約をキャンセル・変更した来院者の IP・UA・user_id が店舗に見えていた。監査履歴を画面に出す必要が出たら、ip・ua・他人の user_id を射影しないサーバーの API を作ること（ブラウザの SELECT 権・ポリシーを戻さない）。
338:- `createServiceRoleClient`（`supabase-server.ts`）＝service role。RLS バイパス。API ルート・cron などサーバー信頼文脈のみ。
401:- 決済・購読：`featured_slots` `subscription_plans` `user_subscriptions` `subscription_usage_logs` `facility_entitlements` `facility_payjp_customers` `featured_slot_payjp_subscriptions` `facility_option_payjp_subscriptions` `booking_payjp_charges` `payjp_webhook_events`（PAY.JP 側の ID は service_role 専用の別表に置く）。旧 Stripe の表・列は 2026年11月14日に撤去した（本番で 0 行を確認・migration `20261114120000`）
413:| NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase（本番必須）。Vercel の Preview には 2026年10月25日から**本番の公開 URL と anon キーだけ**を入れている（公開閲覧の確認用・`docs/handoff/CPU_PREVIEW_CAPABILITIES_20261025.md`）。service-role が無い Preview は `isPublicReadOnlyPreview()` で公開閲覧専用になり、`isPreviewRestricted()`（`src/lib/preview-capabilities.ts`）が middleware と `withRoute` で**ログイン・会員/店舗画面・変更系メソッドを 403 で止める**（本番の Auth・データへ Preview から触れないため。2026年10月28日）。資格情報の無いビルドは `hasSupabasePublicEnv()`（`src/lib/supabase-build-env.ts`）で事前生成を省いて通る |
414:| SUPABASE_SERVICE_ROLE_KEY | service role（cron／管理 API のサーバ側 DB 操作・RLS バイパス・**本番必須**）。**Vercel の Preview には設定しない**（上の行と同じ理由。本番の secret をプレビューへ再登録しない） |
442:| THREADS_USER_ID | Threads 自動投稿の投稿先ユーザーID（未設定なら投稿は `skipped`＝正常扱い）。**アクセストークンは env に置かない**（60日で失効し `threads-token-refresh` cron が自動更新するが、env はコードから書き換えられないため）。トークンは `threads_credentials` テーブルに入る（RLS 有効・許可ポリシー無し＝service role のみ読める） |
453:  - **有効**：`schema-fingerprint.yml`（push/PR で migration からスキーマ期待値を再生成し陳腐化を検査）・`migration-apply-reminder.yml`（PR に新規 migration があれば本番適用を促す）・`mutation-l4.yml`（Stryker・週次 日曜 JST 03:00）・`dependency-update.yml`（依存更新・週次 月曜 JST 09:00）・`vercel-preview-build.yml`（PR で `vercel build` ドライ実行・repo variable `ENABLE_VERCEL_PR_BUILD == 'true'` のときだけ動く）・`deploy-cloudflare.yml`（main の CI 成功後に本番 Worker へ配信し、本番の version が配信したコミットになるまで確認する。公開設定はリポジトリ変数 `NEXT_PUBLIC_*`・`CLOUDFLARE_ACCOUNT_ID`、トークンは secret `CLOUDFLARE_API_TOKEN`）・`cron-constraints.yml` / `anon-write-policy-lint.yml` / `secdef-search-path-lint.yml` / `actionlint.yml`（いずれも `paths:` 絞り込み付きの静的ガード）
475:- 【🔴 Vercel Hobby の日次ビルド枠を実際に使い切ると24時間デプロイ不能になる】2026年7月29日、1日に9マージ＋7PR起票を行った結果 `Deployment rate limited — retry in 24 hours` が発生した。本番は既存デプロイで動き続けるが、この間は【緊急修正を出せない】。神原さんの判断で【Hobby を継続】（同日）。恒久対策として `vercel.json` の `ignoreCommand` に `scripts/vercel-should-build.sh` を配線し、配信物に影響しない変更（`supabase/migrations/` ・`.github/` ・`docs/` ・`e2e/` ・ルート直下の `.md` ・テストファイル・判定スクリプト自身と CI 専用の PostgREST 検査）だけならビルドをスキップする。比較元は【最後に成功した配信】（`VERCEL_GIT_PREVIOUS_SHA`。Preview の初回は稼働中の本番の版）なので、途中で配信に失敗したアプリ変更を後続の文書変更で隠さない。本番は、その最後に成功した配信が `/api/health` の稼働中の版と一致するときだけ省略する（昇格・未昇格の成功配信のアプリ変更を隠さないため。2026年10月31日の敵対レビューで追加）。本番は止まっていることが多く起動に5〜6秒かかるため、`/api/health` は1回15秒・2回まで待つ（2026年11月1日。5秒では #879 の文書だけの配信でも時間切れでビルドしていた）。省略しても GitHub では緑の success になるので、判定の中身はビルドログの `判定情報:` 行で確認する。文書だけの push では設定変更が反映されない（手順は `docs/MANUAL.md` 5.1）。🔴 **Vercel では `.vercelignore` が `.git` を取り除くため、判定に git は使えない**（2026年10月30日に実測。#851 の導入以来、git に頼った判定は一度も働かず、本番・Preview とも毎回ビルドしていた）。変更ファイルは GitHub の比較 API（比較元…`VERCEL_GIT_COMMIT_SHA`）から取り、取得失敗・別系統・途切れた一覧などは必ずビルドに倒す。判定が緩む改変と git 依存の復活は `src/__tests__/vercel-build-skip.test.ts`（`.git` の無い場所で実行する）が CI で止める。作業時は【1日のマージ数を意識し、複数の修正はできるだけ1本のPRにまとめる】。
479:- 【🔴 RLS は列を絞れない。「その施設のメンバーか」だけのポリシーは全列の書き換えを許す】`facility_reviews_member_update` は施設メンバーであることしか見ておらず、管理画面が実際に使うのは `status`（公開／非表示）だけなのに、PostgREST を直に叩けば **客が書いた `rating` と `comment` まで書き換えられた**（集計トリガが平均点を再計算するので、星の書き換えはそのまま評価点の水増しになる）。列を絞る手段は RLS ではなく【列レベル GRANT】しか無い（`GRANT UPDATE (status) ON facility_reviews TO authenticated`）。2026年8月22日の migration `20260822000001` で是正済み。同じ形の穴として `reports` は「どこかの施設のオーナーであること」しか見ておらず、**全施設の通報を通報者の IP つきで読め、削除もできた**（アプリ側に読み取り経路は 1 本も無いので service_role 専用へ落とした）。新しいポリシーを書くときは「行を絞る条件」と「触ってよい列」を別々に考えること。同じ形の穴として `facility_qa` は INSERT ポリシーが「自分の user_id か」しか見ておらず、ログインした人なら誰でも `answer`・`status='answered'`・`is_public` を書いて**施設名義の偽回答を公開できた**（2026年10月22日に是正。質問は `/api/facility/qa`、回答は `/api/admin/qa` の RPC だけ。`20261022230100` で列と WITH CHECK を絞り、デプロイ後に `20261022230300` でブラウザの INSERT 自体を撤回する。`supabase db push` は保留分を一括適用するので、`20261022230300` を含めない状態で push → デプロイ → 含めて push の 2 回に分ける）。
481:- 【🔴 RLS は【書き込みポリシーの不在】も無音の機能欠落になる】`review_replies` は公開読みポリシー 1 本だけで INSERT ポリシーが無く、管理画面の口コミ返信（ブラウザの authenticated クライアントから INSERT）は**押すたびに必ず失敗していた**。（2026年10月22日以降、返信の公開・編集・削除は `/api/admin/review-replies` → service_role 専用 RPC に一本化した。RPC の追加＝`supabase/migrations/20261022140000_review_reply_edit_delete.sql`、ブラウザの書き込み権と INSERT ポリシーの撤回＝`20261022140100_review_reply_close_browser_writes.sql`。本番は「1 本目を適用 → デプロイ → 2 本目を適用」の順で、同時に適用すると旧コードの投稿が壊れる窓ができる）RLS 有効かつ該当コマンドのポリシー不在＝常に拒否。UI が既にある機能を足すときは、読みだけでなく**そのコマンドのポリシーがあるか**を `src/lib/schema-fingerprint.expected.json` の `policy|<table>|` 行で確認する。
482:- 【🔴 SECURITY INVOKER のトリガが RLS のある表を UPDATE すると 0 行更新で無音停止する】`update_facility_rating()` は SECURITY INVOKER のまま `facility_profiles` を UPDATE していた。`facility_profiles` には SELECT ポリシーしか無いので、authenticated 文脈（＝管理画面から口コミを非表示にしたとき）に走ると **例外も出ずに 0 行更新**となり、平均点・件数が置いていかれた。service_role 経由（/api/review）では RLS を素通りするため発症せず、管理画面のときだけズレるので気づけない。集計トリガのように「呼び出し元の可視性に依存してはいけない」ものは SECURITY DEFINER ＋ `SET search_path` にする。
616:   service_role` を持つため、public の全テーブルに 3 ロール分の GRANT が自動で付く。
713:⚠️ 2026年11月11日以降、本番はこの経路では配信していない（Cloudflare Workers へ移行）。Vercel を片付けるまでの戻し先・Preview 用として残している。
715:`Dockerfile.vercel` はビルド・配信とも公式Node.js 24.22.1のdigestに固定し、standaloneを非root・PORT3000で実行する。CIと同じ `npm run build`（Webpack）を維持する。Vercel Container Runtimeのbuild ARG引き渡し不具合を回避するため、ビルド段だけ同一プロジェクトの `node24-public-config` イメージをdigest固定で使う。このベースにはNode本体と既存のブラウザ向け公開設定だけが入り、アプリコード・service-role・メール・決済・通知等の秘密値は入れない。アプリのソースは毎回COPYして再ビルドするため、Gitのコード更新が古いイメージで配信される構成ではない。
724:- DB `platform_mail`：直接書込は禁止。`manage_platform_mail_atomic` は service-role にのみ実行を許可し、呼出ごとに現在の `profiles.is_platform_admin` をロック・確認する。下書きはrevision一致時のみ保存する。業務上の競合は`PT409`を返し、PostgRESTの自動transaction再試行を誘発する`40001`を使わない。送信予約時に本文・宛先・送信元・日時を固定する。`guard_platform_mail_inquiry_overlap` は旧問い合わせ返信と同じcontact行をロックし、結果不明・送信待ちの二重返信を防ぐ。
src/lib/preview-capabilities.ts:4:export function isPublicReadOnlyPreview(): boolean {
src/lib/preview-capabilities.ts:20:  if (!isPublicReadOnlyPreview()) return false;
src/lib/preview-capabilities.ts:32:  if (!isPublicReadOnlyPreview()) return [];
src/lib/slack.ts:21:import { isPublicReadOnlyPreview } from './preview-capabilities';
src/lib/slack.ts:82:  if (isPublicReadOnlyPreview()) return { ok: false, error: 'preview_read_only' };
src/lib/slack.ts:213:  if (isPublicReadOnlyPreview()) return null;
src/lib/slack.ts:232:  if (isPublicReadOnlyPreview()) return;
src/lib/inquiry-slack-actions.ts:17:import { canonicalizeEmail } from './email-canonical';
src/lib/inquiry-slack-actions.ts:91:  const { data: admins, error: lookupError } = await db.from('profiles').select('id').eq('email_canonical', canonicalizeEmail(email)).eq('is_platform_admin', true).limit(2);
drwxr-xr-x@ 666 kam  staff  21312 Nov 25 15:26 node_modules

exec
/bin/zsh -lc 'git diff origin/main...ee83a16a --stat; git diff origin/main...ee83a16a -- src supabase' in /Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
 docs/ai-handoffs/pr996-inquiry-slack-resolve.md    |  26 +++
 .../api/slack/interactions/__tests__/route.test.ts |  23 +++
 src/app/api/slack/interactions/route.ts            |  10 +-
 src/lib/__tests__/inquiry-backlog.test.ts          |  12 ++
 src/lib/__tests__/inquiry-slack-actions.test.ts    | 197 +++++++++++++++++++++
 src/lib/inquiry-backlog.ts                         |   4 +
 src/lib/inquiry-slack-actions.ts                   | 110 ++++++++++++
 src/lib/slack.ts                                   |  33 ++++
 8 files changed, 411 insertions(+), 4 deletions(-)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
diff --git a/src/app/api/slack/interactions/__tests__/route.test.ts b/src/app/api/slack/interactions/__tests__/route.test.ts
index 4777bc84..a1d96dd9 100644
--- a/src/app/api/slack/interactions/__tests__/route.test.ts
+++ b/src/app/api/slack/interactions/__tests__/route.test.ts
@@ -13,6 +13,11 @@ import { createHmac } from 'crypto';
 
 const mockRunAfterResponse = jest.fn((t: () => PromiseLike<unknown>) => Promise.resolve(t()).then(() => undefined));
 jest.mock('@/lib/after-response', () => ({ runAfterResponse: (t: () => PromiseLike<unknown>) => mockRunAfterResponse(t) }));
+const mockResolve = jest.fn();
+jest.mock('@/lib/inquiry-slack-actions', () => ({ INQUIRY_RESOLVE_ACTION_ID: 'inquiry_resolve', resolveInquiryFromSlack: (...a: unknown[]) => mockResolve(...a) }));
+jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => 'service-db' }));
+const mockAlertCaught = jest.fn();
+jest.mock('@/lib/alert', () => ({ alertCaughtError: (...a: unknown[]) => mockAlertCaught(...a) }));
 import { POST } from '../route';
 
 const SECRET = 'test-signing-secret';
@@ -140,4 +145,22 @@ describe('POST /api/slack/interactions', () => {
       expect(mockRunAfterResponse).not.toHaveBeenCalled();
     }
   });
+
+  test('inquiry_resolve ボタン → 解決処理へ payload とボタンの値（問い合わせ id）を渡して 200', async () => {
+    mockResolve.mockResolvedValueOnce('resolved');
+    const body = { type: 'block_actions', user: { id: 'U1', name: 'x' }, response_url: 'https://hooks.slack.com/a', actions: [{ type: 'button', action_id: 'inquiry_resolve', value: 'abc' }] };
+    const res = await POST(makeSignedRequest(`payload=${encodeURIComponent(JSON.stringify(body))}`));
+    expect(res.status).toBe(200);
+    await Promise.resolve();
+    expect(mockResolve).toHaveBeenCalledWith('service-db', expect.objectContaining({ user: body.user, response_url: body.response_url }), 'abc');
+  });
+
+  test('解決処理が throw しても 200 ack し、Slack へ例外を通知する', async () => {
+    mockResolve.mockRejectedValueOnce(new Error('boom'));
+    const body = { type: 'block_actions', actions: [{ type: 'button', action_id: 'inquiry_resolve', value: 'abc' }] };
+    const res = await POST(makeSignedRequest(`payload=${encodeURIComponent(JSON.stringify(body))}`));
+    expect(res.status).toBe(200);
+    await new Promise((r) => setTimeout(r, 0));
+    expect(mockAlertCaught).toHaveBeenCalledWith('slack-action:inquiry_resolve', expect.any(Error), '/api/slack/interactions');
+  });
 });
diff --git a/src/app/api/slack/interactions/route.ts b/src/app/api/slack/interactions/route.ts
index e44d7ad6..93b401f8 100644
--- a/src/app/api/slack/interactions/route.ts
+++ b/src/app/api/slack/interactions/route.ts
@@ -22,6 +22,8 @@ import { safeCaptureException } from '@/lib/safe';
 import { runAfterResponse } from '@/lib/after-response';
 import { alertCaughtError } from '@/lib/alert';
 import { serverError } from '@/lib/with-route';
+import { createServiceRoleClient } from '@/lib/supabase-server';
+import { INQUIRY_RESOLVE_ACTION_ID, resolveInquiryFromSlack } from '@/lib/inquiry-slack-actions';
 
 export const dynamic = 'force-dynamic';
 
@@ -49,8 +51,10 @@ type ActionHandler = (payload: SlackInteractionPayload, action: SlackAction) =>
 // 新しいボタンを追加する時は buttonElement(text, 'action_id_here', ...) と
 // ここに 'action_id_here': async (payload, action) => {...} を追加するだけ
 const ACTION_HANDLERS: Record<string, ActionHandler> = {
-  // 例: 'mark_resolved': async (payload, action) => { ... },
-  // 例: 'approve_salon': async (payload, action) => { ... },
+  // 未完了の問い合わせを解決済みにする（押した人が運営管理者か inquiry-slack-actions.ts で確かめる）
+  [INQUIRY_RESOLVE_ACTION_ID]: async (payload, action) => {
+    await resolveInquiryFromSlack(createServiceRoleClient(), payload, action.value);
+  },
 };
 
 export async function POST(request: Request) {
@@ -86,9 +90,7 @@ export async function POST(request: Request) {
     if (payload.actions && payload.actions.length > 0) {
       const action = payload.actions[0];
       // 自前のキーだけを引く（'constructor' 等で Object.prototype のメソッドを呼ばないため）。
-      /* istanbul ignore next -- ACTION_HANDLERS は現在空のため true 側は到達不能 */
       const handler = Object.hasOwn(ACTION_HANDLERS, action.action_id) ? ACTION_HANDLERS[action.action_id] : undefined;
-      /* istanbul ignore next -- ACTION_HANDLERS は現在空のため true 分岐は到達不能 */
       if (handler) {
         // 結果は気にせず即 ack 返却
         runAfterResponse(async () => {
diff --git a/src/lib/__tests__/inquiry-backlog.test.ts b/src/lib/__tests__/inquiry-backlog.test.ts
index ff196ec6..7128d95e 100644
--- a/src/lib/__tests__/inquiry-backlog.test.ts
+++ b/src/lib/__tests__/inquiry-backlog.test.ts
@@ -1,7 +1,9 @@
 jest.mock('../alert', () => ({ alertWarning: jest.fn(), redactAlertText: jest.requireActual('../alert').redactAlertText }));
 jest.mock('../platform-mail-read', () => ({ readMailReplyEvidence: jest.fn() }));
+jest.mock('../inquiry-slack-actions', () => ({ postInquiryResolveButtons: jest.fn().mockResolvedValue(true) }));
 
 import { alertWarning } from '../alert';
+import { postInquiryResolveButtons } from '../inquiry-slack-actions';
 import { readMailReplyEvidence } from '../platform-mail-read';
 import { readFileSync } from 'fs';
 import { join } from 'path';
@@ -156,6 +158,15 @@ describe('reportInquiryBacklog', () => {
     // メール・電話・本文も、種類欄に書かれた自由記述も、受付番号も載らない
     const sent = JSON.stringify([message, opts]);
     for (const secret of ['a@example.invalid', '090-1234-5678', '本文', '佐藤花子', '腰の痛み', '01234567', '00000000']) expect(sent).not.toContain(secret);
+    // 1件ごとに「解決済みにする」ボタンを付けたメッセージも出す（ボタンの値は問い合わせの id・表示は同じ1行）
+    expect(postInquiryResolveButtons).toHaveBeenCalledTimes(1);
+    const [lines, adminUrl] = (postInquiryResolveButtons as jest.Mock).mock.calls[0];
+    expect(adminUrl).toBe('https://carelink-jp.com/admin/inquiries');
+    expect(lines.map((l: { id: string }) => l.id).sort()).toEqual([uuid(1), uuid(2), uuid(3), '01234567-0000-4000-8000-000000000004'].sort());
+    expect(lines).toContainEqual({ id: uuid(1), label: '山田 太郎様・9/19受付・施設掲載について（オーナー向け）・新着タブ（59日）' });
+    expect(lines).toHaveLength(4);
+    const buttonText = JSON.stringify(lines.map((l: { label: string }) => l.label));
+    for (const secret of ['a@example.invalid', '090-1234-5678', '本文', '佐藤花子', '腰の痛み']) expect(buttonText).not.toContain(secret);
   });
 
   test('知らせるものが無ければ Slack に出さない', async () => {
@@ -163,6 +174,7 @@ describe('reportInquiryBacklog', () => {
     await expect(reportInquiryBacklog(db, now)).resolves.toEqual({ unreplied: 0, repliedOpen: 0 });
     expect(readMailReplyEvidence).not.toHaveBeenCalled();
     expect(alertWarning).not.toHaveBeenCalled();
+    expect(postInquiryResolveButtons).not.toHaveBeenCalled();
   });
 
   test('片方の区分が空なら「なし」と出し、上限を超えた分は省略件数に数え、設定済みの URL を使う', async () => {
diff --git a/src/lib/__tests__/inquiry-slack-actions.test.ts b/src/lib/__tests__/inquiry-slack-actions.test.ts
new file mode 100644
index 00000000..a03aae8d
--- /dev/null
+++ b/src/lib/__tests__/inquiry-slack-actions.test.ts
@@ -0,0 +1,197 @@
+/**
+ * @jest-environment @stryker-mutator/jest-runner/jest-env/node
+ */
+jest.mock('../slack', () => ({ ...jest.requireActual('../slack'), postToSlack: jest.fn() }));
+jest.mock('../audit-logger', () => ({ writeAuditLog: jest.fn() }));
+import { postToSlack } from '../slack';
+import { writeAuditLog } from '../audit-logger';
+import { buildInquiryResolveBlocks, postInquiryResolveButtons, resolveInquiryFromSlack, INQUIRY_RESOLVE_ACTION_ID, MAX_BUTTON_ITEMS } from '../inquiry-slack-actions';
+
+const ID = '00000000-0000-4000-8000-000000000001';
+const ACTOR = '00000000-0000-4000-8000-0000000000aa';
+const RESPONSE_URL = 'https://hooks.slack.com/actions/T/1/abc';
+const URL_ADMIN = 'https://carelink-jp.com/admin/inquiries';
+
+type Result = { data: unknown; error: unknown };
+function fakeDb(lookup: Result, rpc: Result = { data: { resolved_at: '2026-11-27T00:00:00Z' }, error: null }) {
+  const calls: { eq: unknown[][]; rpc: unknown[] } = { eq: [], rpc: [] };
+  const builder = {
+    select: () => builder,
+    eq: (...args: unknown[]) => { calls.eq.push(args); return builder; },
+    limit: () => Promise.resolve(lookup),
+  };
+  const db = {
+    from: jest.fn(() => builder),
+    rpc: jest.fn((...args: unknown[]) => { calls.rpc = args; return Promise.resolve(rpc); }),
+  };
+  return { db: db as never, calls, raw: db };
+}
+
+const fetchMock = jest.fn();
+function slackUser(user: unknown, ok = true) {
+  fetchMock.mockImplementation((url: string) => Promise.resolve({ json: () => Promise.resolve(url.includes('users.info') ? { ok, user } : { ok: true }) }));
+}
+const respondedText = () => {
+  const call = fetchMock.mock.calls.find(([url]) => url === RESPONSE_URL);
+  return call ? JSON.parse(call[1].body).text as string : null;
+};
+
+beforeEach(() => {
+  jest.clearAllMocks();
+  global.fetch = fetchMock as never;
+  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
+});
+
+describe('buildInquiryResolveBlocks', () => {
+  test('1件ごとに本文とボタン（値＝問い合わせ id）を並べ、最後に管理画面へのリンクを置く', () => {
+    const blocks = buildInquiryResolveBlocks([{ id: ID, label: '山田様・9/19受付' }], URL_ADMIN);
+    expect(blocks).toHaveLength(4);
+    expect(JSON.stringify(blocks[1])).toContain('山田様・9/19受付');
+    expect(blocks[2]).toEqual({ type: 'actions', elements: [expect.objectContaining({ action_id: INQUIRY_RESOLVE_ACTION_ID, value: ID, style: 'primary' })] });
+    expect(JSON.stringify(blocks[3])).toContain(URL_ADMIN);
+    expect(JSON.stringify(blocks[0])).not.toContain('1/1');
+  });
+
+  test('1通は上限件数まで（Slack の 50 ブロック上限内）で、複数通のときは見出しに通し番号を付ける', () => {
+    const lines = Array.from({ length: MAX_BUTTON_ITEMS + 3 }, (_, i) => ({ id: ID, label: `件${i}` }));
+    const blocks = buildInquiryResolveBlocks(lines, URL_ADMIN, { index: 2, total: 3 });
+    expect(blocks.length).toBeLessThanOrEqual(50);
+    expect(blocks).toHaveLength(MAX_BUTTON_ITEMS * 2 + 2);
+    expect(JSON.stringify(blocks[0])).toContain('2/3');
+  });
+});
+
+describe('postInquiryResolveButtons', () => {
+  test('0件なら送らない', async () => {
+    await expect(postInquiryResolveButtons([], URL_ADMIN)).resolves.toBe(false);
+    expect(postToSlack).not.toHaveBeenCalled();
+  });
+  test('送信結果を返し、失敗・例外でも throw しない', async () => {
+    (postToSlack as jest.Mock).mockResolvedValueOnce({ ok: true });
+    await expect(postInquiryResolveButtons([{ id: ID, label: 'a' }], URL_ADMIN)).resolves.toBe(true);
+    expect((postToSlack as jest.Mock).mock.calls[0][0].blocks).toHaveLength(4);
+    (postToSlack as jest.Mock).mockResolvedValueOnce({ ok: false, error: 'x' });
+    await expect(postInquiryResolveButtons([{ id: ID, label: 'a' }], URL_ADMIN)).resolves.toBe(false);
+    (postToSlack as jest.Mock).mockRejectedValueOnce(new Error('boom'));
+    await expect(postInquiryResolveButtons([{ id: ID, label: 'a' }], URL_ADMIN)).resolves.toBe(false);
+  });
+
+  test('上限を超えたら分けて送り、全件にボタンが付く（Codex 指摘 PR996-03）', async () => {
+    (postToSlack as jest.Mock).mockResolvedValue({ ok: true });
+    const lines = Array.from({ length: MAX_BUTTON_ITEMS * 2 + 1 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, label: `件${i}` }));
+    await expect(postInquiryResolveButtons(lines, URL_ADMIN)).resolves.toBe(true);
+    expect(postToSlack).toHaveBeenCalledTimes(3);
+    const values = (postToSlack as jest.Mock).mock.calls.flatMap(([opts]) => (opts.blocks as { elements?: { value?: string; action_id?: string }[] }[]).flatMap((b) => b.elements ?? []).filter((e) => e.action_id === INQUIRY_RESOLVE_ACTION_ID).map((e) => e.value));
+    expect(values).toEqual(lines.map((l) => l.id));
+    (postToSlack as jest.Mock).mockReset();
+  });
+});
+
+describe('resolveInquiryFromSlack', () => {
+  const payload = { user: { id: 'U1' }, response_url: RESPONSE_URL };
+
+  test('Slack のメールが運営管理者1人に一致すれば、管理画面と同じ RPC で解決済みにし、監査ログを残す', async () => {
+    slackUser({ profile: { email: ' Admin@Example.invalid ' } });
+    const { db, calls } = fakeDb({ data: [{ id: ACTOR }], error: null });
+    await expect(resolveInquiryFromSlack(db, payload, ID)).resolves.toBe('resolved');
+    expect(calls.eq).toEqual([['email_canonical', 'admin@example.invalid'], ['is_platform_admin', true]]);
+    expect(calls.rpc).toEqual(['manage_platform_control_atomic', { p_actor_id: ACTOR, p_record_id: ID, p_kind: 'ticket:update', p_values: { ticket_status: 'resolved' } }]);
+    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ userId: ACTOR, tableName: 'contacts', recordId: ID, newValues: expect.objectContaining({ ticket_status: 'resolved', via: 'slack', resolved_at: '2026-11-27T00:00:00Z' }) }));
+    expect(respondedText()).toContain('解決済みにしました');
+    const usersInfo = fetchMock.mock.calls.find(([url]) => String(url).includes('users.info'));
+    expect(usersInfo[1].headers.Authorization).toBe('Bearer xoxb-test');
+  });
+
+  test('Gmail のドット・+タグは DB の email_canonical と同じ規則で揃えて照合する（Codex 指摘 PR996-02）', async () => {
+    slackUser({ profile: { email: 'Admin.Example+tag@gmail.com' } });
+    const { db, calls } = fakeDb({ data: [{ id: ACTOR }], error: null });
+    await expect(resolveInquiryFromSlack(db, payload, ID)).resolves.toBe('resolved');
+    expect(calls.eq[0]).toEqual(['email_canonical', 'adminexample@gmail.com']);
+  });
+
+  test('RPC が resolved_at を返さなくても解決扱いにする', async () => {
+    slackUser({ profile: { email: 'a@example.invalid' } });
+    const { db } = fakeDb({ data: [{ id: ACTOR }], error: null }, { data: null, error: null });
+    await expect(resolveInquiryFromSlack(db, payload, ID)).resolves.toBe('resolved');
+    expect((writeAuditLog as jest.Mock).mock.calls[0][0].newValues.resolved_at).toBeNull();
+  });
+
+  test.each([
+    ['id が無い', payload, undefined],
+    ['id が UUID でない', payload, 'not-a-uuid'],
+    ['押した人が分からない', { response_url: RESPONSE_URL }, ID],
+  ])('%s → invalid（DB を触らない）', async (_l, p, id) => {
+    const { db, raw } = fakeDb({ data: [], error: null });
+    await expect(resolveInquiryFromSlack(db, p, id)).resolves.toBe('invalid');
+    expect(raw.from).not.toHaveBeenCalled();
+    expect(raw.rpc).not.toHaveBeenCalled();
+  });
+
+  test.each([
+    ['users.info が失敗', () => slackUser(undefined, false)],
+    ['退会済み', () => slackUser({ deleted: true, profile: { email: 'a@example.invalid' } })],
+    ['bot', () => slackUser({ is_bot: true, profile: { email: 'a@example.invalid' } })],
+    ['メールが空', () => slackUser({ profile: { email: '  ' } })],
+    ['メール欄が無い', () => slackUser({})],
+    ['通信例外', () => fetchMock.mockImplementation((url: string) => url.includes('users.info') ? Promise.reject(new Error('x')) : Promise.resolve({}))],
+  ])('%s → no_email（何も変えない）', async (_l, setup) => {
+    setup();
+    const { db, raw } = fakeDb({ data: [{ id: ACTOR }], error: null });
+    await expect(resolveInquiryFromSlack(db, payload, ID)).resolves.toBe('no_email');
+    expect(raw.rpc).not.toHaveBeenCalled();
+  });
+
+  test('SLACK_BOT_TOKEN が無ければ no_email', async () => {
+    delete process.env.SLACK_BOT_TOKEN;
+    const { db, raw } = fakeDb({ data: [{ id: ACTOR }], error: null });
+    await expect(resolveInquiryFromSlack(db, payload, ID)).resolves.toBe('no_email');
+    expect(raw.rpc).not.toHaveBeenCalled();
+  });
+
+  test.each([
+    ['一致なし', { data: [], error: null }, 'not_admin'],
+    ['null', { data: null, error: null }, 'not_admin'],
+    ['複数一致', { data: [{ id: ACTOR }, { id: ID }], error: null }, 'not_admin'],
+    ['検索失敗', { data: null, error: { message: 'x' } }, 'failed'],
+  ])('管理者の検索が%s → %s（RPC を呼ばない）', async (_l, lookup, expected) => {
+    slackUser({ profile: { email: 'a@example.invalid' } });
+    const { db, raw } = fakeDb(lookup);
+    await expect(resolveInquiryFromSlack(db, payload, ID)).resolves.toBe(expected);
+    expect(raw.rpc).not.toHaveBeenCalled();
+    expect(writeAuditLog).not.toHaveBeenCalled();
+    expect(respondedText()).toBeTruthy();
+  });
+
+  test.each([
+    ['P0002', 'not_found'],
+    ['42501', 'not_admin'],
+    ['XX000', 'failed'],
+    [undefined, 'failed'],
+  ])('RPC が %s → %s（監査ログを残さない）', async (code, expected) => {
+    slackUser({ profile: { email: 'a@example.invalid' } });
+    const { db } = fakeDb({ data: [{ id: ACTOR }], error: null }, { data: null, error: { code } });
+    await expect(resolveInquiryFromSlack(db, payload, ID)).resolves.toBe(expected);
+    expect(writeAuditLog).not.toHaveBeenCalled();
+  });
+
+  test('response_url が Slack 以外・無しなら返事を送らない／送信失敗でも throw しない', async () => {
+    slackUser({ profile: { email: 'a@example.invalid' } });
+    const { db } = fakeDb({ data: [], error: null });
+    await resolveInquiryFromSlack(db, { user: { id: 'U1' }, response_url: 'https://evil.example/x' }, ID);
+    await resolveInquiryFromSlack(db, { user: { id: 'U1' } }, ID);
+    expect(fetchMock.mock.calls.every(([url]) => String(url).includes('users.info'))).toBe(true);
+    fetchMock.mockImplementation((url: string) => url.includes('users.info') ? Promise.resolve({ json: () => Promise.resolve({ ok: true, user: { profile: { email: 'a@example.invalid' } } }) }) : Promise.reject(new Error('down')));
+    await expect(resolveInquiryFromSlack(db, payload, ID)).resolves.toBe('not_admin');
+  });
+
+  test('公開閲覧専用の Preview では Slack を引かず、返事も送らない', async () => {
+    jest.resetModules();
+    jest.doMock('../preview-capabilities', () => ({ isPublicReadOnlyPreview: () => true }));
+    const slack = await import('../slack');
+    slackUser({ profile: { email: 'a@example.invalid' } });
+    await expect(slack.getSlackUserEmail('U1')).resolves.toBeNull();
+    await slack.respondToSlackAction(RESPONSE_URL, 'x');
+    expect(fetchMock).not.toHaveBeenCalled();
+    jest.dontMock('../preview-capabilities');
+  });
+});
diff --git a/src/lib/inquiry-backlog.ts b/src/lib/inquiry-backlog.ts
index 1aec5747..efbc07f9 100644
--- a/src/lib/inquiry-backlog.ts
+++ b/src/lib/inquiry-backlog.ts
@@ -23,6 +23,7 @@ import { alertWarning, redactAlertText } from './alert';
 import { fetchAllPaged } from './paginate';
 import { readMailReplyEvidence } from './platform-mail-read';
 import { summarizeMailReplies, type LegacyMailReply } from './platform-mail-contract';
+import { postInquiryResolveButtons } from './inquiry-slack-actions';
 
 type DB = ReturnType<typeof createServiceRoleClient>;
 type Evidence = Awaited<ReturnType<typeof readMailReplyEvidence>>;
@@ -205,6 +206,9 @@ export async function reportInquiryBacklog(
         omitted: items.length - shownUnreplied.length - shownRepliedOpen.length,
       },
     });
+    // 1件ごとに「解決済みにする」ボタンを付けたメッセージを続けて出す（2026年11月27日 神原さん指示）。
+    // 解決済みにするまで毎朝出し続ける（自動では閉じない）。
+    await postInquiryResolveButtons(items.map((item) => ({ id: item.id, label: redactAlertText(formatItem(item)) })), `${base}/admin/inquiries`);
   }
   return { unreplied: unreplied.length, repliedOpen: repliedOpen.length };
 }
diff --git a/src/lib/inquiry-slack-actions.ts b/src/lib/inquiry-slack-actions.ts
new file mode 100644
index 00000000..bc3cc634
--- /dev/null
+++ b/src/lib/inquiry-slack-actions.ts
@@ -0,0 +1,110 @@
+/**
+ * 未完了の問い合わせを Slack のボタンから「解決済み」にする（2026年11月27日 神原さん指示）。
+ *
+ * 毎朝の未完了通知（inquiry-backlog.ts）の後に、1件ごとに「解決済みにする」ボタンを付けた
+ * メッセージを出す。解決済みにするまで毎朝通知が続く（自動で閉じることはしない＝神原さん決定）。
+ *
+ * 🔴 押した人の確認（だれでも閉じられないように）:
+ *   Slack の署名（/api/slack/interactions で検証）で「CareLink の Slack アプリ経由の操作」であることを確かめたうえで、
+ *   押した Slack ユーザーのメールアドレスを users.info で引き、CareLink の profiles（email_canonical）で
+ *   1人に決まり、かつ is_platform_admin のときだけ処理する。管理者判定は管理画面と同じ RPC
+ *   manage_platform_control_atomic（DB 側で is_platform_admin を確かめる）に任せる。
+ *   メールが取れない（users:read.email の権限が無い等）・一致しない・複数一致は、何も変えずに理由だけ返す。
+ */
+import type { createServiceRoleClient } from './supabase-server';
+import { actionsBlock, buttonElement, getSlackUserEmail, linkButtonElement, postToSlack, respondToSlackAction, sectionBlock } from './slack';
+import { writeAuditLog } from './audit-logger';
+import { canonicalizeEmail } from './email-canonical';
+
+type DB = ReturnType<typeof createServiceRoleClient>;
+
+export const INQUIRY_RESOLVE_ACTION_ID = 'inquiry_resolve';
+const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
+/** 1通に載せる件数（Slack は 1 メッセージ 50 ブロックまで。1件 2 ブロック＋見出し・リンク）。超えた分は次の1通に続ける。 */
+export const MAX_BUTTON_ITEMS = 20;
+
+export interface ResolvableLine { id: string; label: string }
+
+/** ボタン付きメッセージ1通分の blocks を作る（純粋関数）。label は送る前の伏せ字処理を通したもの。 */
+export function buildInquiryResolveBlocks(lines: ResolvableLine[], adminUrl: string, page = { index: 1, total: 1 }): Record<string, unknown>[] {
+  const heading = page.total > 1 ? `*未完了のお問い合わせ（${page.index}/${page.total}）*` : '*未完了のお問い合わせ*';
+  const blocks: Record<string, unknown>[] = [
+    sectionBlock(`${heading}（対応が済んだものは「解決済みにする」を押してください。解決済みにするまで毎朝お知らせします）`),
+  ];
+  for (const line of lines.slice(0, MAX_BUTTON_ITEMS)) {
+    blocks.push(sectionBlock(line.label));
+    blocks.push(actionsBlock([buttonElement('解決済みにする', INQUIRY_RESOLVE_ACTION_ID, line.id, 'primary')]));
+  }
+  blocks.push(actionsBlock([linkButtonElement('問い合わせ管理を開く', adminUrl)]));
+  return blocks;
+}
+
+/**
+ * ボタン付きメッセージを送る。全件にボタンが付くよう、MAX_BUTTON_ITEMS 件ごとに分けて送る
+ * （上限で切ると、古い件が残り続ける間は新しい件に毎日ボタンが付かない・Codex 指摘 PR996-03）。
+ * 失敗しても throw しない（文章の通知は別に出ている）。全通送れたら true。
+ */
+export async function postInquiryResolveButtons(lines: ResolvableLine[], adminUrl: string): Promise<boolean> {
+  if (lines.length === 0) return false;
+  const total = Math.ceil(lines.length / MAX_BUTTON_ITEMS);
+  let allOk = true;
+  for (let index = 0; index < total; index += 1) {
+    const chunk = lines.slice(index * MAX_BUTTON_ITEMS, (index + 1) * MAX_BUTTON_ITEMS);
+    try {
+      const result = await postToSlack({ text: `未完了のお問い合わせ ${lines.length}件（ボタンで解決済みにできます）`, blocks: buildInquiryResolveBlocks(chunk, adminUrl, { index: index + 1, total }), unfurl_links: false });
+      if (!result.ok) { allOk = false; console.error('[inquiry-slack] button post failed:', result.error); }
+    } catch {
+      allOk = false;
+      console.error('[inquiry-slack] button post failed:', 'notification_failure');
+    }
+  }
+  return allOk;
+}
+
+export interface ResolvePayload {
+  user?: { id?: string };
+  response_url?: string;
+}
+
+export type ResolveOutcome = 'resolved' | 'invalid' | 'no_email' | 'not_admin' | 'not_found' | 'failed';
+
+const OUTCOME_TEXT: Record<Exclude<ResolveOutcome, 'resolved'>, string> = {
+  invalid: '操作の内容を読み取れませんでした。問い合わせ管理の画面から処理してください。',
+  no_email: 'Slack のメールアドレスを確認できませんでした。問い合わせ管理の画面から処理してください。',
+  not_admin: 'この操作は CareLink の運営管理者だけができます（Slack のメールアドレスが運営管理者のアカウントと一致しません）。',
+  not_found: 'その問い合わせが見つかりませんでした。',
+  failed: '解決済みにできませんでした。問い合わせ管理の画面から処理してください。',
+};
+
+/** 「解決済みにする」ボタンの処理本体。 */
+export async function resolveInquiryFromSlack(db: DB, payload: ResolvePayload, contactId: string | undefined): Promise<ResolveOutcome> {
+  const outcome = await decide(db, payload, contactId);
+  await respondToSlackAction(payload.response_url, outcome === 'resolved' ? '✅ 解決済みにしました。明日から通知に出ません。' : OUTCOME_TEXT[outcome]);
+  return outcome;
+}
+
+async function decide(db: DB, payload: ResolvePayload, contactId: string | undefined): Promise<ResolveOutcome> {
+  const slackUserId = payload.user?.id;
+  if (!contactId || !UUID_RE.test(contactId) || !slackUserId) return 'invalid';
+  const email = await getSlackUserEmail(slackUserId);
+  if (!email) return 'no_email';
+  const { data: admins, error: lookupError } = await db.from('profiles').select('id').eq('email_canonical', canonicalizeEmail(email)).eq('is_platform_admin', true).limit(2);
+  if (lookupError) return 'failed';
+  if (!admins || admins.length !== 1) return 'not_admin';
+  const actorId = (admins[0] as { id: string }).id;
+  const { data, error } = await db.rpc('manage_platform_control_atomic', { p_actor_id: actorId, p_record_id: contactId, p_kind: 'ticket:update', p_values: { ticket_status: 'resolved' } });
+  if (error) {
+    const code = (error as { code?: string }).code;
+    if (code === 'P0002') return 'not_found';
+    if (code === '42501') return 'not_admin';
+    return 'failed';
+  }
+  void writeAuditLog({
+    userId: actorId,
+    action: 'update',
+    tableName: 'contacts',
+    recordId: contactId,
+    newValues: { ticket_status: 'resolved', resolved_at: (data as { resolved_at?: string | null } | null)?.resolved_at ?? null, via: 'slack', slack_user_id: slackUserId },
+  });
+  return 'resolved';
+}
diff --git a/src/lib/slack.ts b/src/lib/slack.ts
index d98fcf80..82c9e88a 100644
--- a/src/lib/slack.ts
+++ b/src/lib/slack.ts
@@ -205,6 +205,39 @@ export async function postToSlackWithThreadGrouping(opts: {
   return postResult;
 }
 
+/**
+ * Slack ユーザーのメールアドレスを users.info で取る（ボタンを押した人の確認用・users:read.email の権限が要る）。
+ * 取れない・退会済み・bot・Preview は null。throw しない。
+ */
+export async function getSlackUserEmail(userId: string): Promise<string | null> {
+  if (isPublicReadOnlyPreview()) return null;
+  const token = process.env.SLACK_BOT_TOKEN;
+  if (!token) return null;
+  try {
+    const res = await fetch(`${SLACK_API_BASE}/users.info?user=${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${token}` } });
+    const json = await res.json() as { ok?: boolean; user?: { deleted?: boolean; is_bot?: boolean; profile?: { email?: string } } };
+    if (!json.ok || !json.user || json.user.deleted || json.user.is_bot) return null;
+    const email = json.user.profile?.email?.trim().toLowerCase();
+    return email ? email : null;
+  } catch {
+    return null;
+  }
+}
+
+/**
+ * ボタン操作への返事を、押した本人にだけ見える形で返す（response_url）。
+ * 送り先は Slack の hooks.slack.com だけに限る（payload の値をそのまま送り先にしないため）。throw しない。
+ */
+export async function respondToSlackAction(responseUrl: string | undefined, text: string): Promise<void> {
+  if (isPublicReadOnlyPreview()) return;
+  if (!responseUrl || !responseUrl.startsWith('https://hooks.slack.com/')) return;
+  try {
+    await fetch(responseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response_type: 'ephemeral', replace_original: false, text }) });
+  } catch {
+    console.error('[slack] respond failed:', 'notification_failure');
+  }
+}
+
 // ===== Block Kit ヘルパー（Phase 7b で活用） =====
 
 /**

exec
/bin/zsh -lc "git diff origin/main...ee83a16a --name-only; git diff origin/main...ee83a16a -- src/app; cat src/lib/{email-canonical,preview-capabilities}.ts; rg -n -i 'preview|service.role' CLAUDE.md | tail -35" in /Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
docs/ai-handoffs/pr996-inquiry-slack-resolve.md
src/app/api/slack/interactions/__tests__/route.test.ts
src/app/api/slack/interactions/route.ts
src/lib/__tests__/inquiry-backlog.test.ts
src/lib/__tests__/inquiry-slack-actions.test.ts
src/lib/inquiry-backlog.ts
src/lib/inquiry-slack-actions.ts
src/lib/slack.ts
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
diff --git a/src/app/api/slack/interactions/__tests__/route.test.ts b/src/app/api/slack/interactions/__tests__/route.test.ts
index 4777bc84..a1d96dd9 100644
--- a/src/app/api/slack/interactions/__tests__/route.test.ts
+++ b/src/app/api/slack/interactions/__tests__/route.test.ts
@@ -13,6 +13,11 @@ import { createHmac } from 'crypto';
 
 const mockRunAfterResponse = jest.fn((t: () => PromiseLike<unknown>) => Promise.resolve(t()).then(() => undefined));
 jest.mock('@/lib/after-response', () => ({ runAfterResponse: (t: () => PromiseLike<unknown>) => mockRunAfterResponse(t) }));
+const mockResolve = jest.fn();
+jest.mock('@/lib/inquiry-slack-actions', () => ({ INQUIRY_RESOLVE_ACTION_ID: 'inquiry_resolve', resolveInquiryFromSlack: (...a: unknown[]) => mockResolve(...a) }));
+jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => 'service-db' }));
+const mockAlertCaught = jest.fn();
+jest.mock('@/lib/alert', () => ({ alertCaughtError: (...a: unknown[]) => mockAlertCaught(...a) }));
 import { POST } from '../route';
 
 const SECRET = 'test-signing-secret';
@@ -140,4 +145,22 @@ describe('POST /api/slack/interactions', () => {
       expect(mockRunAfterResponse).not.toHaveBeenCalled();
     }
   });
+
+  test('inquiry_resolve ボタン → 解決処理へ payload とボタンの値（問い合わせ id）を渡して 200', async () => {
+    mockResolve.mockResolvedValueOnce('resolved');
+    const body = { type: 'block_actions', user: { id: 'U1', name: 'x' }, response_url: 'https://hooks.slack.com/a', actions: [{ type: 'button', action_id: 'inquiry_resolve', value: 'abc' }] };
+    const res = await POST(makeSignedRequest(`payload=${encodeURIComponent(JSON.stringify(body))}`));
+    expect(res.status).toBe(200);
+    await Promise.resolve();
+    expect(mockResolve).toHaveBeenCalledWith('service-db', expect.objectContaining({ user: body.user, response_url: body.response_url }), 'abc');
+  });
+
+  test('解決処理が throw しても 200 ack し、Slack へ例外を通知する', async () => {
+    mockResolve.mockRejectedValueOnce(new Error('boom'));
+    const body = { type: 'block_actions', actions: [{ type: 'button', action_id: 'inquiry_resolve', value: 'abc' }] };
+    const res = await POST(makeSignedRequest(`payload=${encodeURIComponent(JSON.stringify(body))}`));
+    expect(res.status).toBe(200);
+    await new Promise((r) => setTimeout(r, 0));
+    expect(mockAlertCaught).toHaveBeenCalledWith('slack-action:inquiry_resolve', expect.any(Error), '/api/slack/interactions');
+  });
 });
diff --git a/src/app/api/slack/interactions/route.ts b/src/app/api/slack/interactions/route.ts
index e44d7ad6..93b401f8 100644
--- a/src/app/api/slack/interactions/route.ts
+++ b/src/app/api/slack/interactions/route.ts
@@ -22,6 +22,8 @@ import { safeCaptureException } from '@/lib/safe';
 import { runAfterResponse } from '@/lib/after-response';
 import { alertCaughtError } from '@/lib/alert';
 import { serverError } from '@/lib/with-route';
+import { createServiceRoleClient } from '@/lib/supabase-server';
+import { INQUIRY_RESOLVE_ACTION_ID, resolveInquiryFromSlack } from '@/lib/inquiry-slack-actions';
 
 export const dynamic = 'force-dynamic';
 
@@ -49,8 +51,10 @@ type ActionHandler = (payload: SlackInteractionPayload, action: SlackAction) =>
 // 新しいボタンを追加する時は buttonElement(text, 'action_id_here', ...) と
 // ここに 'action_id_here': async (payload, action) => {...} を追加するだけ
 const ACTION_HANDLERS: Record<string, ActionHandler> = {
-  // 例: 'mark_resolved': async (payload, action) => { ... },
-  // 例: 'approve_salon': async (payload, action) => { ... },
+  // 未完了の問い合わせを解決済みにする（押した人が運営管理者か inquiry-slack-actions.ts で確かめる）
+  [INQUIRY_RESOLVE_ACTION_ID]: async (payload, action) => {
+    await resolveInquiryFromSlack(createServiceRoleClient(), payload, action.value);
+  },
 };
 
 export async function POST(request: Request) {
@@ -86,9 +90,7 @@ export async function POST(request: Request) {
     if (payload.actions && payload.actions.length > 0) {
       const action = payload.actions[0];
       // 自前のキーだけを引く（'constructor' 等で Object.prototype のメソッドを呼ばないため）。
-      /* istanbul ignore next -- ACTION_HANDLERS は現在空のため true 側は到達不能 */
       const handler = Object.hasOwn(ACTION_HANDLERS, action.action_id) ? ACTION_HANDLERS[action.action_id] : undefined;
-      /* istanbul ignore next -- ACTION_HANDLERS は現在空のため true 分岐は到達不能 */
       if (handler) {
         // 結果は気にせず即 ack 返却
         runAfterResponse(async () => {
/**
 * メールアドレスを「同一人物判定（突合）用」に正規化する純粋関数。
 *
 * 背景（真の予防）: 圧倒的多数のユーザーが Gmail で、Gmail は
 *   - ローカル部のドットを無視（f.o.o@gmail.com = foo@gmail.com）
 *   - "+tag" 以降を無視（foo+abc@gmail.com = foo@gmail.com）
 *   - googlemail.com = gmail.com
 * として「すべて同一受信箱」に届ける。生 email を顧客識別キーにすると、同一人物が
 * 別エイリアスで「別顧客」に分裂し、new_customer 限定クーポンの複数回取得（金銭被害）・
 * repeat クーポンの誤拒否・RFM/customer_segments の分裂を招く。
 *
 * 方針:
 *   - 全ドメイン共通: trim + 小文字化
 *   - gmail.com / googlemail.com のみ: ローカル部のドット除去・"+"以降除去・ドメインを gmail.com に統一
 *   - 非 Gmail: ドット/"+" の扱いはプロバイダ依存のため変更しない（別人を誤って併合しないための保守的判断）
 *
 * 用途: 保存・送信は原文（小文字化）を、突合（履歴照合・集計キー）は本関数の結果を使う。
 * 入力は zod の .email() 検証後を想定（@ を含む妥当なアドレス）。@ を持たない値は小文字化のみ返す。
 */
export function canonicalizeEmail(raw: string): string {
  const lower = raw.trim().toLowerCase();
  const at = lower.lastIndexOf('@');
  if (at <= 0) return lower; // ローカル部が空 or @ 無しは正規化対象外（防御）
  let local = lower.slice(0, at);
  let domain = lower.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const plus = local.indexOf('+');
    if (plus >= 0) local = local.slice(0, plus);
    local = local.replace(/\./g, '');
    if (local === '') return lower; // "+x@gmail.com" 等の不正入力は元の小文字を返す
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}
/** Missing private capabilities are intentional in public read-only previews.
 * Production must continue to fail closed when its required secrets are absent.
 */
export function isPublicReadOnlyPreview(): boolean {
  return process.env.VERCEL_ENV === 'preview' && !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// The public Preview carries only the production public URL/anon key. Signing in
// there would act on real production accounts, and a session is what every
// write policy keys on. Keep these areas closed so Preview stays read-only.
const ACCOUNT_PATHS = ['/auth', '/mypage', '/admin', '/liff', '/api/auth'];

export const PREVIEW_READ_ONLY_MESSAGE =
  'このプレビュー環境では、ログイン・会員機能・書き込みは使えません（本番のデータを守るため）。公開ページの閲覧だけを確認できます。';

/** True when a public read-only Preview must refuse this request. */
export function isPreviewRestricted(method: string, pathname: string): boolean {
  if (!isPublicReadOnlyPreview()) return false;
  if (!SAFE_METHODS.has(method.toUpperCase())) return true;
  return ACCOUNT_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

// @supabase/ssr session cookies, including chunked values and the PKCE verifier.
const SUPABASE_AUTH_COOKIE = /^sb-[a-z0-9]+-auth-token(?:-code-verifier)?(?:\.\d+)?$/;

/** Session cookies a public Preview must expire. A session created there before
 * the restriction would otherwise let browser clients write directly to production.
 */
export function previewStaleAuthCookies(cookieNames: string[]): string[] {
  if (!isPublicReadOnlyPreview()) return [];
  return cookieNames.filter((name) => SUPABASE_AUTH_COOKIE.test(name));
}

/** Fixed, cache-free refusal. Pages get a short notice, other methods JSON. */
export function previewRestrictedResponse(method: string, expireCookies: string[] = []): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  });
  for (const name of expireCookies) {
    headers.append('Set-Cookie', `${name}=; Path=/; Max-Age=0; SameSite=Lax; Secure`);
  }
  if (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
    return Response.json({ error: PREVIEW_READ_ONLY_MESSAGE, code: 'preview_read_only' }, { status: 403, headers });
  }
  headers.set('Content-Type', 'text/html; charset=utf-8');
  const html = '<!doctype html><html lang="ja"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>プレビュー環境</title></head>'
    + `<body><main><h1>プレビュー環境</h1><p>${PREVIEW_READ_ONLY_MESSAGE}</p><p><a href="/">トップへ戻る</a></p></main></body></html>`;
  return new Response(html, { status: 403, headers });
}
8:- フロント／API＝Next.js（App Router・Route Handler・バージョンは package-lock.json）/ デプロイ＝Cloudflare Workers（2026年11月11日に Vercel から切り替え。本番 `https://carelink-jp.com`・`www.` はアペックスへ 301）。`.github/workflows/deploy-cloudflare.yml` が「main 上で CI（push）が成功した最新のコミット」を自動配信する（判定＝`tools/cloudflare/deploy-target.mjs`。手動実行も同じ判定で、CI 未通過は配信できない。本番より古い版には戻さない）。配信前に Worker の秘密値の名前を `tools/cloudflare/required-worker-secrets.json` と照合し、配信後は本番の version と `/`・`/search`・`/register` の中身を確かめ、だめなら `wrangler rollback` で直前の版へ戻して Slack に通知する。main の CI が赤のときも Slack に通知する。確認に失敗して戻したコミットは artifact `bad-deploy-<sha>` で記録され以後は選ばれない（直して配信し直すときだけ手動実行の `retry_sha` で明示）。手動配信は `npm run deploy:cloudflare` だけを使い、公開設定は GitHub のリポジトリ変数が唯一の置き場（`gh variable list` で読む）。サーバーに秘密値を足したら `required-worker-secrets.json` にも名前を足す。切り替え・戻し方は `docs/handoff/CLOUDFLARE_PRODUCTION_MIGRATION_20261104.md`。Vercel は戻し先として 2026年11月25日ごろまで残す（Preview と Vercel Build Dry-Run の検査は残っている）
98:🔴 **`audit_logs` は読み書きとも service_role 専用**（2026年10月22日・`20261022230200`）。以前は施設メンバーが PostgREST から自店舗の行を全列読め、予約をキャンセル・変更した来院者の IP・UA・user_id が店舗に見えていた。監査履歴を画面に出す必要が出たら、ip・ua・他人の user_id を射影しないサーバーの API を作ること（ブラウザの SELECT 権・ポリシーを戻さない）。
338:- `createServiceRoleClient`（`supabase-server.ts`）＝service role。RLS バイパス。API ルート・cron などサーバー信頼文脈のみ。
401:- 決済・購読：`featured_slots` `subscription_plans` `user_subscriptions` `subscription_usage_logs` `facility_entitlements` `facility_payjp_customers` `featured_slot_payjp_subscriptions` `facility_option_payjp_subscriptions` `booking_payjp_charges` `payjp_webhook_events`（PAY.JP 側の ID は service_role 専用の別表に置く）。旧 Stripe の表・列は 2026年11月14日に撤去した（本番で 0 行を確認・migration `20261114120000`）
413:| NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase（本番必須）。Vercel の Preview には 2026年10月25日から**本番の公開 URL と anon キーだけ**を入れている（公開閲覧の確認用・`docs/handoff/CPU_PREVIEW_CAPABILITIES_20261025.md`）。service-role が無い Preview は `isPublicReadOnlyPreview()` で公開閲覧専用になり、`isPreviewRestricted()`（`src/lib/preview-capabilities.ts`）が middleware と `withRoute` で**ログイン・会員/店舗画面・変更系メソッドを 403 で止める**（本番の Auth・データへ Preview から触れないため。2026年10月28日）。資格情報の無いビルドは `hasSupabasePublicEnv()`（`src/lib/supabase-build-env.ts`）で事前生成を省いて通る |
414:| SUPABASE_SERVICE_ROLE_KEY | service role（cron／管理 API のサーバ側 DB 操作・RLS バイパス・**本番必須**）。**Vercel の Preview には設定しない**（上の行と同じ理由。本番の secret をプレビューへ再登録しない） |
442:| THREADS_USER_ID | Threads 自動投稿の投稿先ユーザーID（未設定なら投稿は `skipped`＝正常扱い）。**アクセストークンは env に置かない**（60日で失効し `threads-token-refresh` cron が自動更新するが、env はコードから書き換えられないため）。トークンは `threads_credentials` テーブルに入る（RLS 有効・許可ポリシー無し＝service role のみ読める） |
453:  - **有効**：`schema-fingerprint.yml`（push/PR で migration からスキーマ期待値を再生成し陳腐化を検査）・`migration-apply-reminder.yml`（PR に新規 migration があれば本番適用を促す）・`mutation-l4.yml`（Stryker・週次 日曜 JST 03:00）・`dependency-update.yml`（依存更新・週次 月曜 JST 09:00）・`vercel-preview-build.yml`（PR で `vercel build` ドライ実行・repo variable `ENABLE_VERCEL_PR_BUILD == 'true'` のときだけ動く）・`deploy-cloudflare.yml`（main の CI 成功後に本番 Worker へ配信し、本番の version が配信したコミットになるまで確認する。公開設定はリポジトリ変数 `NEXT_PUBLIC_*`・`CLOUDFLARE_ACCOUNT_ID`、トークンは secret `CLOUDFLARE_API_TOKEN`）・`cron-constraints.yml` / `anon-write-policy-lint.yml` / `secdef-search-path-lint.yml` / `actionlint.yml`（いずれも `paths:` 絞り込み付きの静的ガード）
475:- 【🔴 Vercel Hobby の日次ビルド枠を実際に使い切ると24時間デプロイ不能になる】2026年7月29日、1日に9マージ＋7PR起票を行った結果 `Deployment rate limited — retry in 24 hours` が発生した。本番は既存デプロイで動き続けるが、この間は【緊急修正を出せない】。神原さんの判断で【Hobby を継続】（同日）。恒久対策として `vercel.json` の `ignoreCommand` に `scripts/vercel-should-build.sh` を配線し、配信物に影響しない変更（`supabase/migrations/` ・`.github/` ・`docs/` ・`e2e/` ・ルート直下の `.md` ・テストファイル・判定スクリプト自身と CI 専用の PostgREST 検査）だけならビルドをスキップする。比較元は【最後に成功した配信】（`VERCEL_GIT_PREVIOUS_SHA`。Preview の初回は稼働中の本番の版）なので、途中で配信に失敗したアプリ変更を後続の文書変更で隠さない。本番は、その最後に成功した配信が `/api/health` の稼働中の版と一致するときだけ省略する（昇格・未昇格の成功配信のアプリ変更を隠さないため。2026年10月31日の敵対レビューで追加）。本番は止まっていることが多く起動に5〜6秒かかるため、`/api/health` は1回15秒・2回まで待つ（2026年11月1日。5秒では #879 の文書だけの配信でも時間切れでビルドしていた）。省略しても GitHub では緑の success になるので、判定の中身はビルドログの `判定情報:` 行で確認する。文書だけの push では設定変更が反映されない（手順は `docs/MANUAL.md` 5.1）。🔴 **Vercel では `.vercelignore` が `.git` を取り除くため、判定に git は使えない**（2026年10月30日に実測。#851 の導入以来、git に頼った判定は一度も働かず、本番・Preview とも毎回ビルドしていた）。変更ファイルは GitHub の比較 API（比較元…`VERCEL_GIT_COMMIT_SHA`）から取り、取得失敗・別系統・途切れた一覧などは必ずビルドに倒す。判定が緩む改変と git 依存の復活は `src/__tests__/vercel-build-skip.test.ts`（`.git` の無い場所で実行する）が CI で止める。作業時は【1日のマージ数を意識し、複数の修正はできるだけ1本のPRにまとめる】。
479:- 【🔴 RLS は列を絞れない。「その施設のメンバーか」だけのポリシーは全列の書き換えを許す】`facility_reviews_member_update` は施設メンバーであることしか見ておらず、管理画面が実際に使うのは `status`（公開／非表示）だけなのに、PostgREST を直に叩けば **客が書いた `rating` と `comment` まで書き換えられた**（集計トリガが平均点を再計算するので、星の書き換えはそのまま評価点の水増しになる）。列を絞る手段は RLS ではなく【列レベル GRANT】しか無い（`GRANT UPDATE (status) ON facility_reviews TO authenticated`）。2026年8月22日の migration `20260822000001` で是正済み。同じ形の穴として `reports` は「どこかの施設のオーナーであること」しか見ておらず、**全施設の通報を通報者の IP つきで読め、削除もできた**（アプリ側に読み取り経路は 1 本も無いので service_role 専用へ落とした）。新しいポリシーを書くときは「行を絞る条件」と「触ってよい列」を別々に考えること。同じ形の穴として `facility_qa` は INSERT ポリシーが「自分の user_id か」しか見ておらず、ログインした人なら誰でも `answer`・`status='answered'`・`is_public` を書いて**施設名義の偽回答を公開できた**（2026年10月22日に是正。質問は `/api/facility/qa`、回答は `/api/admin/qa` の RPC だけ。`20261022230100` で列と WITH CHECK を絞り、デプロイ後に `20261022230300` でブラウザの INSERT 自体を撤回する。`supabase db push` は保留分を一括適用するので、`20261022230300` を含めない状態で push → デプロイ → 含めて push の 2 回に分ける）。
481:- 【🔴 RLS は【書き込みポリシーの不在】も無音の機能欠落になる】`review_replies` は公開読みポリシー 1 本だけで INSERT ポリシーが無く、管理画面の口コミ返信（ブラウザの authenticated クライアントから INSERT）は**押すたびに必ず失敗していた**。（2026年10月22日以降、返信の公開・編集・削除は `/api/admin/review-replies` → service_role 専用 RPC に一本化した。RPC の追加＝`supabase/migrations/20261022140000_review_reply_edit_delete.sql`、ブラウザの書き込み権と INSERT ポリシーの撤回＝`20261022140100_review_reply_close_browser_writes.sql`。本番は「1 本目を適用 → デプロイ → 2 本目を適用」の順で、同時に適用すると旧コードの投稿が壊れる窓ができる）RLS 有効かつ該当コマンドのポリシー不在＝常に拒否。UI が既にある機能を足すときは、読みだけでなく**そのコマンドのポリシーがあるか**を `src/lib/schema-fingerprint.expected.json` の `policy|<table>|` 行で確認する。
482:- 【🔴 SECURITY INVOKER のトリガが RLS のある表を UPDATE すると 0 行更新で無音停止する】`update_facility_rating()` は SECURITY INVOKER のまま `facility_profiles` を UPDATE していた。`facility_profiles` には SELECT ポリシーしか無いので、authenticated 文脈（＝管理画面から口コミを非表示にしたとき）に走ると **例外も出ずに 0 行更新**となり、平均点・件数が置いていかれた。service_role 経由（/api/review）では RLS を素通りするため発症せず、管理画面のときだけズレるので気づけない。集計トリガのように「呼び出し元の可視性に依存してはいけない」ものは SECURITY DEFINER ＋ `SET search_path` にする。
616:   service_role` を持つため、public の全テーブルに 3 ロール分の GRANT が自動で付く。
713:⚠️ 2026年11月11日以降、本番はこの経路では配信していない（Cloudflare Workers へ移行）。Vercel を片付けるまでの戻し先・Preview 用として残している。
715:`Dockerfile.vercel` はビルド・配信とも公式Node.js 24.22.1のdigestに固定し、standaloneを非root・PORT3000で実行する。CIと同じ `npm run build`（Webpack）を維持する。Vercel Container Runtimeのbuild ARG引き渡し不具合を回避するため、ビルド段だけ同一プロジェクトの `node24-public-config` イメージをdigest固定で使う。このベースにはNode本体と既存のブラウザ向け公開設定だけが入り、アプリコード・service-role・メール・決済・通知等の秘密値は入れない。アプリのソースは毎回COPYして再ビルドするため、Gitのコード更新が古いイメージで配信される構成ではない。
724:- DB `platform_mail`：直接書込は禁止。`manage_platform_mail_atomic` は service-role にのみ実行を許可し、呼出ごとに現在の `profiles.is_platform_admin` をロック・確認する。下書きはrevision一致時のみ保存する。業務上の競合は`PT409`を返し、PostgRESTの自動transaction再試行を誘発する`40001`を使わない。送信予約時に本文・宛先・送信元・日時を固定する。`guard_platform_mail_inquiry_overlap` は旧問い合わせ返信と同じcontact行をロックし、結果不明・送信待ちの二重返信を防ぐ。

exec
/bin/zsh -lc "rg -n 'PR996|ボタン付き通知|Preview.*Slack' docs/ai-handoffs; sed -n '70,145p' src/lib/slack.ts; rg -n 'canonical|regexp|btrim' supabase/migrations/20260820000004_salons_profiles_email_canonical.sql; ls -ld node_modules node_modules/.bin/jest; node -v; git diff --check origin/main...ee83a16a" in /Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940
 succeeded in 0ms:
docs/ai-handoffs/pr996-inquiry-slack-resolve.md:12:| PR996-01 | 高 | `src/lib/slack.ts:83,232`、`src/lib/preview-capabilities.ts:4` | Preview ではボタン付き通知も操作結果も Slack に送らない。 | 抑止条件は `VERCEL_ENV=preview` かつサービスロールキー未設定です。合成キーを設定した Preview 条件では通知と操作結果がそれぞれモックの `fetch` に到達し、キーなしではどちらも到達しないことを確認しました。基準 (3) に違反します。 |
docs/ai-handoffs/pr996-inquiry-slack-resolve.md:13:| PR996-02 | 中 | `src/lib/slack.ts:220`、`src/lib/inquiry-slack-actions.ts:81`、`supabase/migrations/20260820000004_salons_profiles_email_canonical.sql:79` | Slack と CareLink で同じメールを持つ運営管理者がボタンから解決できる。 | Slack 側は前後の空白除去と小文字化だけですが、DB の `email_canonical` は Gmail のドットと `+` タグも除去します。両側の元アドレスが同じ `admin.example+tag@gmail.com` でも、DB 側の生成値は `adminexample@gmail.com` です。この条件をモックで確認し、`not_admin` が返って RPC が呼ばれないことを再現しました。 |
docs/ai-handoffs/pr996-inquiry-slack-resolve.md:14:| PR996-03 | 中 | `src/lib/inquiry-slack-actions.ts:23,29–39`、`src/lib/inquiry-backlog.ts:211` | 朝の通知対象になった問い合わせを、Slack のボタンから解決できる。 | 21件を渡すとボタンは20個で、残りは管理画面へのリンクにまとめられます。古い20件が残り続けると、21件目以降には翌日以降もボタンが付きません。21件でのボタン数は対象コードを使って確認しました。 |
docs/ai-handoffs/pr996-inquiry-slack-resolve.md:24:- PR996-01：変更なし。Slack 送信の止め方は既存の postToSlack と同じ isPublicReadOnlyPreview（service-role の無い Preview）に揃えている。service-role を入れた Preview は公開閲覧専用ではない既存の扱いで、CLAUDE.md の運用でも Preview に service-role は置かない。送信の出口と止め方を1つに保つため、この PR では判定を変えない。
docs/ai-handoffs/pr996-inquiry-slack-resolve.md:25:- PR996-02：修正。Slack のメールを canonicalizeEmail（DB の email_canonical と同じ規則）で揃えてから照合する。
docs/ai-handoffs/pr996-inquiry-slack-resolve.md:26:- PR996-03：修正。20件で切らず、20件ごとに分けて全件にボタンを付ける。
/**
 * Slack chat.postMessage を呼び出す。
 *
 * 失敗時は ok:false の SlackPostResult を返す（throw しない）。
 * 呼び出し側が fire-and-forget で投げる場合に本体応答を壊さないため。
 *
 * SLACK_BOT_TOKEN 未設定時も error: 'not_configured' を返すのみ。
 */
export async function postToSlack(opts: SlackPostOptions): Promise<SlackPostResult> {
  // 公開閲覧専用の Preview は誰でも開ける。そこには本番の Slack トークンが入っているが、
  // middleware の対象外の API（withRoute を使わないもの）は Preview でも処理まで届くため、
  // 送信の唯一の出口であるここで止める（外部の人が本番の Slack へ投稿させられないように）。
  if (isPublicReadOnlyPreview()) return { ok: false, error: 'preview_read_only' };
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = opts.channel || process.env.SLACK_DEFAULT_CHANNEL;

  if (!token) return { ok: false, error: 'not_configured' };
  if (!channel) return { ok: false, error: 'no_channel' };
  if (!opts.text && !opts.blocks) return { ok: false, error: 'empty_payload' };

  const body: Record<string, unknown> = { channel };
  if (opts.text) body.text = opts.text;
  if (opts.blocks) body.blocks = opts.blocks;
  if (opts.thread_ts) body.thread_ts = opts.thread_ts;
  if (opts.reply_broadcast) body.reply_broadcast = true;
  if (opts.username) body.username = opts.username;
  if (opts.icon_emoji) body.icon_emoji = opts.icon_emoji;
  if (opts.unfurl_links !== undefined) body.unfurl_links = opts.unfurl_links;
  if (opts.unfurl_media !== undefined) body.unfurl_media = opts.unfurl_media;

  try {
    const res = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return { ok: false, error: `http_${res.status}` };
    }

    const json = (await res.json()) as { ok: boolean; ts?: string; channel?: string; error?: unknown };
    if (!json.ok) return { ok: false, error: typeof json.error === 'string' && SAFE_SLACK_ERROR_CODES.has(json.error) ? json.error : 'unknown' };
    return { ok: true, ts: json.ts, channel: json.channel };
  } catch {
    return { ok: false, error: 'fetch_failed' };
  }
}

// ===== Phase 7c: Incident thread 集約 =====

/**
 * 同じ thread_key で連発する通知を Slack スレッドに集約する。
 *
 * 動作:
 *  1. supabase RPC get_incident_thread(thread_key) で既存スレッド ts を取得
 *  2. 見つかれば thread_ts 指定で reply（同スレッド内に追加）
 *  3. 見つからなければ通常投稿 → record_incident_thread(...) で ts 保存
 *
 * 期限: 24h（migration で設定）。それを超えると新スレッドが立つ。
 *
 * 例: thread_key = `alert:route=/api/profile:commit=abc1234`
 *     → 同 route + 同 commit の 500 連発が 1 スレッドにまとまる
 */
export async function postToSlackWithThreadGrouping(opts: {
  thread_key: string;
  channel?: string;
  text?: string;
  blocks?: unknown[];
}): Promise<SlackPostResult> {
  const channel = opts.channel || process.env.SLACK_DEFAULT_CHANNEL;
  if (!channel) return { ok: false, error: 'no_channel' };
15:-- salons.email_canonical / profiles.email_canonical を新設する（2026年8月20日）
39:--   email_canonical 生成列（20260607_email_canonical_column.sql）で解決済みで、
40:--   src/lib/email-canonical.ts の canonicalizeEmail() が正規化ロジックの単一ソース
45:-- 生成式は 20260607_email_canonical_column.sql の bookings.email_canonical /
46:-- customer_visits.email_canonical と完全に同一（別式にすると同じ入力から違う値が
48:-- 生成式は canonicalizeEmail() と同一出力:
53:-- GENERATED ALWAYS AS ... STORED は IMMUTABLE 関数(lower/btrim/split_part/regexp_replace)
58:-- salons.email_canonical（salons.email は NOT NULL だが、既存 migration の形式
61:  ADD COLUMN IF NOT EXISTS email_canonical TEXT
66:       AND length(regexp_replace(split_part(split_part(lower(btrim(email)), '@', 1), '+', 1), '\.', '', 'g')) > 0
67:      THEN regexp_replace(split_part(split_part(lower(btrim(email)), '@', 1), '+', 1), '\.', '', 'g') || '@gmail.com'
68:      ELSE lower(btrim(email))
72:-- facility/setup の salons 突合 .eq('email_canonical', canonicalizeEmail(user.email)) 用インデックス
73:CREATE INDEX IF NOT EXISTS idx_salons_email_canonical
74:  ON salons(email_canonical);
76:-- profiles.email_canonical（profiles.email は NULL 許容＝ソーシャルログイン等でメール未取得の
79:  ADD COLUMN IF NOT EXISTS email_canonical TEXT
84:       AND length(regexp_replace(split_part(split_part(lower(btrim(email)), '@', 1), '+', 1), '\.', '', 'g')) > 0
85:      THEN regexp_replace(split_part(split_part(lower(btrim(email)), '@', 1), '+', 1), '\.', '', 'g') || '@gmail.com'
86:      ELSE lower(btrim(email))
90:-- onboarding-followup cron の profiles 突合 .eq('email_canonical', canonicalizeEmail(salon.email))
92:CREATE INDEX IF NOT EXISTS idx_profiles_email_canonical
93:  ON profiles(email_canonical);
drwxr-xr-x@ 666 kam  staff  21312 Nov 25 15:26 node_modules
lrwxr-xr-x@   1 kam  staff     19 Nov 25 15:25 node_modules/.bin/jest -> ../jest/bin/jest.js
v22.23.3
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead

web search: 
exec
/bin/zsh -lc "rg -n 'reportInquiryBacklog|retry-after|429' src/lib/{slack,inquiry-backlog,inquiry-slack-actions,alert}.ts src/app/api/cron; rg -n 'vercel|slack' docs/handoff/CPU_PREVIEW_CAPABILITIES_20261025.md | head -35; git diff 33f7f333..ee83a16a -- src/lib/inquiry-slack-actions.ts; git diff origin/main...ee83a16a -- src/lib/__tests__/inquiry-backlog.test.ts" in /Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940
 succeeded in 0ms:
src/lib/inquiry-backlog.ts:151:export async function reportInquiryBacklog(
src/app/api/cron/sync-google-ratings/route.ts:47:  // 監査X2: fetchFailed は「Places API 呼び出しが null を返した(例外/401/429/5xx/status≠OK)」件数。
src/app/api/cron/sync-google-ratings/route.ts:77:        // fetchPlaceDetails は例外/401/429/5xx/status≠OK を全て null に畳む。
src/app/api/cron/sync-google-ratings/__tests__/route.test.ts:195:    // null 返り＝例外/401/429/5xx 等の API 障害。レビュー無し施設の正常スキップとは区別する。
src/app/api/cron/cron-heartbeat/route.ts:18:import { isInquiryBacklogReportTime, reportInquiryBacklog, claimInquiryBacklogReport } from '@/lib/inquiry-backlog';
src/app/api/cron/cron-heartbeat/route.ts:67:        inquiryBacklog = await reportInquiryBacklog(db, startedAt, { claim: () => claimInquiryBacklogReport(db, startedAt) });
src/app/api/cron/cron-heartbeat/__tests__/route.test.ts:34:  reportInquiryBacklog: jest.fn(),
src/app/api/cron/cron-heartbeat/__tests__/route.test.ts:42:import { reportInquiryBacklog, claimInquiryBacklogReport } from '@/lib/inquiry-backlog';
src/app/api/cron/cron-heartbeat/__tests__/route.test.ts:169:    (reportInquiryBacklog as jest.Mock).mockResolvedValue({ unreplied: 0, repliedOpen: 4 });
src/app/api/cron/cron-heartbeat/__tests__/route.test.ts:172:    expect(reportInquiryBacklog).toHaveBeenCalledWith({ db: true }, expect.any(Date), { claim: expect.any(Function) });
src/app/api/cron/cron-heartbeat/__tests__/route.test.ts:182:    expect(reportInquiryBacklog).not.toHaveBeenCalled();
src/app/api/cron/cron-heartbeat/__tests__/route.test.ts:189:    (reportInquiryBacklog as jest.Mock).mockImplementation(async (_db, _now, opts) => ((await opts.claim()) ? { unreplied: 1, repliedOpen: 0 } : 'already'));
src/app/api/cron/cron-heartbeat/__tests__/route.test.ts:200:    (reportInquiryBacklog as jest.Mock).mockRejectedValue(new Error('db down'));
src/app/api/cron/webhook-retry/route.ts:302:            // 4xx（429 以外）は LINE が受け付けなかったことが確定している。結果不明として毎 run 保留し
src/app/api/cron/webhook-retry/route.ts:304:            // 429・5xx・通信断は受理された可能性を否定できないので従来どおり照合へ上げる。
src/app/api/cron/booking-reminder/route.ts:399:            // 一時的な失敗（429・5xx・ネットワーク）→ claim を解放し、届かなかった件数に数える
src/app/api/cron/webhook-retry/__tests__/route.test.ts:358:    const id=channelJob(),started=new Date().toISOString();(prepareCustomerBookingChannel as jest.Mock).mockResolvedValue(async()=>({outcome:'rejected',status:429}));
src/app/api/cron/webhook-retry/__tests__/route.test.ts:363:    expect(mockBookingFence).toHaveBeenCalledWith('record_customer_booking_channel_rejection',expect.objectContaining({p_queue_id:id,p_started_at:started,p_provider_status:429}));
src/app/api/cron/webhook-retry/__tests__/route.test.ts:644:    const mockSend = jest.fn().mockResolvedValue({ data: null, error: { statusCode: 429 } });
src/app/api/cron/webhook-retry/__tests__/route.test.ts:1743:  creationJob();channel().mockResolvedValue(async()=>({outcome:'retryable',reason:'booking_push_provider_rejected',status:429}));
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
diff --git a/src/lib/inquiry-slack-actions.ts b/src/lib/inquiry-slack-actions.ts
index 62ed7114..bc3cc634 100644
--- a/src/lib/inquiry-slack-actions.ts
+++ b/src/lib/inquiry-slack-actions.ts
@@ -14,42 +14,51 @@
 import type { createServiceRoleClient } from './supabase-server';
 import { actionsBlock, buttonElement, getSlackUserEmail, linkButtonElement, postToSlack, respondToSlackAction, sectionBlock } from './slack';
 import { writeAuditLog } from './audit-logger';
+import { canonicalizeEmail } from './email-canonical';
 
 type DB = ReturnType<typeof createServiceRoleClient>;
 
 export const INQUIRY_RESOLVE_ACTION_ID = 'inquiry_resolve';
 const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
-/** 1通に載せるボタンの上限（Slack は 1 メッセージ 50 ブロックまで。1件 2 ブロック＋見出し・案内）。 */
+/** 1通に載せる件数（Slack は 1 メッセージ 50 ブロックまで。1件 2 ブロック＋見出し・リンク）。超えた分は次の1通に続ける。 */
 export const MAX_BUTTON_ITEMS = 20;
 
 export interface ResolvableLine { id: string; label: string }
 
-/** ボタン付きメッセージの blocks を作る（純粋関数）。label は送る前の伏せ字処理を通したもの。 */
-export function buildInquiryResolveBlocks(lines: ResolvableLine[], adminUrl: string): Record<string, unknown>[] {
-  const shown = lines.slice(0, MAX_BUTTON_ITEMS);
+/** ボタン付きメッセージ1通分の blocks を作る（純粋関数）。label は送る前の伏せ字処理を通したもの。 */
+export function buildInquiryResolveBlocks(lines: ResolvableLine[], adminUrl: string, page = { index: 1, total: 1 }): Record<string, unknown>[] {
+  const heading = page.total > 1 ? `*未完了のお問い合わせ（${page.index}/${page.total}）*` : '*未完了のお問い合わせ*';
   const blocks: Record<string, unknown>[] = [
-    sectionBlock('*未完了のお問い合わせ*（対応が済んだものは「解決済みにする」を押してください。解決済みにするまで毎朝お知らせします）'),
+    sectionBlock(`${heading}（対応が済んだものは「解決済みにする」を押してください。解決済みにするまで毎朝お知らせします）`),
   ];
-  for (const line of shown) {
+  for (const line of lines.slice(0, MAX_BUTTON_ITEMS)) {
     blocks.push(sectionBlock(line.label));
     blocks.push(actionsBlock([buttonElement('解決済みにする', INQUIRY_RESOLVE_ACTION_ID, line.id, 'primary')]));
   }
-  const rest = lines.length - shown.length;
-  blocks.push(actionsBlock([linkButtonElement(rest > 0 ? `問い合わせ管理を開く（ほか${rest}件）` : '問い合わせ管理を開く', adminUrl)]));
+  blocks.push(actionsBlock([linkButtonElement('問い合わせ管理を開く', adminUrl)]));
   return blocks;
 }
 
-/** ボタン付きメッセージを送る。失敗しても throw しない（文章の通知は別に出ている）。 */
+/**
+ * ボタン付きメッセージを送る。全件にボタンが付くよう、MAX_BUTTON_ITEMS 件ごとに分けて送る
+ * （上限で切ると、古い件が残り続ける間は新しい件に毎日ボタンが付かない・Codex 指摘 PR996-03）。
+ * 失敗しても throw しない（文章の通知は別に出ている）。全通送れたら true。
+ */
 export async function postInquiryResolveButtons(lines: ResolvableLine[], adminUrl: string): Promise<boolean> {
   if (lines.length === 0) return false;
-  try {
-    const result = await postToSlack({ text: `未完了のお問い合わせ ${lines.length}件（ボタンで解決済みにできます）`, blocks: buildInquiryResolveBlocks(lines, adminUrl), unfurl_links: false });
-    if (!result.ok) console.error('[inquiry-slack] button post failed:', result.error);
-    return result.ok;
-  } catch {
-    console.error('[inquiry-slack] button post failed:', 'notification_failure');
-    return false;
+  const total = Math.ceil(lines.length / MAX_BUTTON_ITEMS);
+  let allOk = true;
+  for (let index = 0; index < total; index += 1) {
+    const chunk = lines.slice(index * MAX_BUTTON_ITEMS, (index + 1) * MAX_BUTTON_ITEMS);
+    try {
+      const result = await postToSlack({ text: `未完了のお問い合わせ ${lines.length}件（ボタンで解決済みにできます）`, blocks: buildInquiryResolveBlocks(chunk, adminUrl, { index: index + 1, total }), unfurl_links: false });
+      if (!result.ok) { allOk = false; console.error('[inquiry-slack] button post failed:', result.error); }
+    } catch {
+      allOk = false;
+      console.error('[inquiry-slack] button post failed:', 'notification_failure');
+    }
   }
+  return allOk;
 }
 
 export interface ResolvePayload {
@@ -79,7 +88,7 @@ async function decide(db: DB, payload: ResolvePayload, contactId: string | undef
   if (!contactId || !UUID_RE.test(contactId) || !slackUserId) return 'invalid';
   const email = await getSlackUserEmail(slackUserId);
   if (!email) return 'no_email';
-  const { data: admins, error: lookupError } = await db.from('profiles').select('id').eq('email_canonical', email).eq('is_platform_admin', true).limit(2);
+  const { data: admins, error: lookupError } = await db.from('profiles').select('id').eq('email_canonical', canonicalizeEmail(email)).eq('is_platform_admin', true).limit(2);
   if (lookupError) return 'failed';
   if (!admins || admins.length !== 1) return 'not_admin';
   const actorId = (admins[0] as { id: string }).id;
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
diff --git a/src/lib/__tests__/inquiry-backlog.test.ts b/src/lib/__tests__/inquiry-backlog.test.ts
index ff196ec6..7128d95e 100644
--- a/src/lib/__tests__/inquiry-backlog.test.ts
+++ b/src/lib/__tests__/inquiry-backlog.test.ts
@@ -1,7 +1,9 @@
 jest.mock('../alert', () => ({ alertWarning: jest.fn(), redactAlertText: jest.requireActual('../alert').redactAlertText }));
 jest.mock('../platform-mail-read', () => ({ readMailReplyEvidence: jest.fn() }));
+jest.mock('../inquiry-slack-actions', () => ({ postInquiryResolveButtons: jest.fn().mockResolvedValue(true) }));
 
 import { alertWarning } from '../alert';
+import { postInquiryResolveButtons } from '../inquiry-slack-actions';
 import { readMailReplyEvidence } from '../platform-mail-read';
 import { readFileSync } from 'fs';
 import { join } from 'path';
@@ -156,6 +158,15 @@ describe('reportInquiryBacklog', () => {
     // メール・電話・本文も、種類欄に書かれた自由記述も、受付番号も載らない
     const sent = JSON.stringify([message, opts]);
     for (const secret of ['a@example.invalid', '090-1234-5678', '本文', '佐藤花子', '腰の痛み', '01234567', '00000000']) expect(sent).not.toContain(secret);
+    // 1件ごとに「解決済みにする」ボタンを付けたメッセージも出す（ボタンの値は問い合わせの id・表示は同じ1行）
+    expect(postInquiryResolveButtons).toHaveBeenCalledTimes(1);
+    const [lines, adminUrl] = (postInquiryResolveButtons as jest.Mock).mock.calls[0];
+    expect(adminUrl).toBe('https://carelink-jp.com/admin/inquiries');
+    expect(lines.map((l: { id: string }) => l.id).sort()).toEqual([uuid(1), uuid(2), uuid(3), '01234567-0000-4000-8000-000000000004'].sort());
+    expect(lines).toContainEqual({ id: uuid(1), label: '山田 太郎様・9/19受付・施設掲載について（オーナー向け）・新着タブ（59日）' });
+    expect(lines).toHaveLength(4);
+    const buttonText = JSON.stringify(lines.map((l: { label: string }) => l.label));
+    for (const secret of ['a@example.invalid', '090-1234-5678', '本文', '佐藤花子', '腰の痛み']) expect(buttonText).not.toContain(secret);
   });
 
   test('知らせるものが無ければ Slack に出さない', async () => {
@@ -163,6 +174,7 @@ describe('reportInquiryBacklog', () => {
     await expect(reportInquiryBacklog(db, now)).resolves.toEqual({ unreplied: 0, repliedOpen: 0 });
     expect(readMailReplyEvidence).not.toHaveBeenCalled();
     expect(alertWarning).not.toHaveBeenCalled();
+    expect(postInquiryResolveButtons).not.toHaveBeenCalled();
   });
 
   test('片方の区分が空なら「なし」と出し、上限を超えた分は省略件数に数え、設定済みの URL を使う', async () => {

exec
/bin/zsh -lc 'node node_modules/jest/bin/jest.js --runInBand --no-cache --watchman=false --runTestsByPath src/lib/__tests__/inquiry-slack-actions.test.ts src/lib/__tests__/inquiry-backlog.test.ts src/app/api/slack/interactions/__tests__/route.test.ts' in /Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940
 exited 1 in 282ms:
Error: EPERM: operation not permitted, open '/private/var/folders/q5/b1tqf8rx4xzgvnsd366h9w600000gn/T/jest_dx/haste-map-e08662aa221cf4c32724da1f9479db0a-3451c6637a231f99ef301b0d1e0c60b6-c8e219cdbe0179662180b1a8e18b5ffb'
    at Object.openSync (node:fs:560:18)
    at writeFileSync (node:fs:2444:35)
    at CacheManager.persist (/Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/node_modules/jest-haste-map/build/index.js:971:37)
    at HasteMap._persist (/Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/node_modules/jest-haste-map/build/index.js:3543:24)
    at /Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/node_modules/jest-haste-map/build/index.js:3476:16
    at async /Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/node_modules/@jest/core/build/index.js:1500:48
    at async Promise.all (index 0)
    at async buildContextsAndHasteMaps (/Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/node_modules/@jest/core/build/index.js:1489:20)
    at async _run10000 (/Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/node_modules/@jest/core/build/index.js:1551:7)
    at async runCLI (/Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/node_modules/@jest/core/build/index.js:1457:3)

web search: site:docs.slack.dev chat.postMessage one message per second per channel retry after rate limits
codex
メール照合と20件ごとの分割は差分で確認できました。Jest は読み取り専用環境でキャッシュを書けなかったため、実際の変更コードを読み込み、Slack への通信をモックして境界値と送信失敗時の挙動を確認します。
exec
/bin/zsh -lc "node <<'NODE'
const fs = require('node:fs'), ts = require('typescript'), assert = require('node:assert/strict');
const loaded = {};
function load(name) {
  if (name === 'audit-logger') return {writeAuditLog: async()=>{}};
  if (loaded[name]) return loaded[name];
  const code = ts.transpileModule(fs.readFileSync('src/lib/'+name+'.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod = {exports:{}};
  new Function('require','module','exports',code)(id=>id.startsWith('./')?load(id.slice(2)):require(id), mod, mod.exports);
  return loaded[name] = mod.exports;
}
(async()=>{
const slack=load('slack'), actions=load('inquiry-slack-actions');
Object.assign(process.env,{SLACK_BOT_TOKEN:'synthetic',SLACK_DEFAULT_CHANNEL:'synthetic',VERCEL_ENV:'production'});
let posts=[], reply=0, lookup=0, rejectSecond=false;
global.fetch=async(url,opts)=>{
  if(url.includes('chat.postMessage')) {
    posts.push(JSON.parse(opts.body));
    return rejectSecond && posts.length===2 ? new Response(null,{status:429,headers:{'Retry-After':'1'}}) : Response.json({ok:true});
  }
  if(url.includes('users.info')) {lookup++;return Response.json({ok:true,user:{profile:{email:' Admin.Example+tag@googlemail.com '}}});}
  if(url.startsWith('https://hooks.slack.com/')) {reply++;return new Response();}
  throw Error('unexpected');
};
const make=n=>Array.from({length:n},(_,i)=>({id:String(i),label:'label'}));
for(const n of [0,1,20,21,40,41]) {
  posts=[];
  assert.equal(await actions.postInquiryResolveButtons(make(n),'https://example.invalid'),n>0);
  assert.ok(posts.every(p=>p.blocks.length<=42));
  assert.deepEqual(posts.flatMap(p=>p.blocks.flatMap(b=>b.elements??[]).filter(e=>e.action_id==='inquiry_resolve').map(e=>e.value)),make(n).map(x=>x.id));
}
posts=[];rejectSecond=true;
assert.equal(await actions.postInquiryResolveButtons(make(41),'https://example.invalid'),false);assert.equal(posts.length,3);
let rpc=0;
const db={from(){return this},select(){return this},eq(k,v){assert.equal(v,k==='email_canonical'?'adminexample@gmail.com':true);return this},limit(){return {data:[{id:'admin'}]}},rpc(){rpc++;return {data:{}}}};
assert.equal(await actions.resolveInquiryFromSlack(db,{user:{id:'U'}},'00000000-0000-4000-8000-000000000000'),'resolved');assert.equal(rpc,1);
process.env.VERCEL_ENV='preview';
for(const privateKey of [false,true]) {
  if(privateKey) process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  posts=[];reply=0;lookup=0;
  assert.equal(await actions.postInquiryResolveButtons(make(1),'https://example.invalid'),privateKey);
  await slack.getSlackUserEmail('U'); await slack.respondToSlackAction('https://hooks.slack.com/synthetic','test');
  assert.deepEqual([posts.length,lookup,reply],Array(3).fill(Number(privateKey)));
}
console.log('PASS: 0/1/20/21/40/41, HTTP 429 continuation without retry, Gmail alias RPC, both Preview configurations');
})().catch(e=>{console.error(e);process.exitCode=1});
NODE
git diff --check 33f7f333..ee83a16a
git status --short
git rev-parse HEAD
sed -n '145,215p' src/lib/inquiry-backlog.ts
head -25 src/lib/slack.ts" in /Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940
 succeeded in 0ms:
zsh:1: can't create temp file for here document: operation not permitted
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
ee83a16a47f1b25d032ca739449fdc60ac864c5c
}

/**
 * 未完了の問い合わせを数え、知らせるものがあれば Slack に 1 通出す。
 * 取得に失敗したら throw する（「0件」と区別できないまま黙らないため。呼び出し側の cron で記録する）。
 */
export async function reportInquiryBacklog(
  db: DB,
  now: Date = new Date(),
  // 送る直前に呼ぶ「今日の通知の枠」。読み取りが済んで送るものがあるときだけ取るので、
  // 読み取りに失敗しても枠は残り、同じ日に再実行すれば通知できる（Codex 指摘 PR993-08）。
  opts: { claim?: () => Promise<boolean> } = {},
): Promise<{ unreplied: number; repliedOpen: number } | 'already'> {
  const { rows, error } = await fetchAllPaged<BacklogContact>(async (offset, limit) => {
    const result = await db.from('contacts').select('id,created_at,name,ticket_status,inquiry_type')
      .in('ticket_status', [...OPEN_STATUSES]).is('resolved_at', null)
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1);
    return { data: result.data, error: result.error };
  }, { failOnTruncation: true });
  if (error) throw new Error('Inquiry backlog lookup failed', { cause: error });

  const evidence: Evidence = { messages: [], replies: [] };
  for (let index = 0; index < rows.length; index += EVIDENCE_CHUNK) {
    const chunk = await readMailReplyEvidence(db, rows.slice(index, index + EVIDENCE_CHUNK).map((row) => row.id));
    evidence.messages.push(...chunk.messages);
    evidence.replies.push(...chunk.replies);
  }

  const items = classifyInquiryBacklog(rows, evidence, now);
  const unreplied = items.filter((item) => item.reason === 'unreplied');
  const repliedOpen = items.filter((item) => item.reason === 'repliedOpen');
  if (items.length > 0) {
    if (opts.claim && !(await opts.claim())) return 'already';
    const take = (list: BacklogItem[]): string[] => {
      let budget = LIST_CHAR_BUDGET;
      const lines: string[] = [];
      for (const item of list.slice(0, LISTED_ITEMS)) {
        // alert.ts が送る前にかける伏せ字処理を先に通し、送る内容そのものの長さで数える（Codex 指摘 PR993-04）
        const line = redactAlertText(formatItem(item));
        const cost = JSON.stringify(line).length + LINE_OVERHEAD;
        if (cost > budget) break;
        budget -= cost;
        lines.push(line);
      }
      return lines;
    };
    const shownUnreplied = take(unreplied);
    const shownRepliedOpen = take(repliedOpen);
    const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://carelink-jp.com';
    alertWarning(`運営宛のお問い合わせに未完了が${items.length}件あります（未返信${unreplied.length}件・返信後${REPLIED_OPEN_DAYS}日以上未完了${repliedOpen.length}件）`, {
      category: '完了未確認',
      // 死活監視の警告（route=/api/cron/cron-heartbeat）と同じ Slack スレッドに混ざらないよう、route を分ける
      // （alert.ts はスレッドを level・route・commit でまとめる・Codex 指摘 PR993-07）
      route: '/api/cron/cron-heartbeat/inquiry-backlog',
      extra: {
        // 案内を先に置く（alert.ts は本文を 1500 文字で切るため、一覧が長くても案内は残る）
        adminUrl: `${base}/admin/inquiries`,
        howToClose: '問い合わせ管理で該当のタブを開き、状態を「解決済み」にすると次回から出ません',
        unreplied: shownUnreplied.length ? shownUnreplied : 'なし',
        repliedOpen: shownRepliedOpen.length ? shownRepliedOpen : 'なし',
        omitted: items.length - shownUnreplied.length - shownRepliedOpen.length,
      },
    });
    // 1件ごとに「解決済みにする」ボタンを付けたメッセージを続けて出す（2026年11月27日 神原さん指示）。
    // 解決済みにするまで毎朝出し続ける（自動では閉じない）。
    await postInquiryResolveButtons(items.map((item) => ({ id: item.id, label: redactAlertText(formatItem(item)) })), `${base}/admin/inquiries`);
  }
  return { unreplied: unreplied.length, repliedOpen: repliedOpen.length };
}
/**
 * Slack 投稿ヘルパー（Phase 7a: Bot Token 経由）
 *
 * 旧来は SLACK_WEBHOOK_URL に直接 fetch していたが、Phase 7 で Bot Token
 * (xoxb-...) + chat.postMessage 経由に切替。
 *
 * 利点:
 *  - 単一トークンで複数チャンネルに投稿可能（チャンネル分けが env だけで完結）
 *  - Block Kit（ボタン・section）対応（Phase 7b で活用）
 *  - thread_ts による会話まとめ対応（Phase 7c で活用）
 *  - 漏洩時のローテが Bot Token 1 つだけで済む
 *
 * env:
 *  - SLACK_BOT_TOKEN: xoxb- で始まる Bot User OAuth Token（必須）
 *  - SLACK_DEFAULT_CHANNEL: 既定の投稿先 channel ID（C01XXXXXXX 形式）または `#name`
 *  - 任意で種別ごとに SLACK_CHANNEL_* 環境変数を追加して channel パラメータで切替可能
 */

import { createServiceRoleClient } from './supabase-server';
import { isTransientSupabaseError } from './err';
import { isPublicReadOnlyPreview } from './preview-capabilities';

const SLACK_API_BASE = 'https://slack.com/api';
// Provider bodies and transport exceptions may contain private data. Only fixed
// operational codes may leave this boundary and reach callers' logs/alerts.

exec
/bin/zsh -lc "node -e 'const fs=require('\\''fs'\\''),ts=require('\\''typescript'\\''),a=require('\\''node:assert/strict'\\''),cache={};function load(n){if(['\\''audit-logger'\\'','\\''supabase-server'\\'','\\''err'\\''].includes(n))return {writeAuditLog:async()=>{}};if(cache[n])return cache[n];const m={exports:{}};new Function('\\''require'\\'','\\''module'\\'','\\''exports'\\'',ts.transpileModule(fs.readFileSync('\\''src/lib/'\\''+n+'\\''.ts'\\'','\\''utf8'\\''),{compilerOptions:{module:1,target:9}}).outputText)(x=>load(x.slice(2)),m,m.exports);return cache[n]=m.exports} (async()=>{const s=load('\\''slack'\\''),q=load('\\''inquiry-slack-actions'\\'');Object.assign(process.env,{SLACK_BOT_TOKEN:'\\''synthetic'\\'',SLACK_DEFAULT_CHANNEL:'\\''synthetic'\\'',VERCEL_ENV:'\\''production'\\''}); let p=[],r=0,l=0,fail=false;global.fetch=async(u,o)=>{if(u.includes('\\''chat.postMessage'\\'')){p.push(JSON.parse(o.body));return fail&&p.length===2?new Response(null,{status:429,headers:{'\\''Retry-After'\\'':'\\''1'\\''}}):Response.json({ok:true})}if(u.includes('\\''users.info'\\'')){l++;return Response.json({ok:true,user:{profile:{email:'\\'' Admin.Example+tag@googlemail.com '\\''}}})}r++;return new Response()};const lines=n=>Array.from({length:n},(_,i)=>({id:String(i),label:'\\''label'\\''}));for(const n of [0,1,20,21,40,41]){p=[];a.equal(await q.postInquiryResolveButtons(lines(n),'\\''https://example.invalid'\\''),n>0);a.ok(p.every(x=>x.blocks.length<=42));a.deepEqual(p.flatMap(x=>x.blocks.flatMap(b=>b.elements??[]).filter(e=>e.action_id==='\\''inquiry_resolve'\\'').map(e=>e.value)),lines(n).map(x=>x.id))}p=[];fail=true;a.equal(await q.postInquiryResolveButtons(lines(41),'\\''https://example.invalid'\\''),false);a.equal(p.length,3);let rpc=0;const db={from(){return this},select(){return this},eq(k,v){a.equal(v,k==='\\''email_canonical'\\''?'\\''adminexample@gmail.com'\\'':true);return this},limit(){return {data:[{id:'\\''admin'\\''}]}},rpc(){rpc++;return {data:{}}}};a.equal(await q.resolveInquiryFromSlack(db,{user:{id:'\\''U'\\''}},'\\''00000000-0000-4000-8000-000000000000'\\''),'\\''resolved'\\'');a.equal(rpc,1);process.env.VERCEL_ENV='\\''preview'\\'';for(const k of [false,true]){if(k)process.env.SUPABASE_SERVICE_ROLE_KEY='\\''synthetic'\\'';else delete process.env.SUPABASE_SERVICE_ROLE_KEY;p=[];r=0;l=0;a.equal(await q.postInquiryResolveButtons(lines(1),'\\''https://example.invalid'\\''),k);await s.getSlackUserEmail('\\''U'\\'');await s.respondToSlackAction('\\''https://hooks.slack.com/example'\\'','\\''test'\\'');a.deepEqual([p.length,l,r],Array(3).fill(+k))}console.log('\\''PASS boundaries, 429, email RPC, Preview guards'\\'')})().catch(e=>{console.error(e);process.exitCode=1})'
git status --short" in /Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940
 succeeded in 24ms:
[inquiry-slack] button post failed: http_429
[inquiry-slack] button post failed: preview_read_only
PASS boundaries, 429, email RPC, Preview guards
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead

codex
**判定：不合格。** CareLink PR #996 の対象コミット `ee83a16a47f1b25d032ca739449fdc60ac864c5c` を、前回の `33f7f333` および `origin/main`（`cabf39d9`）との差分で再検査しました。PR996-02 と PR996-03 の元の不具合は解消しました。PR996-01 は前回の合格基準に照らして未解消で、分割送信では Slack が HTTP 429 を返した場合に一部のボタンが欠落する経路も確認しました。

| ID | 重要度 | 該当箇所 | 期待値 | 実際値・根拠 |
|---|---|---|---|---|
| PR996-01 | 高 | `src/lib/slack.ts:83,215,232`、`src/lib/preview-capabilities.ts:4`、`CLAUDE.md:413–414` | Preview ではボタン付き通知と操作結果を Slack に送信しない。 | **未解消。** 既存の `postToSlack` と同じ判定を使う設計は、サービスロールキーを置かない現行の公開 Preview 運用には妥当です。前回の基準は Preview 全体が対象です。`VERCEL_ENV=preview` で合成のサービスロールキーを設定すると、通知と操作結果の両方がモックの `fetch` に到達し、キーを外すと両方とも抑止されました。現行の運用ルールを根拠に、前回の基準を満たしたとは判定できません。 |
| PR996-02 | 中 | `src/lib/inquiry-slack-actions.ts:91`、`supabase/migrations/20260820000004_salons_profiles_email_canonical.sql:79–87` | Slack のメールを DB の生成列と同じ規則で照合し、一意に一致した運営管理者の操作を受け付ける。 | **解消。** `canonicalizeEmail` を照合前に適用します。`Admin.Example+tag@googlemail.com` が `adminexample@gmail.com` に正規化され、運営管理者が1人一致した場合に解決 RPC が呼ばれることをモックで確認しました。 |
| PR996-03 | 中 | `src/lib/inquiry-slack-actions.ts:47–61`、`src/lib/inquiry-backlog.ts:211` | 20件を超えても、通知対象の全件にボタンが付く。 | **元の打ち切りは解消。** 送信成功条件で0・1・20・21・40・41件を試し、全IDが順序どおり重複なく含まれ、1通あたり最大42ブロックに収まることを確認しました。 |
| PR996-04（新規） | 中 | `src/lib/inquiry-slack-actions.ts:51–61`、`src/lib/slack.ts:103–120`、`src/lib/inquiry-backlog.ts:185,211` | 分割投稿が一時的なレート制限を受けても、該当分を再送できる。 | 41件のうち2通目に HTTP 429 と `Retry-After` を返すと、2通目を再試行せず3通目へ進みます。呼び出し元は送信失敗を示す `false` を使わず、当日の通知枠は取得済みのため、21〜40件目のボタンが当日分から欠落します。この経路はモックで確認しました。実環境での429発生頻度は未計測です。[Slack の投稿レート制限](https://docs.slack.dev/apis/web-api/rate-limits/) |

差分上、既存の文章通知、Slack 署名の先行検証、DB 側の管理者再確認は維持されています。朝の集計に問い合わせを自動で閉じる処理はありません。両差分の `git diff --check` は通過しました。Jest は読み取り専用環境でキャッシュ書き込みに失敗し、テスト開始前に停止しました。実 Slack 送信と応答時間の計測は未実施です。ファイル変更はありません。
68,222
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
