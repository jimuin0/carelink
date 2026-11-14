# ESLint 用 minimatch 3 互換アダプタ

この非公開パッケージは CareLink 側のコードで、minimatch の改名版ではない。
ルートの `minimatch` として入り、npm の override が `minimatch@<4` の要求をすべてここへ向ける。
中身は、修正済みの `minimatch@11.0.3` の照合関数を CommonJS のモジュールそのものとして公開するだけ。
この関数は `Minimatch`・`filter`・`match`・`braceExpand`・`defaults`・`escape`・`unescape`・`sep`・`GLOBSTAR` を持っており、
ESLint 9 とそのプラグインが minimatch 3 に対して使う呼び方と同じ形になる。

## 置いた理由

[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)（2026年10月30日公開）は
minimatch 11.0.1 未満をすべて脆弱としており、3.x・9.x・10.x 系には修正版が出ていない。
3.x 系には問題の `optimizationLevel` の処理自体が無いが、npm audit は版で判定するため、
元の 3.1.5 を入れたままでは変更していない `npm audit --audit-level=moderate` の検査を通らない。
脆弱性情報の除外はしていない。

## 確認した呼び出し元（2026年10月31日）

- ESLint 本体・`@eslint/config-array`・`@eslint/eslintrc`：`new Minimatch(pattern, options).match(path[, partial])`。
  オプションは `dot`・`matchBase`・`flipNegate`・`allowWindowsEscape`。部分一致（partial）は `{ dot: true }` と正規化した相対パスでだけ使う。
- Next の ESLint プラグイン群（`import`・`jsx-a11y`・`react`）：関数の形で呼ぶ。minimatch を使う規則は CareLink では1つも有効になっていない。

`makeRe` は minimatch 11 に無いので、ここでは例外を投げる。呼ぶのは `import/no-internal-modules` だけ。
この規則を有効にする、minimatch 3 の正規表現出力に頼る呼び出しを足す、ESLint を上げる、のいずれかをするときはこのアダプタを見直すこと。

## 照合結果の固定

`fixtures/minimatch-3.1.5.json` は、元の minimatch 3.1.5 で `fixtures/generate.cjs` を実行して作った。
対象は、`src` の Lint 中に ESLint が実際に使った 25 通りのパターンとオプションに、プラグインのオプションと境界の形を足したもの。
単体テスト（`src/__tests__/minimatch-v3-adapter.test.ts`）は、関数呼び出し・全体一致・部分一致のすべてで同じ結果を求める。
例外は、minimatch 11 が部分一致の判定を正した 22 件で、`dot` なしの部分一致と `./`・`..` を含むパスに限られ、ESLint の使い方では起きない。
試験はこの 22 件を列挙して固定し、minimatch 3 を要求する各部品がこのパッケージに解決されることも確かめる。

ESLint とそのプラグインが修正済みの minimatch を使うようになるか、3.x 系に修正版が出たら、このパッケージを外す。
