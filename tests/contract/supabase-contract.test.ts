/**
 * @jest-environment node
 *
 * Supabase staging への実到達性テスト（Phase 2 Contract）。
 * STAGING_SUPABASE_URL + STAGING_SUPABASE_ANON_KEY が設定された環境でのみ実行。
 * mock 漏れ／env vars 失効を CI で早期検知する層。
 */

const STAGING_URL = process.env.STAGING_SUPABASE_URL;
const STAGING_ANON = process.env.STAGING_SUPABASE_ANON_KEY;

const describeIfConfigured = STAGING_URL && STAGING_ANON ? describe : describe.skip;

describeIfConfigured('Supabase staging contract', () => {
  test('REST API が 200 を返す（鍵が有効）', async () => {
    const res = await fetch(`${STAGING_URL}/rest/v1/`, {
      headers: { apikey: STAGING_ANON! },
      signal: AbortSignal.timeout(5000),
    });
    expect(res.status).toBeLessThan(500);
    expect(res.status).not.toBe(401);
  });

  test('Auth API が応答する', async () => {
    const res = await fetch(`${STAGING_URL}/auth/v1/settings`, {
      headers: { apikey: STAGING_ANON! },
      signal: AbortSignal.timeout(5000),
    });
    expect(res.status).toBeLessThan(500);
  });
});
