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
      testIgnore: [/admin\.setup\.ts/, /admin\.spec\.ts/, /booking-complete\.setup\.ts/, /booking-complete\.spec\.ts/, /visitor-cancel\.setup\.ts/, /visitor-cancel\.spec\.ts/, /owner-cancel\.setup\.ts/, /owner-cancel\.spec\.ts/, /visitor-change\.setup\.ts/, /visitor-change\.spec\.ts/, /intake\.setup\.ts/, /intake\.spec\.ts/, /admin-batch\.setup\.ts/, /admin-settings\.spec\.ts/, /admin-packages\.spec\.ts/, /visitor-favorite\.setup\.ts/, /visitor-favorite\.spec\.ts/],
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 13'] },
      testIgnore: [/admin\.setup\.ts/, /admin\.spec\.ts/, /booking-complete\.setup\.ts/, /booking-complete\.spec\.ts/, /visitor-cancel\.setup\.ts/, /visitor-cancel\.spec\.ts/, /owner-cancel\.setup\.ts/, /owner-cancel\.spec\.ts/, /visitor-change\.setup\.ts/, /visitor-change\.spec\.ts/, /intake\.setup\.ts/, /intake\.spec\.ts/, /admin-batch\.setup\.ts/, /admin-settings\.spec\.ts/, /admin-packages\.spec\.ts/, /visitor-favorite\.setup\.ts/, /visitor-favorite\.spec\.ts/],
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
    // 来院者キャンセル：来院者＋本人予約を seed＋ログイン（storageState）
    {
      name: 'visitor-setup',
      testMatch: /visitor-cancel\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // 認証済み storageState で来院者キャンセルを検証
    {
      name: 'visitor',
      testMatch: /visitor-cancel\.spec\.ts/,
      dependencies: ['visitor-setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/visitor.json' },
    },
    // オーナーのキャンセル／無断キャンセル：オーナー＋キャンセル対象予約を seed＋ログイン（storageState）
    {
      name: 'owner-cancel-setup',
      testMatch: /owner-cancel\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // 認証済み storageState でオーナーのステータス変更（キャンセル／無断キャンセル）を検証
    {
      name: 'owner-cancel',
      testMatch: /owner-cancel\.spec\.ts/,
      dependencies: ['owner-cancel-setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/owner-cancel.json' },
    },
    // 来院者の予約日時変更：予約可能施設＋来院者＋変更可能な予約を seed＋ログイン（storageState）
    {
      name: 'visitor-change-setup',
      testMatch: /visitor-change\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // 認証済み storageState で来院者の予約日時変更を検証
    {
      name: 'visitor-change',
      testMatch: /visitor-change\.spec\.ts/,
      dependencies: ['visitor-change-setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/visitor-change.json' },
    },
    // 問診（ゲスト）：公開施設＋有効な問診テンプレートを seed（slug をファイル出力）
    {
      name: 'intake-setup',
      testMatch: /intake\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // 認証なし（ゲスト）で問診票送信を検証（seed 後に実行）
    {
      name: 'intake',
      testMatch: /intake\.spec\.ts/,
      dependencies: ['intake-setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    // オーナー設定保存／パッケージ作成：オーナー＋施設を seed＋ログイン（storageState を共有）
    {
      name: 'admin-batch-setup',
      testMatch: /admin-batch\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // 認証済み storageState でオーナーの店舗設定保存を検証
    {
      name: 'admin-settings',
      testMatch: /admin-settings\.spec\.ts/,
      dependencies: ['admin-batch-setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/admin-batch.json' },
    },
    // 認証済み storageState でオーナーのパッケージ作成を検証
    {
      name: 'admin-packages',
      testMatch: /admin-packages\.spec\.ts/,
      dependencies: ['admin-batch-setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/admin-batch.json' },
    },
    // 来院者お気に入り：公開施設＋来院者を seed＋ログイン（storageState）
    {
      name: 'visitor-favorite-setup',
      testMatch: /visitor-favorite\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // 認証済み storageState で来院者のお気に入りトグルを検証
    {
      name: 'visitor-favorite',
      testMatch: /visitor-favorite\.spec\.ts/,
      dependencies: ['visitor-favorite-setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/visitor-favorite.json' },
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
