import { defineConfig, devices } from '@playwright/test';

/**
 * CareLink E2Eテスト設定
 * 実行: npm run test:e2e
 * UI モード: npm run test:e2e:ui
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    // 公開（未認証）導線。admin の setup/spec はここから除外する
    // （認証 storageState が無い状態で admin を開くとログインへリダイレクトされ落ちるため）。
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [/admin\.setup\.ts/, /admin\.spec\.ts/, /booking-complete\.setup\.ts/, /booking-complete\.spec\.ts/],
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 13'] },
      testIgnore: [/admin\.setup\.ts/, /admin\.spec\.ts/, /booking-complete\.setup\.ts/, /booking-complete\.spec\.ts/],
    },
    // オーナー認証の seed＋ログイン（storageState を作る）
    {
      name: 'admin-setup',
      testMatch: /admin\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // 認証済み storageState で admin を検証
    {
      name: 'admin',
      testMatch: /admin\.spec\.ts/,
      dependencies: ['admin-setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/admin.json' },
    },
    // 来院者 予約完走：予約可能な施設を seed（slug をファイル出力）
    {
      name: 'booking-setup',
      testMatch: /booking-complete\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // 匿名で予約フローを完走（seed 後に実行）
    {
      name: 'booking',
      testMatch: /booking-complete\.spec\.ts/,
      dependencies: ['booking-setup'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.CI
    ? {
        command: 'npm run start',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
      }
    : undefined,
});
