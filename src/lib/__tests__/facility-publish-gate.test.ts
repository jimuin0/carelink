/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * checkPublishReadiness の網羅テスト（単一公開/一括公開で共有する公開ゲート）。
 */

import { checkBookingReadiness as checkPublishReadiness, checkPublishReadiness as checkListingReadiness, isPublishedLocationConflict } from '../facility-publish-gate';

test.each([null, undefined, false, '23514', {}, { code: '23514' },
  { code: '23514', message: null }, { code: '23514', message: 'another_constraint' },
  { code: '23505', message: '"published_facility_location_present"' },
])('unrelated or malformed DB error remains a server error: %p', (value) => {
  expect(isPublishedLocationConflict(value)).toBe(false);
});
test('identifies only the named location CHECK violation', () => {
  expect(isPublishedLocationConflict({ code: '23514', message: 'new row violates check constraint "published_facility_location_present"' })).toBe(true);
});

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
function profileChain(data: { prefecture: string | null; city: string | null; address: string | null; name?: string; status?: string; business_hours?: unknown; catch_copy?: string | null; description?: string | null } | null, error: unknown = null) {
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
  address?: string | null;
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
            name: "合成店舗", status: "published", business_hours: { mon: { open: "10:00", close: "18:00" }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
            prefecture: 'prefecture' in opts ? (opts.prefecture as string | null) : '東京都',
            city: 'city' in opts ? (opts.city as string | null) : '渋谷区',
            address: 'address' in opts ? (opts.address as string | null) : '検証町1-1',
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

test.each([null, '', '  ', '\u3000\t'])('住所が %p の下書きは公開できない', async (address) => {
  const { readiness, error } = await checkPublishReadiness(admin({ menu: 1, photo: 1, staff: 1, address }), 'f1');
  expect(error).toBeNull();
  expect(readiness).toEqual({ ready: false, missing: ['住所を設定してください'] });
});

test.each(['prefecture', 'city'] as const)('空白のみの %s は地域の入力として扱わない', async (field) => {
  const { readiness } = await checkPublishReadiness(admin({ menu: 1, photo: 1, staff: 1, [field]: '\u3000 ' }), 'f1');
  expect(readiness.ready).toBe(false);
  expect(readiness.missing).toEqual([field === 'prefecture' ? '都道府県を設定してください' : '市区町村を設定してください']);
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

describe('掲載だけの公開条件', () => {
  test('メニュー・写真・スタッフなしでも所在地があれば掲載できる', async () => {
    const from = jest.fn(() => profileChain({ name: '合成店舗', prefecture: '東京都', city: '検証区', address: '検証町1-1' }));
    const result = await checkListingReadiness({ from } as never, 'f1');
    expect(result).toEqual({ readiness: { ready: true, missing: [] }, error: null });
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('facility_profiles');
  });
  test('DB失敗は未入力扱いに変換しない', async () => {
    const result = await checkListingReadiness({ from: () => profileChain(null, { message: 'unavailable' }) } as never, 'f1');
    expect(result.error).toEqual({ message: 'unavailable' });
    expect(result.readiness).toEqual({ ready: false, missing: [] });
  });
  test.each([null, { name: ' ', prefecture: null, city: '', address: '\u3000' }])('欠損はすべて不足として返す：%p', async (data) => {
    const result = await checkListingReadiness({ from: () => profileChain(data) } as never, 'f1');
    expect(result.error).toBeNull();
    expect(result.readiness.missing).toEqual(['施設名を設定してください', '都道府県を設定してください', '市区町村を設定してください', '住所を設定してください']);
  });

  // 最後の砦: /admin/settings は保存時に弾くが、/register の PR 文（取り込み後は施設紹介）は
  // 設定画面を経ずに入るため、検査されないまま公開できた。
  const located = { name: '合成店舗', prefecture: '東京都', city: '検証区', address: '検証町1-1' };
  test('公開時にキャッチコピーと施設紹介も医療広告の表現を検査する', async () => {
    const chain = profileChain({ ...located, catch_copy: '技術力No.1', description: '施術で必ず治る' });
    const result = await checkListingReadiness({ from: () => chain } as never, 'f1');
    expect(chain.select).toHaveBeenCalledWith('name, prefecture, city, address, catch_copy, description');
    expect(result.error).toBeNull();
    expect(result.readiness).toEqual({ ready: false, missing: [
      'キャッチコピー：「No.1」 は使用できません。他との比較優良を示す表現は医療広告ガイドラインで禁止されています（客観的根拠があっても広告では使えません）',
      '施設紹介：「必ず治る」 は使用できません。治療効果を保証する表現は医療広告ガイドラインで禁止されています',
    ] });
  });
  test.each([
    [{ catch_copy: '日本一' }, 'キャッチコピー：'],
    [{ description: '副作用なしの施術' }, '施設紹介：'],
  ])('どちらか一方だけでも公開を止める：%p', async (texts, label) => {
    const result = await checkListingReadiness({ from: () => profileChain({ ...located, ...texts }) } as never, 'f1');
    expect(result.readiness.ready).toBe(false);
    expect(result.readiness.missing).toHaveLength(1);
    expect(result.readiness.missing[0].startsWith(label)).toBe(true);
  });
  test('問題の無い PR 文言・未入力は公開を止めない', async () => {
    for (const texts of [{ catch_copy: '駅チカ3分', description: '丁寧なカウンセリング' }, { catch_copy: null, description: null }]) {
      const result = await checkListingReadiness({ from: () => profileChain({ ...located, ...texts }) } as never, 'f1');
      expect(result.readiness).toEqual({ ready: true, missing: [] });
    }
  });
});

test('掲載済みでも営業時間未確認ならネット予約は準備中', async () => {
  const base = admin({ menu: 1, photo: 1, staff: 1 });
  const client = { from: (table: string) => table === 'facility_profiles'
    ? profileChain({ name: '合成店舗', status: 'published', prefecture: '東京都', city: '検証区', address: '検証町1-1', business_hours: null })
    : (base as unknown as { from: (t: string) => unknown }).from(table) };
  const result = await checkPublishReadiness(client as never, 'f1');
  expect(result.readiness.missing).toEqual(['全曜日の営業時間・定休日を確認して保存してください']);
});

describe('isCardBookingReady (search card 「予約OK」 badge)', () => {
  const { isCardBookingReady, bookingReadinessMissing } = jest.requireActual('../facility-publish-gate');
  const hours = { sun: null, mon: { open: '09:00', close: '18:00' }, tue: { open: '09:00', close: '18:00' },
    wed: { open: '09:00', close: '18:00' }, thu: null, fri: { open: '09:00', close: '18:00' }, sat: { open: '09:00', close: '18:00' } };
  const ready = { name: '合成院', prefecture: '大阪府', city: '豊中市', business_hours: hours, photo_count: 1,
    booking_menu_count: 2, active_staff_count: 1, has_address: true };

  test('a card that satisfies the booking rule is advertised', () => {
    expect(isCardBookingReady(ready)).toBe(true);
  });

  test.each([
    ['no photo (the production case that showed 予約OK but refused booking)', { photo_count: 0 }],
    ['no published menu', { booking_menu_count: 0 }],
    ['no active staff', { active_staff_count: 0 }],
    ['no address', { has_address: false }],
    ['unconfirmed hours', { business_hours: { mon: { open: '09:00', close: '18:00' } } }],
    ['blank name', { name: ' ' }],
  ])('%s is not advertised', (_label, override) => {
    expect(isCardBookingReady({ ...ready, ...override })).toBe(false);
  });

  test.each(['booking_menu_count', 'active_staff_count', 'has_address'])(
    'a card source without %s fails closed instead of advertising booking', (key) => {
      expect(isCardBookingReady({ ...ready, [key]: undefined })).toBe(false);
      expect(isCardBookingReady({ ...ready, [key]: null })).toBe(false);
    });

  test('the badge and the booking page share one rule', () => {
    expect(bookingReadinessMissing({ name: '合成院', prefecture: '大阪府', city: '豊中市', hasAddress: true,
      status: 'published', businessHours: hours, menuCount: 2, photoCount: 0, staffCount: 1 }))
      .toEqual(['写真を1枚以上登録してください']);
  });
});

describe('画面の入力にも同じ公開規則を使う（listingPublishMissing）', () => {
  const { listingPublishMissing, listingLocationMissing, bookingReadinessChecks } = jest.requireActual('../facility-publish-gate');

  test('保存前の入力値で、サーバーの公開ゲートと同じ項目・同じ文言を返す', async () => {
    const values = { name: '合成店舗', prefecture: '', city: ' ', address: null, catch_copy: '日本一', description: null };
    const server = await checkListingReadiness({ from: () => profileChain(values) } as never, 'f1');
    expect(listingPublishMissing(values)).toEqual(server.readiness.missing);
    expect(listingPublishMissing(values)).toEqual([
      '都道府県を設定してください', '市区町村を設定してください', '住所を設定してください',
      expect.stringMatching(/^キャッチコピー：/),
    ]);
  });

  test('所在地だけの判定は PR 文言を見ない', () => {
    expect(listingLocationMissing({ name: '合成店舗', prefecture: '東京都', city: '渋谷区', address: '1-1', catch_copy: '日本一' })).toEqual([]);
    expect(listingLocationMissing({})).toEqual(['施設名を設定してください', '都道府県を設定してください', '市区町村を設定してください', '住所を設定してください']);
  });

  test('ネット予約の判定は条件ごとのキーを持ち、不足の一覧はその文言から作られる', () => {
    const checks = bookingReadinessChecks({ name: '合成院', prefecture: '大阪府', city: '豊中市', hasAddress: false,
      status: 'draft', businessHours: null, menuCount: 0, photoCount: 1, staffCount: 1 });
    expect(checks.map((c: { key: string; ok: boolean }) => [c.key, c.ok])).toEqual([
      ['name', true], ['menu', false], ['photo', true], ['staff', true], ['prefecture', true], ['city', true],
      ['address', false], ['published', false], ['hours', false],
    ]);
  });
});
