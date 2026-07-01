// テスト全体の前処理（setupFiles 経由でテストフレームワーク読み込み前に評価される）
//
// 既存テストの多くが `process.env.NEXT_PUBLIC_SUPABASE_URL` 等を
// 個別に設定していないため、本番コードの env 必須チェックで throw → 500 期待が崩れていた。
// 安全なダミー値で既定を埋め、テスト内で明示的に上書き/削除する余地は残す。
//
// 【セキュリティ・本番副作用ゼロ化（allowlist 反転）】
// next/jest は jest.config 経由で本番 `.env` を process.env に自動ロードする。
// 旧実装（`=== undefined` ガード＝ブロックリスト方式）では .env の本番値が常に勝ち、
// 本番 RESEND_API_KEY（→実メール送信）/ SUPABASE_SERVICE_ROLE_KEY+本番URL（→実DB書込）
// 等がテスト環境へ流入していた（Slack 誤投稿と同根の実害クラス）。
// 個別 delete（対症）では新規シークレット追加時に漏れるため、
//   (1) ダミーを無条件上書き  (2) 送信系シークレットを delete
//   (3) 未知シークレットをパターンで自動除去
// により「本番資格情報が test env に存在し得ない」構造にする（発症前予防）。

const DEFAULTS = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  SLACK_SIGNING_SECRET: 'test-signing-secret',
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
  // EMAIL_FROM: .env から本番の差出人アドレスが流入するとテストで FROM || フォールバック
  // 右辺が評価されず行23/行13 のブランチカバレッジが取れない。ダミー値で上書きし、
  // 「フォールバックを確認したいテスト」は beforeEach で delete してから実行する。
  EMAIL_FROM: 'Test <test@example.com>',
};

// (1) テスト用ダミーを「無条件」で上書き（.env の本番値より常に優先）。
//     本番 Supabase URL/KEY・Stripe・Anthropic 等は必ずダミーに置換され本番へ到達不能になる。
//     テストが beforeEach 等で設定する自前値は本ファイル評価後に走るため後勝ち（無影響）。
for (const [key, value] of Object.entries(DEFAULTS)) {
  process.env[key] = value;
}

// (2)「キーが存在すれば外部送信する」設計のサービス資格情報は delete し no-op 経路へ倒す。
//     - SLACK_BOT_TOKEN / SLACK_DEFAULT_CHANNEL: postAlert() が早期 return（実 Slack 投稿＆fetch リーク防止）
//     - RESEND_API_KEY: getResend() が null を返し送信スキップ（実メール送信防止）
//     - SUPABASE_DB_PASSWORD / CF_API_KEY / CF_EMAIL: テスト不使用の本番シークレット
//     ダミーではなく delete を選ぶ理由: ダミーは truthy のためガードを抜けて実ネットワーク
//     I/O（leak）が走るため。検証する側のテストは beforeEach で自前ダミーを設定し後勝ち＝無影響。
const EXPLICIT_DELETE = [
  'SLACK_BOT_TOKEN',
  'SLACK_DEFAULT_CHANNEL',
  'RESEND_API_KEY',
  'SUPABASE_DB_PASSWORD',
  'CF_API_KEY',
  'CF_EMAIL',
];
for (const key of EXPLICIT_DELETE) {
  delete process.env[key];
}

// (3) 将来 .env に増えた未知シークレットも自動封鎖（発症前予防）。
//     DEFAULTS にもなく NEXT_PUBLIC_（クライアント公開前提）でもない秘匿パターンのキーを除去。
//     これにより新規シークレットが .env に追加されても、明示対応なしでテスト環境へ漏れない。
const SECRET_KEY_PATTERN = /(_KEY|_SECRET|_TOKEN|_PASSWORD)$/;
const allowedKeys = new Set(Object.keys(DEFAULTS));
for (const key of Object.keys(process.env)) {
  if (key.startsWith('NEXT_PUBLIC_')) continue;
  if (allowedKeys.has(key)) continue;
  if (SECRET_KEY_PATTERN.test(key)) {
    delete process.env[key];
  }
}
