import { resolveLineUserIdForUser } from '../line-link';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 【監査C2】LINE 連携の単一ソース（profiles.line_user_id）解決ヘルパーの単体テスト。
 * 旧 line_user_links.user_id は常に NULL で送信が無音失効していたため、profiles を
 * 正として引くことと、null のグレースフル処理を branches 100% で固定する。
 */

function singleClient(resolved: { data: unknown }): SupabaseClient {
  const maybeSingle = jest.fn().mockResolvedValue(resolved);
  const eq = jest.fn(() => ({ maybeSingle }));
  const select = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select }));
  return { from } as unknown as SupabaseClient;
}

describe('resolveLineUserIdForUser', () => {
  test('profiles に line_user_id があれば返す', async () => {
    const client = singleClient({ data: { line_user_id: 'U_abc' } });
    expect(await resolveLineUserIdForUser(client, 'user-1')).toBe('U_abc');
    expect(client.from).toHaveBeenCalledWith('profiles');
  });

  test('行はあるが line_user_id が null → null', async () => {
    const client = singleClient({ data: { line_user_id: null } });
    expect(await resolveLineUserIdForUser(client, 'user-1')).toBeNull();
  });

  test('行が無い（data=null）→ null', async () => {
    const client = singleClient({ data: null });
    expect(await resolveLineUserIdForUser(client, 'user-1')).toBeNull();
  });
});
