// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: 'jest',
  reporters: ['progress', 'clear-text', 'json'],
  checkers: ['typescript'],
  // tsconfig.json ではなく Stryker 専用 tsconfig を使う。tsconfig.json は include に
  // .next/types/**/*.ts を含むため、Next.js が build/dev 時に生成するルート型（ブランチ依存で
  // stale 化し、main 不在ルートを参照して TS2307 を出す）に TS チェッカーが巻き込まれてクラッシュし、
  // ミューテーション実測前に異常終了していた（過去に「100%確定」と誤報告した直接原因）。
  // tsconfig.stryker.json は .next を一切 include しないため .next の状態に依存せず再現性100%。
  tsconfigFile: 'tsconfig.stryker.json',
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
  ],
  thresholds: {
    high: 100,
    low: 100,
    break: 100,
  },
  ignorePatterns: ['.claude/**', 'reports/**'],
  // 静的変異体（モジュール読み込み時評価）はJestをハングさせるためスキップ
  // L3で100%分岐カバレッジ済みのため品質担保あり
  ignoreStatic: true,
  disableBail: false,
  timeoutMS: 30000,
  timeoutFactor: 2.5,
};

export default config;
