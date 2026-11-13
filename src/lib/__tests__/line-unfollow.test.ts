import { isFollowingLink, isLineRecipientUnfollowed } from '../line-unfollow';

function client(result: { data: unknown; error: unknown }) {
  const calls: unknown[][] = [];
  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  for (const name of ['select', 'eq', 'not']) chain[name] = (...a: unknown[]) => { calls.push([name, ...a]); return chain; };
  chain.limit = (...a: unknown[]) => { calls.push(['limit', ...a]); return Promise.resolve(result); };
  const from = jest.fn(() => chain);
  return { db: { from } as never, from, calls };
}

describe('isLineRecipientUnfollowed（B3-12）', () => {
  test('unfollowed_at のある行があれば true（宛先から外す）', async () => {
    const c = client({ data: [{ id: 'x' }], error: null });
    await expect(isLineRecipientUnfollowed(c.db, 'U1')).resolves.toBe(true);
    expect(c.from).toHaveBeenCalledWith('line_user_links');
    expect(c.calls).toEqual([['select', 'id'], ['eq', 'line_user_id', 'U1'], ['not', 'unfollowed_at', 'is', null], ['limit', 1]]);
  });
  test('該当行が無ければ false（空配列・null とも）', async () => {
    await expect(isLineRecipientUnfollowed(client({ data: [], error: null }).db, 'U1')).resolves.toBe(false);
    await expect(isLineRecipientUnfollowed(client({ data: null, error: null }).db, 'U1')).resolves.toBe(false);
  });
  test('DB を読めなければ例外（送る／送らないのどちらにも黙って倒さない）', async () => {
    await expect(isLineRecipientUnfollowed(client({ data: null, error: { message: 'down' } }).db, 'U1')).rejects.toThrow('LINE follow state unavailable');
  });
});

describe('isFollowingLink', () => {
  test.each([
    [null, true], [undefined, true], [{}, true], [{ unfollowed_at: null }, true],
    [{ unfollowed_at: '2026-11-13T00:00:00Z' }, false],
  ])('%p → %p', (link, expected) => {
    expect(isFollowingLink(link as never)).toBe(expected);
  });
});
