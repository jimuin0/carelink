# minimatch・glob・follow-redirects の脆弱性対応（2026年10月31日）

PR #879 の Security Audit（`npm audit --audit-level=moderate`）が、PR の変更とは関係なく失敗した。
原因は、main の CI が最後に通った 2026年10月30日 13:20 UTC より後に公開された次の3件。
main と他の PR も、次に CI を回すと同じ理由で落ちる状態だった。

| 脆弱性情報 | 公開（UTC） | 深刻度 | 該当 | 修正版 | 本番依存 |
|---|---|---|---|---|---|
| [GHSA-mrwp-f3q8-3g9p](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p) | 10/30 22:59 | high | follow-redirects 1.16.0〜1.16.1 | 1.16.2 | あり（`@line/liff` → `@line/bot-sdk` → axios） |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | 10/30 23:09 | moderate | minimatch 11.0.1 未満 | 11.0.1 | なし（ESLint・Jest・Stryker・typescript-eslint） |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | 10/30 23:09 | moderate | glob 9.0.0〜14.0.1 | 14.0.2 | なし（Jest） |

監査は 37 件（moderate 36・high 1）と出たが、実体は上の3部品で、残りはそれを経由して依存する親部品の数え上げ。
本番での悪用や、HTTP の入力がこれらのパターン照合へ届く経路は確認していない。

## 変更

`package.json` の overrides と、ルートの開発依存1つだけを変えた。アプリのコード・監査コマンド・必須検査は変えていない。

- `follow-redirects`：`^1.16.2`
- `minimatch@>=4 <11.0.1`：`^11.0.3`（Stryker 10.2.5・typescript-estree 10.2.6・glob の 9.0.9。名前付き公開の使い方は同じ）
- `glob`：`^14.0.3`（Jest の reporters・jest-config・jest-runtime が使う `glob.sync` は 14 にも残っている）
- `test-exclude@<7`：`^7.0.2`（Jest のカバレッジ判定。6 は glob 7 と minimatch 3 を使っていた。`TestExclude` の使い方は同じ）
- `minimatch@<4`：`$minimatch`＝`tools/minimatch-v3-compat`（下記）

minimatch 3.x 系には修正版が無く、ESLint 9・`@eslint/config-array`・`@eslint/eslintrc`・Next のプラグイン群（`import`・`jsx-a11y`・`react`）が 3.x を要求する。
3.x 系には問題の `optimizationLevel` の処理自体が無いが、npm audit は版で判定する。
そこで braces（[記録](braces-dependency-remediation-20261003.md)）と同じく、元の部品を残さずに独立した CareLink のコードで受けた。
`tools/minimatch-v3-compat` は、修正済み minimatch 11.0.3 の照合関数を minimatch 3 の CommonJS の呼び方で公開するだけのパッケージで、版を偽っていない（パッケージ名 `@carelink/minimatch-v3-compat`・版 1.0.0）。
minimatch 11 で無くなった `makeRe` は例外を投げる。呼ぶのは `import/no-internal-modules` だけで、CareLink では有効になっていない。

## 確認したこと（ローカル）

変更前の依存のまま基準を取り、変更後と比べた。

- `npm ci` 後の `npm audit --audit-level=moderate` は 0 件。
- **Lint**：実行中に minimatch 3.1.5 へ渡されたすべての呼び出し（重複を除き 37,973 件・25 通りのパターンとオプション・部分一致 598 件）を記録した。
  変更後に同じ方法で記録すると、違いは新しく足した試験ファイル1つ分（18 件）だけで、既存の 1,671 ファイルの呼び出しと結果は完全に一致した。指摘は変更前後とも 0 件。
- **部分一致の差**：minimatch 11 は部分一致の判定を正しており、3.1.5 と 22 件で結果が違う。
  どれも `dot` なしの部分一致か、`./`・`..` を含むパスの場合だけで、ESLint の部分一致は `{ dot: true }` と正規化した相対パスでしか呼ばれない（記録した 598 件で確認）。
  単体テストはこの 22 件を列挙して固定している。
- **Stryker**：ファイルの取り込み処理（除外ルールの照合と巡回）を写した比較で、minimatch 10.2.5 と 11.0.3 の結果は完全に一致した（取り込み 3,197 件・変異対象 10 件）。
- **単体テスト**：`npm run test:coverage:ci -- --runInBand` の結果は PR に記載する。計測対象のファイル一覧とカバレッジは変更前と比べた。
- Lint・`npm run lint:debt`（React Compiler 負債 0 件）・`npx tsc --noEmit` はエラー 0。CI の node 試験 28 件も通過。
- 既存の `minimatch-dependency-compatibility.test.ts`（全 minimatch を CommonJS と ESM の両方で読み込む）も通過。

試験 `src/__tests__/minimatch-v3-adapter.test.ts` は次を CI で固定する。
3.x を要求する各部品が代替部品に解決されること、lock に 11.0.1 未満の minimatch が無いこと、3.1.5 の照合結果の再現、`makeRe` の明示的な失敗、`import/no-internal-modules` が無効であること。
わざと3通りに壊すと、どれも試験で落ちることを確かめた。

これらのローカルの結果は、最終コミットでの CI（クリーンインストール・ビルド・カバレッジ・契約検査・E2E）と配信後の確認の代わりにはならない。
週次の Stryker（L4）の結果は通常の CI とは別の証拠として扱う。本番の設定・DB・実データ・通知には触れていない。

## 外すとき

ESLint とそのプラグインが修正済みの minimatch を使うようになるか、3.x 系に修正版が出たら、`tools/minimatch-v3-compat` と `minimatch@<4` の override を外す。
glob・test-exclude・minimatch 10 系の override は、Jest・Stryker・typescript-eslint が修正版を直接要求するようになった時点で外す。
