// 来院者が施設をお気に入り登録できることを実行証明する（トグル＝aria-label 変化＋DB 書き込み）。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。visitor-favorite.setup の storageState を使う。
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { VISITOR_FAVORITE_FACILITY_FILE } from './visitor-favorite.fixtures';

test('来院者が施設をお気に入り登録できる', async ({ page, baseURL }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const local = (value: string) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);
  if (!url || !key || !baseURL || !local(url) || !local(baseURL)) throw new Error('Isolated favorite fixture required');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { slug } = JSON.parse(fs.readFileSync(VISITOR_FAVORITE_FACILITY_FILE, 'utf8')) as { slug: string };
  await page.goto(`/facility/${slug}`);

  // 初期は未登録（aria-label「お気に入りに追加」）。クリックで POST /api/favorites → 登録。
  const addBtn = page.getByRole('button', { name: 'お気に入りに追加' });
  await expect(addBtn).toBeVisible({ timeout: 15000 });
  const [added] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/favorites' && response.request().method() === 'POST'),
    addBtn.click(),
  ]);
  expect(added.status()).toBe(200);
  expect((await added.json()).isFavorited).toBe(true);

  // 登録成功＝aria-label が「お気に入りから削除」に変わる（favorites に1行 INSERT・サーバ応答で確定）。
  await expect(page.getByRole('button', { name: 'お気に入りから削除' })).toBeVisible({ timeout: 15000 });

  const facility = await db.from('facility_profiles').select('id').eq('slug', slug).single();
  expect(facility.error).toBeNull();
  const facilityId = facility.data!.id;
  // Same authenticated actor, two independent overlapping HTTP requests.
  const responses = await Promise.all([1, 2].map(() => page.request.post('/api/favorites', {
    headers: { Origin: new URL(baseURL).origin }, data: { facilityId },
  })));
  for (const response of responses) expect(response.status()).toBe(200);
  const states = await Promise.all(responses.map(async response => (await response.json()).isFavorited));
  expect(states.sort()).toEqual([false, true]);
  const rows = await db.from('favorites').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId);
  expect(rows.error).toBeNull(); expect(rows.count).toBe(1);
  for (const desired of [true, false, true]) {
    const repeated = await Promise.all([1, 2].map(() => page.request.post('/api/favorites', {
      headers: { Origin: new URL(baseURL).origin }, data: { facilityId, isFavorited: desired },
    })));
    for (const response of repeated) {
      expect(response.status()).toBe(200); expect((await response.json()).isFavorited).toBe(desired);
    }
    const actual = await db.from('favorites').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId);
    expect(actual.error).toBeNull(); expect(actual.count).toBe(desired ? 1 : 0);
  }
  await page.reload();
  await expect(page.getByRole('button', { name: 'お気に入りから削除' })).toBeVisible();
});

// 施設ページの閲覧はブラウザ → POST /api/facilities/[id]/view → service_role RPC で記録される。
// 本番では累積・時系列とも 0 件のままで、訪問が無いのか経路が壊れているのか区別できなかったため、
// 実ブラウザで経路そのものを固定する。IP を専用にして他のテストの閲覧と混ざらないようにする。
test('施設ページの閲覧が一度だけ記録され、同じ閲覧者の再送は数えない', async ({ page, baseURL }, info) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const local = (value: string) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);
  if (!url || !key || !baseURL || !local(url) || !local(baseURL)) throw new Error('Isolated page-view fixture required');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { slug } = JSON.parse(fs.readFileSync(VISITOR_FAVORITE_FACILITY_FILE, 'utf8')) as { slug: string };
  const facility = await db.from('facility_profiles').select('id').eq('slug', slug).single();
  expect(facility.error).toBeNull();
  const facilityId = facility.data!.id as string;
  const count = async () => {
    const rows = await db.from('facility_page_views').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId);
    expect(rows.error).toBeNull();
    return rows.count ?? 0;
  };
  await page.setExtraHTTPHeaders({ 'x-real-ip': `198.51.100.${40 + info.retry}` });
  const before = await count();

  const [viewed] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === `/api/facilities/${facilityId}/view`
      && response.request().method() === 'POST'),
    page.goto(`/facility/${slug}`),
  ]);
  expect(viewed.status()).toBe(204);
  await expect.poll(count).toBe(before + 1);

  const repeated = await page.request.post(`/api/facilities/${facilityId}/view`, {
    headers: { Origin: new URL(baseURL).origin, 'x-real-ip': `198.51.100.${40 + info.retry}` },
  });
  expect(repeated.status()).toBe(204);
  expect(await count()).toBe(before + 1);
});
