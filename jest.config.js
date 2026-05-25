const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.{ts,tsx}',
    '<rootDir>/src/**/*.{test,spec}.{ts,tsx}',
  ],
  collectCoverageFrom: [
    'src/lib/**/*.ts',
    'src/app/api/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 75,
      branches: 70,
      statements: 80,
    },
  },
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  // テストタイムアウト: 10秒（デフォルト5秒から延長）
  testTimeout: 10000,
};

// nextJest overwrites transformIgnorePatterns; merge it here
async function jestConfig() {
  const base = await createJestConfig(config)();
  return {
    ...base,
    transformIgnorePatterns: [
      '/node_modules/(?!(uncrypto)/)',
    ],
  };
}

module.exports = jestConfig;
