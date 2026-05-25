// テスト全体の前処理（setupFiles 経由でテストフレームワーク読み込み前に評価される）
//
// 既存テストの多くが `process.env.NEXT_PUBLIC_SUPABASE_URL` 等を
// 個別に設定していないため、本番コードの env 必須チェックで throw → 500 期待が崩れていた。
// 安全なダミー値で既定を埋め、テスト内で明示的に上書き/削除する余地は残す。

const DEFAULTS = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/TEST/TEST/TEST',
  CRON_SECRET: 'test-cron-secret',
  STRIPE_SECRET_KEY: 'sk_test_dummy',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_dummy',
  RESEND_API_KEY: 're_test_dummy',
  RESEND_FROM_EMAIL: 'test@example.com',
  LINE_CHANNEL_ID: 'test-line-channel-id',
  LINE_CHANNEL_SECRET: 'test-line-channel-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'test-line-access-token',
  LIFF_ID: 'test-liff-id',
  ANTHROPIC_API_KEY: 'sk-ant-test-dummy',
  VAPID_PUBLIC_KEY: 'test-vapid-public',
  VAPID_PRIVATE_KEY: 'test-vapid-private',
  VAPID_SUBJECT: 'mailto:test@example.com',
  GOOGLE_MAPS_API_KEY: 'test-google-maps-key',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  ADMIN_COOKIE_SECRET: 'test-admin-cookie-' + 'x'.repeat(20),
  RECAPTCHA_SECRET_KEY: 'test-recaptcha-secret',
  NEXT_PUBLIC_RECAPTCHA_SITE_KEY: 'test-recaptcha-site-key',
};

for (const [key, value] of Object.entries(DEFAULTS)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}
