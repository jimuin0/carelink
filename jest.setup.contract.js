// Contract configは.envを読まない。CI等が明示注入したSupabase接続情報だけを保持する。
// unit側のsecret遮断を緩めず、他の本番資格情報は従来のsanitizerに委ねる。
const keys = ['STAGING_SUPABASE_URL', 'STAGING_SUPABASE_ANON_KEY', 'STAGING_SUPABASE_SERVICE_ROLE_KEY'];
const supplied = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Sanitizer must complete synchronously before restoring explicit inputs.
require('./jest.setup.js');
for (const key of keys) {
  if (supplied[key] !== undefined) process.env[key] = supplied[key];
  else delete process.env[key];
}
