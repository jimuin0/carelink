// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: 'jest',
  reporters: ['progress', 'clear-text', 'json'],
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  jest: {
    // src/lib/__tests__/ のみ実行・testEnvironment が @stryker-mutator/jest-runner/jest-env/node の専用コンフィグ
    configFile: 'jest.stryker-lib.config.js',
    enableFindRelatedTests: false,
  },
  // 'perTest': 変異体ごとに対象テストのみ実行（最速）
  // jest.stryker-lib.config.js で全テストが Stryker ノード環境を使うため @jest-environment node 競合なし
  coverageAnalysis: 'perTest',
  // mutate はエージェントが個別に上書きする
  mutate: [
    'src/lib/i18n.ts',
    'src/lib/seo-constants.ts',
    'src/lib/seo-snippets.ts',
    'src/lib/constants.ts',
    'src/lib/safe.ts',
    'src/lib/image-utils.ts',
    'src/lib/jobs.ts',
    'src/lib/validations.ts',
    'src/lib/validations-booking.ts',
    'src/lib/validations-auth.ts',
    'src/lib/db-fallback.ts',
  ],
  thresholds: {
    high: 100,
    low: 100,
    break: 100,
  },
  ignorePatterns: ['.claude/**', 'reports/**', '.stryker-tmp/**', '.next/**', 'test-results/**', 'playwright-report/**'],
  // 静的変異体（モジュール読み込み時評価）はJestをハングさせるためスキップ
  // L3で100%分岐カバレッジ済みのため品質担保あり
  ignoreStatic: true,
  disableBail: false,
  timeoutMS: 30000,
  timeoutFactor: 2.5,
};

export default config;
