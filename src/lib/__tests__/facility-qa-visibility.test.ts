/**
 * 施設ページの Q&A タブを出すかどうか（神原さん判断 2026年10月23日：公開中の Q&A が 0 件ならタブを出さない）。
 */
import { hasPublicQa } from '../facility-qa-visibility';
import { createServerSupabaseClient } from '../supabase-server';

jest.mock('../supabase-server', () => ({ createServerSupabaseClient: jest.fn() }));

function mockQuery(result: { data: unknown; error: unknown }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq']) {
    chain[method] = (...args: unknown[]) => { calls.push({ method, args }); return chain; };
  }
  chain.limit = (...args: unknown[]) => { calls.push({ method: 'limit', args }); return Promise.resolve(result); };
  const from = jest.fn(() => chain);
  (createServerSupabaseClient as jest.Mock).mockReturnValue({ from });
  return { from, calls };
}

test('公開中（回答済み・公開）の Q&A だけを、id 1 行に絞って確かめる', async () => {
  const { from, calls } = mockQuery({ data: [{ id: 'qa-1' }], error: null });
  await expect(hasPublicQa('fac-1')).resolves.toBe(true);
  expect(from).toHaveBeenCalledWith('facility_qa');
  expect(calls).toEqual([
    { method: 'select', args: ['id'] },
    { method: 'eq', args: ['facility_id', 'fac-1'] },
    { method: 'eq', args: ['status', 'answered'] },
    { method: 'eq', args: ['is_public', true] },
    { method: 'limit', args: [1] },
  ]);
});

test('0 件なら false', async () => {
  mockQuery({ data: [], error: null });
  await expect(hasPublicQa('fac-1')).resolves.toBe(false);
});

test('data が null でも false（例外にしない）', async () => {
  mockQuery({ data: null, error: null });
  await expect(hasPublicQa('fac-1')).resolves.toBe(false);
});

test('読み取りに失敗したら例外（呼び出し側が通知してタブを出す側に倒す）', async () => {
  mockQuery({ data: null, error: { message: 'permission denied' } });
  await expect(hasPublicQa('fac-1')).rejects.toThrow('facility_qa visibility lookup failed: permission denied');
});
