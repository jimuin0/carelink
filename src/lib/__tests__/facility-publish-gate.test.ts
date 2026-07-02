/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * checkPublishReadiness の網羅テスト（単一公開/一括公開で共有する公開ゲート）。
 */

import { checkPublishReadiness } from '../facility-publish-gate';

// facility_menus は .select().eq().or()、facility_photos は .select().eq()、
// staff_profiles は .select().eq().eq() で count を解決する thenable。
function countChain(count: number | null, error: unknown = null) {
  const obj: Record<string, unknown> = {};
  obj.select = jest.fn(() => obj);
  obj.eq = jest.fn(() => obj);
  obj.or = jest.fn(() => obj);
  obj.then = (resolve: (v: { count: number | null; error: unknown }) => unknown) =>
    resolve({ count, error });
  return obj;
}

function admin(opts: { menu?: number | null; photo?: number | null; staff?: number | null; menuErr?: unknown; photoErr?: unknown; staffErr?: unknown }) {
  return {
    from: (table: string) => {
      if (table === 'facility_menus') return countChain(opts.menu ?? 0, opts.menuErr ?? null);
      if (table === 'facility_photos') return countChain(opts.photo ?? 0, opts.photoErr ?? null);
      if (table === 'staff_profiles') return countChain(opts.staff ?? 0, opts.staffErr ?? null);
      throw new Error('unexpected table ' + table);
    },
  } as never;
}

test('全て1件以上 → ready:true', async () => {
  const { readiness, error } = await checkPublishReadiness(admin({ menu: 1, photo: 1, staff: 1 }), 'f1');
  expect(error).toBeNull();
  expect(readiness).toEqual({ ready: true, missing: [] });
});

test('メニュー0 → メニュー不足', async () => {
  const { readiness } = await checkPublishReadiness(admin({ menu: 0, photo: 1, staff: 1 }), 'f1');
  expect(readiness.ready).toBe(false);
  expect(readiness.missing).toContain('メニューを1つ以上登録してください');
});

test('写真0 → 写真不足', async () => {
  const { readiness } = await checkPublishReadiness(admin({ menu: 1, photo: 0, staff: 1 }), 'f1');
  expect(readiness.missing).toContain('写真を1枚以上登録してください');
});

test('スタッフ0 → スタッフ不足', async () => {
  const { readiness } = await checkPublishReadiness(admin({ menu: 1, photo: 1, staff: 0 }), 'f1');
  expect(readiness.missing).toContain('スタッフを1人以上登録してください');
});

test('menu.error → error 返却', async () => {
  const { readiness, error } = await checkPublishReadiness(admin({ menuErr: { message: 'm' }, photo: 1, staff: 1 }), 'f1');
  expect(error).toEqual({ message: 'm' });
  expect(readiness.ready).toBe(false);
});

test('photo.error → error 返却（?? の2番目）', async () => {
  const { error } = await checkPublishReadiness(admin({ menu: 1, photoErr: { message: 'p' }, staff: 1 }), 'f1');
  expect(error).toEqual({ message: 'p' });
});

test('staff.error → error 返却（?? の3番目）', async () => {
  const { error } = await checkPublishReadiness(admin({ menu: 1, photo: 1, staffErr: { message: 's' } }), 'f1');
  expect(error).toEqual({ message: 's' });
});
