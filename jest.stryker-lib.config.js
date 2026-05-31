// Stryker専用 Jest コンフィグ
// - src/lib/__tests__/ のみを対象にする（API routeテスト等を除外）
// - testEnvironment を @stryker-mutator/jest-runner/jest-env/node に設定
//   → coverageAnalysis:'perTest' で @jest-environment node テストのカバレッジが正しく報告される
const baseConfig = require('./jest.config.js');

async function jestConfig() {
  const base = typeof baseConfig === 'function' ? await baseConfig() : baseConfig;
  return {
    ...base,
    // デフォルトはjsdom wrapper（node環境が必要なテストは個別に @jest-environment @stryker-mutator/jest-runner/jest-env/node を指定済み）
    testEnvironment: '@stryker-mutator/jest-runner/jest-env/jsdom',
    testMatch: ['<rootDir>/src/lib/__tests__/**/*.test.ts'],
  };
}

module.exports = jestConfig;
