# PR #989 signup テストの不安定さの修正

## Claude経由のCodex判定（2026-11-25・対象 2060e26a8c6500d89f74868e87cb16ae0259d367）

```
**判定：保留**
**対象：CareLink PR #989 — `2060e26a8c6500d89f74868e87cb16ae0259d367`**
**比較元：`74a25287`**

差分、原因分析、既存の期待値、関連テストへの影響を独立に確認しました。対象SHAでは、サインアップ画面・強度メーター・強度判定の3スイート57件が、直列と2ワーカー並列でいずれも通過し、`PasswordStrengthMeter` の `act` 警告は出ませんでした。Jestのキャッシュ書き込みは実行時に抑止しました。全件には一時ファイルを作るテストが含まれるため、書き込み禁止の条件下では全件並列を未実行とし、元のタイムアウトの解消は保留とします。

- **原因分析** — 比較元の対象2件では、動的 `import` 完了後の状態更新に由来する `act` 警告を再現しました。辞書の初回評価を送信前に済ませ、メーターの表示更新を待つ修正は、この非同期処理を送信から切り離します。`findByRole('alert')` のタイムアウトは比較元の限定実行では再現せず、全件並列時の原因としてはコードと整合する仮説です。 [PasswordStrengthMeter.tsx](/Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/src/components/PasswordStrengthMeter.tsx:13)
- **テストの主張と影響** — 差分はテストファイル1件です。失敗時のアラート・パスワード・同意・再読み込み保護、再送信成功後の保護解除、LINE遷移と復帰時の保護を引き続き検証しています。テストの削除・skip・既存の期待値の緩和はありません。 [page.test.tsx](/Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/src/app/auth/signup/__tests__/page.test.tsx:102)

**指摘 CL-989-01｜低｜待機時間の不整合**
メーターの `waitFor` には15秒を指定していますが、Jestのテスト全体の上限は10秒です。高負荷で待機が長引くと、メーターの状態を示す `waitFor` の失敗が出る前に、テスト全体がタイムアウトします。設定上の指摘で、今回の実行では発生していません。 [待機処理](/Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/src/app/auth/signup/__tests__/page.test.tsx:79) · [Jest設定](/Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/jest.config.js:46)
```

## 指摘への対応
- CL-989-01：メーター待ちの timeout を 15000→8000ms（Jest の testTimeout 10秒未満）に変更。
- 全件並列の実行（Codex は書込み禁止のため未実行）：Claude が 2060e26a で npm run test:coverage:ci を3回実行し、3回とも 914 スイート合格・Branches 100%・act 警告0。

## Claude経由のCodex再検査判定（2026-11-25・対象 cff6ab57d9867e49632f25a8da53d9b934234441）

```
**判定：保留**
**判定対象SHA** `cff6ab57d9867e49632f25a8da53d9b934234441`（CareLink PR #989）

- **CL-989-01 は解消。** `git diff 2060e26a..cff6ab57` を確認しました。メーターの待機上限は15秒から8秒に短縮され、Jestのテスト上限10秒を下回っています。テストの削除・スキップ・期待値の緩和はありません。 [signup のテスト](/Users/kam/Projects/carelink/.claude/worktrees/fix-signup-flaky-test-be9940/src/app/auth/signup/__tests__/page.test.tsx:77)
- **signup ページのテストは合格。** Node.js 22.23.3 で `npm run test:coverage:ci` を最大4ワーカーで全件1回実行しました。Jestの結果キャッシュで signup スイートの合格を確認しました。`SignupPage` と `PasswordStrengthMeter` の `act` 警告は0件で、全体では他のコンポーネントに93件ありました。
- **全件検査は環境制約により保留。** 914スイート中911合格・3失敗、ブランチカバレッジは100%でした。失敗した3スイートはいずれもローカルソケットを使い、実行環境で `127.0.0.1` の待ち受けが `EPERM` になることを確認しました。

**指摘** 修正を要する新規指摘はありません。`git diff --check` は引き継ぎ文書の引用ブロック内にある行末空白3件を報告しました。
```

- 保留の理由は Codex の sandbox で 127.0.0.1 の待ち受けが EPERM になる3スイートのみ（本修正と無関係）。
- Claude の自己検証：cff6ab57 で npm run test:coverage:ci を実行し 914/914 スイート・19659 件合格、Branches 100%。
