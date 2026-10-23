/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * プロフィール写真は推測できない名前で保存し、前の写真（本人のフォルダの中だけ）を消す（2026年10月23日）。
 * 以前は avatars/<アカウントID>/avatar.<拡張子> に上書きしており、アカウント ID から写真の URL が分かった。
 */
import { AVATAR_BUCKET, AvatarUploadError, avatarObjectPath, ownAvatarPathFromUrl, removeAllAvatars, uploadAvatar } from '../avatar-upload';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const RANDOM = '33333333-3333-4333-8333-333333333333';
const BASE = 'https://example.supabase.co/storage/v1/object/public/avatars';

describe('avatarObjectPath', () => {
  test.each([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']])('%s は本人のフォルダの乱数名.%s', (mime, ext) => {
    expect(avatarObjectPath(USER, mime, RANDOM)).toBe(`${USER}/${RANDOM}.${ext}`);
  });
  test.each(['image/svg+xml', 'text/html', '', 'toString'])('%p は受け付けない（ファイル名の拡張子は信用しない）', (mime) => {
    expect(avatarObjectPath(USER, mime, RANDOM)).toBeNull();
  });
});

describe('ownAvatarPathFromUrl', () => {
  test('本人のフォルダの写真はパスを返す（旧形式・新形式・キャッシュ避けのクエリ付き）', () => {
    expect(ownAvatarPathFromUrl(`${BASE}/${USER}/avatar.jpg?t=1700000000000`, USER)).toBe(`${USER}/avatar.jpg`);
    expect(ownAvatarPathFromUrl(`${BASE}/${USER}/${RANDOM}.webp`, USER)).toBe(`${USER}/${RANDOM}.webp`);
    expect(ownAvatarPathFromUrl(`${BASE}/${USER}/a%20b.png#x`, USER)).toBe(`${USER}/a b.png`);
  });
  test.each([
    [null], [undefined], [''],
    ['https://profile.line-scdn.net/abc'],
    [`${BASE}/${OTHER}/avatar.jpg`],
    [`https://example.supabase.co/storage/v1/object/public/review-photos/${USER}/avatar.jpg`],
    [`${BASE}/${USER}`],
    [`${BASE}/${USER}/nested/avatar.jpg`],
    [`${BASE}/${USER}/%E0%A4%A.jpg`],
  ])('%p は消さない', (url) => {
    expect(ownAvatarPathFromUrl(url, USER)).toBeNull();
  });
});

function fakeSupabase(opts: { uploadError?: unknown; updateError?: unknown; removeThrows?: boolean } = {}) {
  const upload = jest.fn(async () => ({ error: opts.uploadError ?? null }));
  const remove = jest.fn(async () => {
    if (opts.removeThrows) throw new Error('network');
    return { data: [], error: null };
  });
  const getPublicUrl = jest.fn((path: string) => ({ data: { publicUrl: `${BASE}/${path}` } }));
  const eq = jest.fn(async () => ({ error: opts.updateError ?? null }));
  const update = jest.fn(() => ({ eq }));
  const storageFrom = jest.fn(() => ({ upload, remove, getPublicUrl }));
  const from = jest.fn(() => ({ update }));
  return { client: { storage: { from: storageFrom }, from } as never, upload, remove, update, eq, storageFrom, from };
}
const file = (type = 'image/png') => new File([new Uint8Array([1, 2, 3])], 'me.php', { type });

describe('uploadAvatar', () => {
  test('乱数名で新規に保存し（上書きしない）、avatar_url を更新して、前の写真を消す', async () => {
    const s = fakeSupabase();
    const url = await uploadAvatar(s.client, USER, file(), `${BASE}/${USER}/avatar.jpg?t=1`, RANDOM);
    expect(url).toBe(`${BASE}/${USER}/${RANDOM}.png`);
    expect(s.storageFrom).toHaveBeenCalledWith(AVATAR_BUCKET);
    expect(s.upload).toHaveBeenCalledWith(`${USER}/${RANDOM}.png`, expect.any(File), { upsert: false, contentType: 'image/png' });
    expect(s.from).toHaveBeenCalledWith('profiles');
    expect(s.update).toHaveBeenCalledWith({ avatar_url: url });
    expect(s.eq).toHaveBeenCalledWith('id', USER);
    expect(s.remove).toHaveBeenCalledWith([`${USER}/avatar.jpg`]);
  });

  test('前の写真が本人のフォルダの外（LINE の画像など）・無いときは何も消さない', async () => {
    for (const previous of [null, 'https://profile.line-scdn.net/abc', `${BASE}/${OTHER}/avatar.jpg`]) {
      const s = fakeSupabase();
      await uploadAvatar(s.client, USER, file(), previous, RANDOM);
      expect(s.remove).not.toHaveBeenCalled();
    }
  });

  test('前の写真が今回と同じパスなら消さない', async () => {
    const s = fakeSupabase();
    await uploadAvatar(s.client, USER, file(), `${BASE}/${USER}/${RANDOM}.png`, RANDOM);
    expect(s.remove).not.toHaveBeenCalled();
  });

  test('前の写真を消せなくても写真の変更は成功のまま', async () => {
    const s = fakeSupabase({ removeThrows: true });
    await expect(uploadAvatar(s.client, USER, file(), `${BASE}/${USER}/avatar.jpg`, RANDOM)).resolves.toBe(`${BASE}/${USER}/${RANDOM}.png`);
  });

  test('受け付けない形式は保存しない', async () => {
    const s = fakeSupabase();
    await expect(uploadAvatar(s.client, USER, file('image/svg+xml'), null, RANDOM)).rejects.toBeInstanceOf(AvatarUploadError);
    expect(s.upload).not.toHaveBeenCalled();
  });

  test('保存に失敗したらプロフィールを変えない', async () => {
    const s = fakeSupabase({ uploadError: { message: 'denied' } });
    await expect(uploadAvatar(s.client, USER, file(), null, RANDOM)).rejects.toEqual({ message: 'denied' });
    expect(s.update).not.toHaveBeenCalled();
  });

  test('プロフィールを更新できなければ今回の写真を消し、前の写真は残す', async () => {
    for (const removeThrows of [false, true]) {
      const s = fakeSupabase({ updateError: { message: 'rls' }, removeThrows });
      await expect(uploadAvatar(s.client, USER, file(), `${BASE}/${USER}/avatar.jpg`, RANDOM)).rejects.toEqual({ message: 'rls' });
      expect(s.remove).toHaveBeenCalledTimes(1);
      expect(s.remove).toHaveBeenCalledWith([`${USER}/${RANDOM}.png`]);
    }
  });

  test('乱数を渡さなければ crypto.randomUUID を使う', async () => {
    const s = fakeSupabase();
    const url = await uploadAvatar(s.client, USER, file('image/jpeg'), null);
    expect(url).toMatch(new RegExp(`^${BASE}/${USER}/[0-9a-f-]{36}\\.jpg$`));
  });
});

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
