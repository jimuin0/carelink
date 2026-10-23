/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 退会したアカウントのプロフィール写真を、本人のフォルダごと消す（2026年10月23日）。
 */
import { AVATAR_BUCKET } from '../avatar-upload';
import { removeAllAvatars } from '../avatar-retirement';

const USER = '11111111-1111-4111-8111-111111111111';
const RANDOM = '33333333-3333-4333-8333-333333333333';

describe('removeAllAvatars（退会時に本人のフォルダの写真を消す）', () => {
  type ListResult = { data: unknown; error: unknown };
  function storage(list: ListResult | Error, removeError: unknown = null) {
    const remove = jest.fn(async () => ({ data: null, error: removeError }));
    const listFn = jest.fn(async () => { if (list instanceof Error) throw list; return list; });
    const from = jest.fn(() => ({ list: listFn, remove }));
    return { client: { storage: { from } } as unknown as Parameters<typeof removeAllAvatars>[0], from, list: listFn, remove };
  }
  test('本人のフォルダの全ファイルを消す（旧形式・新形式とも）', async () => {
    const s = storage({ data: [{ name: 'avatar.jpg' }, { name: `${RANDOM}.webp` }], error: null });
    await expect(removeAllAvatars(s.client, USER)).resolves.toBe(true);
    expect(s.from).toHaveBeenCalledWith(AVATAR_BUCKET);
    expect(s.list).toHaveBeenCalledWith(USER, { limit: 1000 });
    expect(s.remove).toHaveBeenCalledWith([`${USER}/avatar.jpg`, `${USER}/${RANDOM}.webp`]);
  });
  test('写真が無ければ何も消さずに成功', async () => {
    const s = storage({ data: [], error: null });
    await expect(removeAllAvatars(s.client, USER)).resolves.toBe(true);
    expect(s.remove).not.toHaveBeenCalled();
  });
  test.each([
    ['一覧の失敗', { data: null, error: { message: 'list failed' } }],
    ['一覧が配列でない', { data: null, error: null }],
  ])('%s は false（消したことにしない）', async (_label, list) => {
    const s = storage(list);
    await expect(removeAllAvatars(s.client, USER)).resolves.toBe(false);
    expect(s.remove).not.toHaveBeenCalled();
  });
  test('削除の失敗は false', async () => {
    const s = storage({ data: [{ name: 'avatar.jpg' }], error: null }, { message: 'remove failed' });
    await expect(removeAllAvatars(s.client, USER)).resolves.toBe(false);
  });
  test('例外も false（投げない）', async () => {
    const s = storage(new Error('network'));
    await expect(removeAllAvatars(s.client, USER)).resolves.toBe(false);
  });
});
