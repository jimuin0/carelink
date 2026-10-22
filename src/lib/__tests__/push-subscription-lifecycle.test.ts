/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
/**
 * 端末の購読を送信前に固定する読み取りと、失効（404/410）した購読の後始末（2026年10月23日）。
 */
const mockMaybeSingle = jest.fn();
const mockDeleteResult = jest.fn();
const deleteFilters: Record<string, unknown>[] = [];
const selectFilters: Record<string, unknown> = {};

jest.mock('../supabase-server', () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      expect(table).toBe('push_subscriptions');
      return {
        select: () => ({ eq: (key: string, value: unknown) => { selectFilters[key] = value; return { maybeSingle: mockMaybeSingle }; } }),
        delete: () => {
          const filters: Record<string, unknown> = {};
          deleteFilters.push(filters);
          const chain = {
            eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
            // 消した行を返させる（一致する行が無かったことを「消せた」と取り違えないため）。
            select: (columns: string) => {
              filters.returning = columns;
              return { then: (done: (v: unknown) => unknown, fail: (e: unknown) => unknown) => mockDeleteResult().then(done, fail) };
            },
          };
          return chain;
        },
      };
    },
  }),
}));

import { isExpiredPushStatus, readUserPushSubscription, removeExpiredPushSubscription } from '../push';

const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/expired', p256dh: 'key', auth: 'auth' };

beforeEach(() => {
  jest.clearAllMocks();
  deleteFilters.length = 0;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

test.each([[404, true], [410, true], [400, false], [401, false], [429, false], [500, false], [null, false]])(
  '失効の判定 status=%s → %s', (status, expired) => {
    expect(isExpiredPushStatus(status)).toBe(expired);
  });

test('利用者の端末の購読を読む（無ければ null）', async () => {
  mockMaybeSingle.mockResolvedValueOnce({ data: SUB, error: null });
  expect(await readUserPushSubscription('user-1')).toEqual(SUB);
  expect(selectFilters).toEqual({ user_id: 'user-1' });
  mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
  expect(await readUserPushSubscription('user-1')).toBeNull();
});

test('読めなかったときは「端末なし」と取り違えず例外にする（まだ何も送っていないので安全に再試行できる）', async () => {
  mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { code: '522' } });
  await expect(readUserPushSubscription('user-1')).rejects.toThrow('PUSH_SUBSCRIPTION_READ_UNAVAILABLE');
});

test('失効した購読だけを消す（同じ利用者・endpoint・鍵が一致する行）', async () => {
  mockDeleteResult.mockResolvedValueOnce({ data: [{ id: 'row-1' }], error: null });
  expect(await removeExpiredPushSubscription('user-1', SUB)).toBe(true);
  expect(deleteFilters).toEqual([{ user_id: 'user-1', endpoint: SUB.endpoint, p256dh: SUB.p256dh, auth: SUB.auth, returning: 'id' }]);
});

test.each([
  ['一致する行が無い（送信の間に別の端末へ登録し直した・既に消えていた）', { data: [], error: null }],
  ['消した行が返らない', { data: null, error: null }],
])('%s → 消せたとは扱わない（false）', async (_label, result) => {
  mockDeleteResult.mockResolvedValueOnce(result);
  expect(await removeExpiredPushSubscription('user-1', SUB)).toBe(false);
});

test('後始末の失敗（エラー応答・例外）は投げずに false', async () => {
  mockDeleteResult.mockResolvedValueOnce({ error: { code: '522' } });
  expect(await removeExpiredPushSubscription('user-1', SUB)).toBe(false);
  mockDeleteResult.mockRejectedValueOnce(new Error('network'));
  await expect(removeExpiredPushSubscription('user-1', SUB)).resolves.toBe(false);
});
