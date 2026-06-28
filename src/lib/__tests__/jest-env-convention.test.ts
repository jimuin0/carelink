// L4（Stryker ミューテーション）の dry run 破壊を発症前に防ぐ構造ガード。
//
// 背景（事実）：Stryker は jest.stryker-lib.config.js の testMatch で
//   src/lib/__tests__ 配下の全テストを coverageAnalysis:'perTest' で実行する。
//   このとき個別ファイルの docblock で素の node 環境（jest 標準の node）を指定すると、
//   グローバルの Stryker mixin 環境を上書きしてしまい、変異前の dry run で
//   「Missing coverage results」となって初期テスト実行ごと失敗する＝全 mutate ジョブが
//   一斉に落ちる。
//
// 規約：src/lib/__tests__ で node 環境が必要なテストは、必ず mixin 形
//   （@stryker-mutator/jest-runner/jest-env/node）を docblock に指定する。
//   素の node 指定は禁止。本テストはこの規約違反を通常の Unit Tests CI で即 fail させ、
//   L4 へ伝播する前に止める（症状ブロックでなく発症前予防）。
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(__dirname);

// 素の node 環境指定（mixin でない）を検出する。docblock 行が "node" で終わる場合のみ一致。
// 文字列連結で組み立て、本ファイル自身の prose に検出対象リテラルを残さない。
const ENV_PRAGMA = '@jest-' + 'environment';
const PLAIN_NODE_ENV = new RegExp(ENV_PRAGMA + '\\s+node\\s*$', 'm');

describe('src/lib/__tests__ の jest 環境 docblock 規約', () => {
  const files = readdirSync(TEST_DIR).filter((f) => f.endsWith('.test.ts'));

  it('テストファイルを検出できている（ガード自身の空振り防止）', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s は素の node 環境指定を使っていない', (file) => {
    const content = readFileSync(join(TEST_DIR, file), 'utf8');
    expect(PLAIN_NODE_ENV.test(content)).toBe(false);
  });
});
