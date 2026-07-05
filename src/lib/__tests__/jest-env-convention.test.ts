// L4（Stryker ミューテーション）の dry run 破壊を発症前に防ぐ構造ガード。
//
// 背景（事実）：Stryker は jest.stryker-lib.config.js の testMatch で
//   src/lib/__tests__ 配下の全テストを coverageAnalysis:'perTest' で実行する。
//   このとき個別ファイルの docblock で素の環境（jest 標準の node/jsdom/jsdom-sixteen）を
//   指定すると、グローバルの Stryker mixin 環境を上書きしてしまい、変異前の dry run で
//   「Missing coverage results」となって初期テスト実行ごと失敗する＝全 mutate ジョブが
//   一斉に落ちる。
//
// 規約：src/lib/__tests__ で node/jsdom 環境が必要なテストは、必ず mixin 形
//   （@stryker-mutator/jest-runner/jest-env/node|jsdom|jsdom-sixteen）を docblock に指定する。
//   素の指定は禁止。本テストはこの規約違反を通常の Unit Tests CI で即 fail させ、
//   L4 へ伝播する前に止める（症状ブロックでなく発症前予防）。
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(__dirname);

// 素の環境指定（mixin でない）を検出する。docblock 行が node/jsdom/jsdom-sixteen で
// 終わる場合のみ一致。文字列連結で組み立て、本ファイル自身の prose に検出対象リテラルを残さない。
//
// 監査(2026年7月4日・L4 weekly実行): recaptcha-client.test.ts が `@jest-environment jsdom`
// （素の指定）のまま長期間放置され、Stryker dry run が「Missing coverage results」で
// 毎週クラッシュしていた。従来のガードは node のみを検査し jsdom/jsdom-sixteen を見逃す
// 穴があったため、本番で実際にこの穴を突く形で再発した。node 以外の環境名も網羅する。
const ENV_PRAGMA = '@jest-' + 'environment';
const PLAIN_ENV = new RegExp(ENV_PRAGMA + '\\s+(node|jsdom|jsdom-sixteen)\\s*$', 'm');

describe('src/lib/__tests__ の jest 環境 docblock 規約', () => {
  const files = readdirSync(TEST_DIR).filter((f) => f.endsWith('.test.ts'));

  it('テストファイルを検出できている（ガード自身の空振り防止）', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s は素の node/jsdom 環境指定を使っていない', (file) => {
    const content = readFileSync(join(TEST_DIR, file), 'utf8');
    expect(PLAIN_ENV.test(content)).toBe(false);
  });
});
