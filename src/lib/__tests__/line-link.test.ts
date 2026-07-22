import { resolveLineUserIdForUser, resolveLineUserIdsForUsers } from '../line-link';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 【監査C2】LINE 連携の単一ソース（profiles.line_user_id）解決ヘルパーの単体テスト。
 * 旧 line_user_links.user_id は常に NULL で送信が無音失効していたため、profiles を
 * 正として引くことと、null/複数のグレースフル処理を branches 100% で固定する。
 */

function singleClient(resolved: { data: unknown }): SupabaseClient {
  const maybeSingle = jest.fn().mockResolvedValue(resolved);
  const eq = jest.fn(() => ({ maybeSingle }));
  const select = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select }));
  return { from } as unknown as SupabaseClient;
}

function inClient(resolved: { data: unknown }): { client: SupabaseClient; inSpy: jest.Mock } {
  const inSpy = jest.fn().mockResolvedValue(resolved);
  const select = jest.fn(() => ({ in: inSpy }));
  const from = jest.fn(() => ({ select }));
  return { client: { from } as unknown as SupabaseClient, inSpy };
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

describe('resolveLineUserIdsForUsers', () => {
  test('空配列 → 即空 Map（クエリを発行しない）', async () => {
    const { client, inSpy } = inClient({ data: [] });
    const map = await resolveLineUserIdsForUsers(client, []);
    expect(map.size).toBe(0);
    expect(inSpy).not.toHaveBeenCalled();
  });

  test('line_user_id 非 NULL のみを Map に含める', async () => {
    const { client } = inClient({
      data: [
        { id: 'u1', line_user_id: 'U1' },
        { id: 'u2', line_user_id: null },
        { id: 'u3', line_user_id: 'U3' },
      ],
    });
    const map = await resolveLineUserIdsForUsers(client, ['u1', 'u2', 'u3']);
    expect(map.get('u1')).toBe('U1');
    expect(map.has('u2')).toBe(false);
    expect(map.get('u3')).toBe('U3');
    expect(map.size).toBe(2);
  });

  test('data が null（取得失敗）→ 空 Map', async () => {
    const { client } = inClient({ data: null });
    const map = await resolveLineUserIdsForUsers(client, ['u1']);
    expect(map.size).toBe(0);
  });
});
