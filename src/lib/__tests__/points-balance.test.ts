/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { readPointsBalance } from '../points-balance';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database-overrides';

test.each([0, -25, 20001, Number.MAX_SAFE_INTEGER])('returns the aggregate %s without a capped table query', async data => {
  const rpc = jest.fn().mockResolvedValue({ data, error: null });
  const client = { rpc } as unknown as SupabaseClient<Database>;
  await expect(readPointsBalance(client, 'verified-owner')).resolves.toBe(data);
  expect(rpc).toHaveBeenCalledWith('get_user_points_balance', { p_user_id: 'verified-owner' });
});
test.each([null, undefined, '100', 1.25, Infinity, Number.MAX_SAFE_INTEGER + 1])('invalid aggregate %# is unavailable, not zero', async data => {
  const client = { rpc: jest.fn().mockResolvedValue({ data, error: null }) } as unknown as SupabaseClient<Database>;
  await expect(readPointsBalance(client, 'owner')).rejects.toThrow('POINTS_BALANCE_UNAVAILABLE');
});
test('DB error with populated data still cannot authorize a balance', async () => {
  const client = { rpc: jest.fn().mockResolvedValue({ data: 100, error: { message: 'fixture failure' } }) } as unknown as SupabaseClient<Database>;
  await expect(readPointsBalance(client, 'owner')).rejects.toThrow('POINTS_BALANCE_UNAVAILABLE');
});
test('transport rejection remains an error', async () => {
  const client = { rpc: jest.fn().mockRejectedValue(new Error('fixture transport')) } as unknown as SupabaseClient<Database>;
  await expect(readPointsBalance(client, 'owner')).rejects.toThrow('fixture transport');
});
