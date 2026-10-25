/**
 * @jest-environment node
 *
 * 設定されたSupabaseへの実到達性テスト（CIでは隔離local、任意で外部staging）。
 * STAGING_SUPABASE_URL + STAGING_SUPABASE_ANON_KEY が設定された環境でのみ実行。
 * mock 漏れ／env vars 失効を CI で早期検知する層。
 */

const STAGING_URL = process.env.STAGING_SUPABASE_URL;
const STAGING_ANON = process.env.STAGING_SUPABASE_ANON_KEY;

if (!STAGING_URL || !STAGING_ANON) throw new Error('Explicit Supabase URL and anon credentials required');

if (new globalThis.URL(STAGING_URL!).hostname === 'xzafxiupbflvgbarrihe.supabase.co') throw new Error('Production target is forbidden for contract execution');

describe('Supabase configured API contract', () => {
  test.each([
    ['facility_symptoms', 'symptom_id,description,symptoms(name,slug,category)'],
    ['facility_certifications', 'certification_name,license_number,staff_name,sort_order'],
  ])('公開施設の %s は管理用秘密鍵なしで投影・JOINできる', async (table, columns) => {
    const url = new URL(`/rest/v1/${table}`, STAGING_URL);
    url.searchParams.set('select', columns);
    url.searchParams.set('limit', '0');
    const response = await fetch(url, {
      headers: { apikey: STAGING_ANON!, Authorization: `Bearer ${STAGING_ANON!}` },
      signal: AbortSignal.timeout(5000),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  test('公開ViewのREST読み取りが200と空配列を返す（limit=0）', async () => {
    // OpenAPI全schema生成ではなく、SDKと同じ認証で実際の読み取り経路を検証する。
    // limit=0なので実レコードは取得しない。RLS/tenant分離の証明とは区別する。
    const res = await fetch(`${STAGING_URL}/rest/v1/public_reviews?select=id&limit=0`, {
      headers: { apikey: STAGING_ANON!, Authorization: `Bearer ${STAGING_ANON!}` },
      signal: AbortSignal.timeout(5000),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test('Auth API が応答する', async () => {
    const res = await fetch(`${STAGING_URL}/auth/v1/settings`, {
      headers: { apikey: STAGING_ANON! },
      signal: AbortSignal.timeout(5000),
    });
    expect(res.status).toBe(200);
  });
});
