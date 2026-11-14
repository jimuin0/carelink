/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { adminForbidden, adminUnauthenticated } from '../admin-denial';
test('未ログインは 401、権限なしは 403', async () => {
  const a = adminUnauthenticated();
  expect(a.status).toBe(401); expect(await a.json()).toEqual({ error: 'ログインしてください' });
  const f = adminForbidden({ headers: { 'Cache-Control': 'no-store' } });
  expect(f.status).toBe(403); expect(await f.json()).toEqual({ error: '権限がありません' });
  expect(f.headers.get('cache-control')).toBe('no-store');
});
