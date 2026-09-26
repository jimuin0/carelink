/**
 * Jest config for contract tests（Phase 2）
 * 実 SaaS staging 到達性テスト専用。
 * `npm run test:contract` で実行。
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest loads this configuration as CommonJS.
const nextJest = require('next/jest');
// dirを渡すとNextが.envを自動読込する。実接続用Contractには明示注入envだけを使う。
const createJestConfig = nextJest();

const config = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.contract.js'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testMatch: ['<rootDir>/tests/contract/**/*.test.{ts,tsx}'],
  // Contract test はカバレッジ対象外（純粋な疎通確認）
  collectCoverage: false,
  testTimeout: 10000,
};

async function jestConfig() {
  const base = await createJestConfig(config)();
  return {
    ...base,
    transformIgnorePatterns: ['/node_modules/(?!(uncrypto|@upstash)/)'],
  };
}

module.exports = jestConfig;
