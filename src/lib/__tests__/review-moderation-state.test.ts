/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 運営の審査から見た口コミの状態（2026年10月23日）。
 * 以前の店舗画面は status だけで『公開中』を出しており、審査待ち・運営が却下した口コミも『公開中』に見え、
 * 『公開する』を押すと成功と出るのに公開されなかった。公開ページと評価は is_flagged = false だけを数える。
 */
import { readReviewModeration, reviewModeration, type ModerationQueueRow } from '../review-moderation-state';
import type { createServiceRoleClient } from '../supabase-server';

const row = (status: string, created_at: string, content_id = 'r1'): ModerationQueueRow => ({ content_id, status, created_at });

describe('reviewModeration', () => {
  test('旗が立っていなければ審査の行に関係なく none', () => {
    expect(reviewModeration(false, [row('rejected', '2026-10-01T00:00:00Z')])).toBe('none');
  });

  test.each(['pending', 'escalated'])('未決（%s）の審査があれば運営の確認中', (status) => {
    expect(reviewModeration(true, [row('rejected', '2026-10-01T00:00:00Z'), row(status, '2026-09-01T00:00:00Z')])).toBe('pending');
  });

  test('最新の審査が却下なら運営判断で非公開', () => {
    expect(reviewModeration(true, [row('approved', '2026-09-01T00:00:00Z'), row('rejected', '2026-10-01T00:00:00Z')])).toBe('rejected');
  });

  test('最新の審査が承認なのに旗が立っている（審査の行が無い再フラグ）は確認中として扱い、公開させない', () => {
    expect(reviewModeration(true, [row('rejected', '2026-09-01T00:00:00Z'), row('approved', '2026-10-01T00:00:00Z')])).toBe('pending');
  });

  test('審査の行が 1 つも無い旗も確認中（公開されていない理由が運営側にある）', () => {
    expect(reviewModeration(true, [])).toBe('pending');
  });

  test('is_flagged が NULL の口コミは公開ビューに出ないので、止められている側に倒す', () => {
    expect(reviewModeration(null, [])).toBe('pending');
  });
});

describe('readReviewModeration', () => {
  function client(result: { data: unknown; error: unknown }) {
    const calls: unknown[][] = [];
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    for (const name of ['select', 'eq']) chain[name] = (...args: unknown[]) => { calls.push([name, ...args]); return chain; };
    chain.in = (...args: unknown[]) => { calls.push(['in', ...args]); return Promise.resolve(result); };
    const from = jest.fn(() => chain);
    return { db: { from } as unknown as ReturnType<typeof createServiceRoleClient>, from, calls };
  }

  test('旗の立っていない口コミだけなら審査の表を読まずに none を返す', async () => {
    const { db, from } = client({ data: [], error: null });
    const result = await readReviewModeration(db, [{ id: 'a', is_flagged: false }, { id: 'b', is_flagged: false }]);
    expect(result).toEqual({ states: ['none', 'none'], error: null });
    expect(from).not.toHaveBeenCalled();
  });

  test('旗の立った口コミだけを口コミ種別で読み、入力と同じ順に状態を返す', async () => {
    const { db, from, calls } = client({
      data: [row('pending', '2026-10-01T00:00:00Z', 'b'), row('rejected', '2026-10-02T00:00:00Z', 'c')],
      error: null,
    });
    const result = await readReviewModeration(db, [
      { id: 'a', is_flagged: false }, { id: 'b', is_flagged: true }, { id: 'c', is_flagged: true },
    ]);
    expect(result).toEqual({ states: ['none', 'pending', 'rejected'], error: null });
    expect(from).toHaveBeenCalledWith('moderation_queue');
    expect(calls).toEqual([
      ['select', 'content_id, status, created_at'],
      ['eq', 'content_type', 'review'],
      ['in', 'content_id', ['b', 'c']],
    ]);
  });

  test('審査の表を読めなければ error を返し、状態を推測しない', async () => {
    const failure = { message: 'synthetic' };
    const { db } = client({ data: null, error: failure });
    expect(await readReviewModeration(db, [{ id: 'b', is_flagged: true }])).toEqual({ states: [], error: failure });
  });

  test('応答の形が違っても error を返す', async () => {
    const { db } = client({ data: null, error: null });
    const result = await readReviewModeration(db, [{ id: 'b', is_flagged: true }]);
    expect(result.states).toEqual([]);
    expect(result.error).toEqual(new Error('MODERATION_STATE_UNCONFIRMED'));
  });
});
