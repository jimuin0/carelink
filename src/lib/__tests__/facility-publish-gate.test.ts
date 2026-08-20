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

// facility_profiles は .select('prefecture, city').eq('id', facilityId).single() で解決する。
function profileChain(data: { prefecture: string | null; city: string | null } | null, error: unknown = null) {
  const obj: Record<string, unknown> = {};
  obj.select = jest.fn(() => obj);
  obj.eq = jest.fn(() => obj);
  obj.single = jest.fn(() => Promise.resolve({ data, error }));
  return obj;
}

function admin(opts: {
  menu?: number | null;
  photo?: number | null;
  staff?: number | null;
  menuErr?: unknown;
  photoErr?: unknown;
  staffErr?: unknown;
  prefecture?: string | null;
  city?: string | null;
  profileErr?: unknown;
}) {
  return {
    from: (table: string) => {
      // ?? だと明示的な null（count=null 経路を検査したいケース）まで既定値の0へ
      // 引き戻ってしまうため、prefecture/city と同様にキーの有無で判定する。
      if (table === 'facility_menus') {
        return countChain('menu' in opts ? (opts.menu as number | null) : 0, opts.menuErr ?? null);
      }
      if (table === 'facility_photos') {
        return countChain('photo' in opts ? (opts.photo as number | null) : 0, opts.photoErr ?? null);
      }
      if (table === 'staff_profiles') {
        return countChain('staff' in opts ? (opts.staff as number | null) : 0, opts.staffErr ?? null);
      }
      if (table === 'facility_profiles') {
        // ?? だと明示的な null（不足を検査したいケース）まで既定値へ引き戻ってしまうため、
        // キーの有無で判定する（'prefecture' in opts）。
        return profileChain(
          {
            prefecture: 'prefecture' in opts ? (opts.prefecture as string | null) : '東京都',
            city: 'city' in opts ? (opts.city as string | null) : '渋谷区',
          },
          opts.profileErr ?? null,
        );
      }
      throw new Error('unexpected table ' + table);
    },
  } as never;
}

test('全て1件以上・prefecture/city も充足 → ready:true', async () => {
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

// count=null（head:true count クエリが null を返す経路）でも `?? 0` で 0 扱いになり不足と判定される。
// このゲート単体のテストスイート（src/lib/__tests__ のみ）で ?? の両分岐を自己完結させるため、
// 呼び出し側（admin/settings・admin/chain）のテストに coverage を依存させない。
test('menu.count が null → ?? 0 で不足扱い', async () => {
  const { readiness } = await checkPublishReadiness(admin({ menu: null, photo: 1, staff: 1 }), 'f1');
  expect(readiness.missing).toContain('メニューを1つ以上登録してください');
});

test('photo.count が null → ?? 0 で不足扱い', async () => {
  const { readiness } = await checkPublishReadiness(admin({ menu: 1, photo: null, staff: 1 }), 'f1');
  expect(readiness.missing).toContain('写真を1枚以上登録してください');
});

test('staff.count が null → ?? 0 で不足扱い', async () => {
  const { readiness } = await checkPublishReadiness(admin({ menu: 1, photo: 1, staff: null }), 'f1');
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

// ─── prefecture / city（2026年8月20日追加）─────────────────────────────────
// 公開＝「検索で見つかる状態にする」こと。地域が空の施設は /search の地域絞り込みに
// 一切出てこない＝公開の意味を満たさないため、メニュー/写真/スタッフと同種の必須条件にする。

test('(v) prefecture が空 → 公開できず、メッセージに含まれる', async () => {
  const { readiness, error } = await checkPublishReadiness(admin({ menu: 1, photo: 1, staff: 1, prefecture: null }), 'f1');
  expect(error).toBeNull();
  expect(readiness.ready).toBe(false);
  expect(readiness.missing).toContain('都道府県を設定してください');
});

test('(vi) city が空 → 公開できず、メッセージに含まれる', async () => {
  const { readiness, error } = await checkPublishReadiness(admin({ menu: 1, photo: 1, staff: 1, city: null }), 'f1');
  expect(error).toBeNull();
  expect(readiness.ready).toBe(false);
  expect(readiness.missing).toContain('市区町村を設定してください');
});

test('(vii) 4条件すべて（メニュー/写真/スタッフ/prefecture・city）揃えば公開できる', async () => {
  const { readiness, error } = await checkPublishReadiness(
    admin({ menu: 2, photo: 3, staff: 1, prefecture: '大阪府', city: '大阪市北区' }),
    'f1',
  );
  expect(error).toBeNull();
  expect(readiness).toEqual({ ready: true, missing: [] });
});

test('profile.error → error 返却（?? の4番目）', async () => {
  const { error, readiness } = await checkPublishReadiness(
    admin({ menu: 1, photo: 1, staff: 1, profileErr: { message: 'pf' } }),
    'f1',
  );
  expect(error).toEqual({ message: 'pf' });
  expect(readiness.ready).toBe(false);
});

test('profile.data が null（行が見つからない）→ prefecture/city 不足として扱う', async () => {
  const customAdmin = {
    from: (table: string) => {
      if (table === 'facility_menus') return countChain(1);
      if (table === 'facility_photos') return countChain(1);
      if (table === 'staff_profiles') return countChain(1);
      if (table === 'facility_profiles') return profileChain(null, null);
      throw new Error('unexpected table ' + table);
    },
  } as never;
  const { readiness, error } = await checkPublishReadiness(customAdmin, 'f1');
  expect(error).toBeNull();
  expect(readiness.ready).toBe(false);
  expect(readiness.missing).toContain('都道府県を設定してください');
  expect(readiness.missing).toContain('市区町村を設定してください');
});
