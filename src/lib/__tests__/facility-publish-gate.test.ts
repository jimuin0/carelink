/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * checkPublishReadiness の網羅テスト（単一公開/一括公開で共有する公開ゲート）。
 */

import {
  checkBookingReadiness as checkPublishReadiness, checkPublishReadiness as checkListingReadiness, isPublishedLocationConflict,
  isPublishedHoursConflict, readWorkingStaff, summarizeWorkingStaff, workingStaffQuery, workingTimeMeetsBusinessHours,
  bookableMenusQuery, shortestBookingMinutes, isListingVerificationConflict,
} from '../facility-publish-gate';

test('未審査の公開拒否だけを確認待ちとして区別する', () => {
  expect(isListingVerificationConflict({ code: '23514', message: '"published_listing_verification_required"' })).toBe(true);
  expect(isListingVerificationConflict({ code: '23514', message: 'other' })).toBe(false);
  expect(isListingVerificationConflict({ code: '23505', message: '"published_listing_verification_required"' })).toBe(false);
  expect(isListingVerificationConflict(null)).toBe(false);
});

test.each([null, undefined, false, '23514', {}, { code: '23514' },
  { code: '23514', message: null }, { code: '23514', message: 'another_constraint' },
  { code: '23505', message: '"published_facility_location_present"' },
])('unrelated or malformed DB error remains a server error: %p', (value) => {
  expect(isPublishedLocationConflict(value)).toBe(false);
});
test('identifies only the named location CHECK violation', () => {
  expect(isPublishedLocationConflict({ code: '23514', message: 'new row violates check constraint "published_facility_location_present"' })).toBe(true);
});

test.each([null, {}, { code: '23514', message: '"published_facility_location_present"' },
  { code: '23505', message: '"published_facility_hours_confirmed"' }, { code: '23514', message: null }])(
  'only the hours invariant is an hours conflict: %p', (value) => {
    expect(isPublishedHoursConflict(value)).toBe(false);
  });
test('the DB publish RPCs report unconfirmed hours as an actionable conflict', () => {
  const error = { code: '23514', message: '"published_facility_hours_confirmed"' };
  expect(isPublishedHoursConflict(error)).toBe(true);
  expect(isPublishedLocationConflict(error)).toBe(false);
});

// facility_menus は .select().eq().or()、facility_photos は .select().eq() で count を解決する thenable。
function countChain(count: number | null, error: unknown = null, data?: unknown) {
  const obj: Record<string, unknown> = {};
  obj.select = jest.fn(() => obj);
  obj.eq = jest.fn(() => obj);
  obj.or = jest.fn(() => obj);
  obj.then = (resolve: (v: { count: number | null; error: unknown; data?: unknown }) => unknown) =>
    resolve({ count, error, data });
  return obj;
}

// staff_profiles は勤務の有無つき（workingStaffQuery）で行を返す thenable。
function staffChain(data: unknown, error: unknown = null) {
  const obj: Record<string, jest.Mock | unknown> = {};
  for (const method of ['select', 'eq', 'gte', 'not', 'limit']) obj[method] = jest.fn(() => obj);
  obj.then = (resolve: (v: { data: unknown; error: unknown }) => unknown) => resolve({ data, error });
  return obj;
}
/** 月曜（営業日 10:00-18:00）に勤務するスタッフ n 人（null は data が null の応答）。 */
const workingRows = (n: number | null) => n === null ? null
  : Array.from({ length: n }, (_, i) => ({ id: `s${i}`, staff_schedules: [{ day_of_week: 1, start_time: '09:00:00', end_time: '18:00:00' }], schedule_overrides: [] }));

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
  /** 勤務時間のある有効スタッフの人数。staffRows を渡せばそちらを優先する。 */
  staff?: number | null;
  staffRows?: unknown;
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
        const rows = 'staffRows' in opts ? opts.staffRows : workingRows('staff' in opts ? (opts.staff as number | null) : 0);
        return staffChain(rows, opts.staffErr ?? null);
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
  expect(readiness.missing).toContain('営業時間内の勤務時間を保存したスタッフを1人以上登録してください');
});

// 回帰（E8 後続）: スタッフを追加しただけでは勤務は作られない。勤務時間の無い有効スタッフしか
// いない店舗を予約可能と扱うと、検索カードは「予約OK」なのに予約画面は毎日「満枠」になる。
test('有効スタッフがいても勤務時間が無ければネット予約は準備中', async () => {
  const { readiness, error } = await checkPublishReadiness(admin({ menu: 1, photo: 1,
    staffRows: [{ id: 'new', staff_schedules: [], schedule_overrides: [] }, { id: 'nulls', staff_schedules: null, schedule_overrides: null }] }), 'f1');
  expect(error).toBeNull();
  expect(readiness).toEqual({ ready: false, missing: ['営業時間内の勤務時間を保存したスタッフを1人以上登録してください'] });
});

test('特別日だけ勤務するスタッフでもネット予約を受けられる', async () => {
  const { readiness } = await checkPublishReadiness(admin({ menu: 1, photo: 1,
    staffRows: [{ id: 'special', staff_schedules: [], schedule_overrides: [{ date: '2030-01-07', start_time: '10:00:00', end_time: '12:00:00' }] }] }), 'f1');
  expect(readiness).toEqual({ ready: true, missing: [] });
});

// 回帰（2026年10月23日）: 勤務時間はあるが、どれも営業時間（月曜 10:00-18:00・他は定休日）と重ならない。
// 予約枠は営業時間の中にしか出ないので、検索カードは「予約OK」なのに予約画面は毎日「満枠」になっていた。
test('勤務時間が営業時間と重ならなければネット予約は準備中', async () => {
  const { readiness } = await checkPublishReadiness(admin({ menu: 1, photo: 1, staffRows: [
    { id: 'closed-day', staff_schedules: [{ day_of_week: 2, start_time: '09:00:00', end_time: '18:00:00' }], schedule_overrides: [] },
    { id: 'early', staff_schedules: [{ day_of_week: 1, start_time: '07:00:00', end_time: '10:00:00' }],
      schedule_overrides: [{ date: '2030-01-08', start_time: '10:00:00', end_time: '12:00:00' }] },
  ] }), 'f1');
  expect(readiness).toEqual({ ready: false, missing: ['営業時間内の勤務時間を保存したスタッフを1人以上登録してください'] });
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

test('staff の data が null → 0人として不足扱い', async () => {
  const { readiness } = await checkPublishReadiness(admin({ menu: 1, photo: 1, staff: null }), 'f1');
  expect(readiness.missing).toContain('営業時間内の勤務時間を保存したスタッフを1人以上登録してください');
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
      if (table === 'staff_profiles') return staffChain(workingRows(1));
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

const LISTING_HOURS = { mon: { open: '10:00', close: '19:00' }, tue: null, wed: { open: '10:00', close: '19:00' },
  thu: { open: '10:00', close: '19:00' }, fri: { open: '10:00', close: '19:00' }, sat: { open: '10:00', close: '17:00' }, sun: null };

describe('掲載だけの公開条件', () => {
  test('メニュー・写真・スタッフなしでも所在地と営業時間があれば掲載できる', async () => {
    const from = jest.fn(() => profileChain({ name: '合成店舗', prefecture: '東京都', city: '検証区', address: '検証町1-1', business_hours: LISTING_HOURS }));
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
    expect(result.readiness.missing).toEqual(['施設名を設定してください', '都道府県を設定してください', '市区町村を設定してください', '住所を設定してください',
      '全曜日の営業時間・定休日を確認して保存してください']);
  });

  // 2026年10月23日 神原さん決定：曜日別の営業時間（定休日を含む）の保存は無料掲載の公開条件。
  // 判定はネット予約と同じ public.confirmed_booking_hours の規則（7曜日すべて・営業日1日以上・開店<閉店）。
  test.each([
    ['未保存', null],
    ['曜日が欠けている', { mon: { open: '10:00', close: '19:00' } }],
    ['全曜日が定休日', { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }],
    ['開始と終了が同時刻', { ...LISTING_HOURS, mon: { open: '19:00', close: '19:00' } }],
  ])('営業時間が%sなら公開できない', async (_label, business_hours) => {
    const located = { name: '合成店舗', prefecture: '東京都', city: '検証区', address: '検証町1-1' };
    const chain = profileChain({ ...located, business_hours });
    const result = await checkListingReadiness({ from: () => chain } as never, 'f1');
    expect(chain.select).toHaveBeenCalledWith('name, prefecture, city, address, catch_copy, description, business_hours');
    expect(result).toEqual({ readiness: { ready: false, missing: ['全曜日の営業時間・定休日を確認して保存してください'] }, error: null });
  });

  // 最後の砦: /admin/settings は保存時に弾くが、/register の PR 文（取り込み後は施設紹介）は
  // 設定画面を経ずに入るため、検査されないまま公開できた。
  const located = { name: '合成店舗', prefecture: '東京都', city: '検証区', address: '検証町1-1', business_hours: LISTING_HOURS };
  test('公開時にキャッチコピーと施設紹介も医療広告の表現を検査する', async () => {
    const chain = profileChain({ ...located, catch_copy: '技術力No.1', description: '施術で必ず治る' });
    const result = await checkListingReadiness({ from: () => chain } as never, 'f1');
    expect(chain.select).toHaveBeenCalledWith('name, prefecture, city, address, catch_copy, description, business_hours');
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
    ['no active staff with working time', { active_staff_count: 0 }],
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
      status: 'published', businessHours: hours, menuCount: 2, photoCount: 0, workingStaffCount: 1 }))
      .toEqual(['写真を1枚以上登録してください']);
  });
});

describe('画面の入力にも同じ公開規則を使う（listingPublishMissing）', () => {
  const { listingPublishMissing, listingLocationMissing, bookingReadinessChecks } = jest.requireActual('../facility-publish-gate');

  test('保存前の入力値で、サーバーの公開ゲートと同じ項目・同じ文言を返す', async () => {
    const values = { name: '合成店舗', prefecture: '', city: ' ', address: null, catch_copy: '日本一', description: null, business_hours: null };
    const server = await checkListingReadiness({ from: () => profileChain(values) } as never, 'f1');
    expect(listingPublishMissing(values)).toEqual(server.readiness.missing);
    // 並びはチェックリストと同じ：店舗情報（所在地・PR 文言）→ 営業時間
    expect(listingPublishMissing(values)).toEqual([
      '都道府県を設定してください', '市区町村を設定してください', '住所を設定してください',
      expect.stringMatching(/^キャッチコピー：/),
      '全曜日の営業時間・定休日を確認して保存してください',
    ]);
  });

  test('営業時間の文言はネット予約の判定と同じ（判定も 1 か所）', () => {
    const { listingHoursMissing, LISTING_HOURS_MESSAGE } = jest.requireActual('../facility-publish-gate');
    expect(listingHoursMissing(LISTING_HOURS)).toEqual([]);
    expect(listingHoursMissing(undefined)).toEqual([LISTING_HOURS_MESSAGE]);
    const hours = bookingReadinessChecks({ name: 'x', prefecture: 'x', city: 'x', hasAddress: true, status: 'published',
      businessHours: null, menuCount: 1, photoCount: 1, workingStaffCount: 1 }).find((c: { key: string }) => c.key === 'hours');
    expect(hours.message).toBe(LISTING_HOURS_MESSAGE);
  });

  test('所在地だけの判定は PR 文言を見ない', () => {
    expect(listingLocationMissing({ name: '合成店舗', prefecture: '東京都', city: '渋谷区', address: '1-1', catch_copy: '日本一' })).toEqual([]);
    expect(listingLocationMissing({})).toEqual(['施設名を設定してください', '都道府県を設定してください', '市区町村を設定してください', '住所を設定してください']);
  });

  test('ネット予約の判定は条件ごとのキーを持ち、不足の一覧はその文言から作られる', () => {
    const checks = bookingReadinessChecks({ name: '合成院', prefecture: '大阪府', city: '豊中市', hasAddress: false,
      status: 'draft', businessHours: null, menuCount: 0, photoCount: 1, workingStaffCount: 1 });
    expect(checks.map((c: { key: string; ok: boolean }) => [c.key, c.ok])).toEqual([
      ['name', true], ['menu', false], ['photo', true], ['staff', true], ['prefecture', true], ['city', true],
      ['address', false], ['published', false], ['hours', false],
    ]);
  });
});

describe('勤務時間のある在籍スタッフ（workingStaffQuery）', () => {
  // get_available_slots が枠を出す条件と同じ。SQL 側は public.staff_has_working_time。
  test('在籍スタッフを、週間の勤務日と今日以降に勤務する特別日（休みでなく時刻あり）つきで読む', () => {
    const chain = staffChain([]);
    const from = jest.fn(() => chain);
    workingStaffQuery({ from } as never, 'f1', '2026-10-23');
    expect(from).toHaveBeenCalledWith('staff_profiles');
    expect(chain.select).toHaveBeenCalledWith('id, staff_schedules(day_of_week, start_time, end_time), schedule_overrides(date, start_time, end_time)');
    expect((chain.eq as jest.Mock).mock.calls).toEqual([['facility_id', 'f1'], ['is_active', true]]);
    expect(chain.gte).toHaveBeenCalledWith('schedule_overrides.date', '2026-10-23');
    expect((chain.not as jest.Mock).mock.calls).toEqual([
      ['schedule_overrides.is_holiday', 'is', true],
      ['schedule_overrides.start_time', 'is', null],
      ['schedule_overrides.end_time', 'is', null],
    ]);
    // 窓は全部読む（最初の 1 行が営業時間外でも、後の行が重なれば予約を受けられる）。
    expect(chain.limit).not.toHaveBeenCalled();
  });

  test('今日は日本時間で数える（UTC ではまだ前日の 0:30 JST でも当日）', () => {
    jest.useFakeTimers({ now: new Date('2026-10-22T15:30:00Z') });
    try {
      const chain = staffChain([]);
      workingStaffQuery({ from: () => chain } as never, 'f1');
      expect(chain.gte).toHaveBeenCalledWith('schedule_overrides.date', '2026-10-23');
    } finally {
      jest.useRealTimers();
    }
  });

  test('営業時間の中に勤務日か勤務する特別日が1つでもあるスタッフだけを予約を受けられるスタッフにする', () => {
    const HOURS = { mon: { open: '10:00', close: '18:00' }, tue: null, wed: { open: '10:00', close: '18:00' } };
    expect(summarizeWorkingStaff([
      { id: 'weekly', staff_schedules: [{ day_of_week: 1, start_time: '09:00:00', end_time: '11:00:00' }], schedule_overrides: [] },
      // 2030-01-09 は水曜（営業日）
      { id: 'special', staff_schedules: [], schedule_overrides: [{ date: '2030-01-09', start_time: '17:00:00', end_time: '20:00:00' }] },
      // 最初の窓は定休日（火曜）でも、次の窓が営業時間と重なれば予約を受けられる
      { id: 'second', staff_schedules: [{ day_of_week: 2, start_time: '09:00:00', end_time: '18:00:00' }, { day_of_week: 3, start_time: '12:00:00', end_time: '13:00:00' }] },
      { id: 'closed', staff_schedules: [{ day_of_week: 2, start_time: '09:00:00', end_time: '18:00:00' }], schedule_overrides: [{ date: '2030-01-08', start_time: '10:00:00', end_time: '12:00:00' }] },
      { id: 'outside', staff_schedules: [{ day_of_week: 1, start_time: '18:00:00', end_time: '21:00:00' }], schedule_overrides: null },
      { id: 'none', staff_schedules: [], schedule_overrides: [] },
      { id: 'missing' },
    ], HOURS)).toEqual({
      activeIds: ['weekly', 'special', 'second', 'closed', 'outside', 'none', 'missing'],
      workingIds: new Set(['weekly', 'special', 'second']),
      outsideHoursIds: new Set(['closed', 'outside']),
    });
    expect(summarizeWorkingStaff(null, HOURS)).toEqual({ activeIds: [], workingIds: new Set(), outsideHoursIds: new Set() });
  });

  test('readWorkingStaff は読めなければ例外（未登録と偽装しない）', async () => {
    const client = (staff: unknown, facility: { data: unknown; error: unknown },
      menus: { data: unknown; error: unknown } = { data: [], error: null }) => ({
      from: (table: string) => table === 'staff_profiles' ? staff
        : table === 'facility_menus' ? { select: () => ({ eq: () => ({ or: () => Promise.resolve(menus) }) }) }
        : { select: () => ({ eq: () => ({ limit: () => Promise.resolve(facility) }) }) },
    }) as never;
    const hours = { data: [{ business_hours: { mon: { open: '10:00', close: '18:00' } } }], error: null };
    await expect(readWorkingStaff(client(staffChain(null, { message: 'down' }), hours), 'f1'))
      .rejects.toThrow('スタッフの勤務状況を取得できませんでした: down');
    await expect(readWorkingStaff(client(staffChain(workingRows(2)), { data: null, error: { message: 'hours down' } }), 'f1'))
      .rejects.toThrow('スタッフの勤務状況を取得できませんでした: hours down');
    await expect(readWorkingStaff(client(staffChain(workingRows(2)), hours), 'f1'))
      .resolves.toEqual({ activeIds: ['s0', 's1'], workingIds: new Set(['s0', 's1']), outsideHoursIds: new Set() });
    // 営業時間が月曜 18:00 以降だけなら、09:00-18:00 の勤務は予約を受けられない
    await expect(readWorkingStaff(client(staffChain(workingRows(1)), { data: [{ business_hours: { mon: { open: '18:00', close: '20:00' } } }], error: null }), 'f1'))
      .resolves.toEqual({ activeIds: ['s0'], workingIds: new Set(), outsideHoursIds: new Set(['s0']) });
    // メニューが読めなければ例外（最短の所要時間を 15 分と取り違えない）
    await expect(readWorkingStaff(client(staffChain(workingRows(1)), hours, { data: null, error: { message: 'menus down' } }), 'f1'))
      .rejects.toThrow('スタッフの勤務状況を取得できませんでした: menus down');
    // 営業時間と 30 分だけ重なる勤務（月曜 17:30-20:00）は、最短のメニューが 60 分なら予約を受けられない
    const lateShift = staffChain([{ id: 's0', staff_schedules: [{ day_of_week: 1, start_time: '17:30:00', end_time: '20:00:00' }], schedule_overrides: [] }]);
    await expect(readWorkingStaff(client(lateShift, hours, { data: [{ duration_minutes: 60 }, { duration_minutes: null }], error: null }), 'f1'))
      .resolves.toEqual({ activeIds: ['s0'], workingIds: new Set(), outsideHoursIds: new Set(['s0']) });
    await expect(readWorkingStaff(client(lateShift, hours, { data: [{ duration_minutes: 60 }, { duration_minutes: 30 }], error: null }), 'f1'))
      .resolves.toEqual({ activeIds: ['s0'], workingIds: new Set(['s0']), outsideHoursIds: new Set() });
    // 施設の行が見えない（RLS）なら営業時間で切り詰めない（SQL 側と同じ）
    for (const invisible of [{ data: [], error: null }, { data: null, error: null }, { data: [{}], error: null }]) {
      await expect(readWorkingStaff(client(staffChain(workingRows(1)), invisible), 'f1'))
        .resolves.toEqual({ activeIds: ['s0'], workingIds: new Set(['s0']), outsideHoursIds: new Set() });
    }
  });

  // SQL 側 public.working_time_meets_business_hours（migration 20261023180000）と同じ読み方。
  describe('workingTimeMeetsBusinessHours', () => {
    const MON = 1;
    test.each([
      ['営業時間が未設定なら切り詰めない', null, MON, '07:00:00', '08:00:00', true],
      ['配列も未設定と同じ', [], MON, '07:00', '08:00', true],
      ['曜日のキーが無ければ切り詰めない', { tue: null }, MON, '07:00', '08:00', true],
      ['定休日（null）は重ならない', { mon: null }, MON, '10:00', '18:00', false],
      ['重なる', { mon: { open: '10:00', close: '18:00' } }, MON, '09:00:00', '10:30:00', true],
      ['営業開始より前に終わる', { mon: { open: '10:00', close: '18:00' } }, MON, '07:00:00', '10:00:00', false],
      ['営業終了から始まる', { mon: { open: '10:00', close: '18:00' } }, MON, '18:00:00', '21:00:00', false],
      ['open だけでは切り詰めない', { mon: { open: '10:00' } }, MON, '07:00', '08:00', true],
      ['open が null なら切り詰めない', { mon: { open: null, close: '09:00' } }, MON, '10:00', '11:00', true],
      ['曜日の値がオブジェクトでなければ切り詰めない', { mon: 'always' }, MON, '07:00', '08:00', true],
      ['曜日の値が配列でも切り詰めない', { mon: [] }, MON, '07:00', '08:00', true],
      ['読めない営業時間は予約枠も出せないので重ならない', { mon: { open: '25:00', close: '18:00' } }, MON, '10:00', '11:00', false],
      ['読めない閉店時刻も同じ', { mon: { open: '10:00', close: 18 } }, MON, '10:00', '11:00', false],
      ['勤務の開始が読めなければ重ならない', null, MON, null, '11:00', false],
      ['勤務の終了が読めなければ重ならない', null, MON, '10:00', 'later', false],
      ['開始と終了が同じなら重ならない', null, MON, '10:00', '10:00', false],
      ['曜日が範囲外なら重ならない', null, 7, '10:00', '11:00', false],
      ['曜日が読めなければ重ならない', null, Number.NaN, '10:00', '11:00', false],
    ])('%s', (_label, hours, dow, start, end, expected) => {
      expect(workingTimeMeetsBusinessHours(hours, dow as number, start, end)).toBe(expected);
    });

    test('読めない日付の特別日は重ならない', () => {
      expect(summarizeWorkingStaff([{ id: 'x', staff_schedules: [], schedule_overrides: [{ date: 'not-a-date', start_time: '10:00', end_time: '11:00' }, { date: null, start_time: '10:00', end_time: '11:00' }] }], null))
        .toEqual({ activeIds: ['x'], workingIds: new Set(), outsideHoursIds: new Set(['x']) });
    });
  });
});

// migration 20261023190000：勤務の窓は、店舗の最短のメニュー以上が営業時間の中に残るときだけ数える。
// 予約枠（get_available_slots）は切り詰めた窓に所要時間がまるごと入るときだけ出るため、数分だけ重なる
// スタッフしかいない店舗は「予約OK」なのに毎日「満枠」だった。
describe('勤務の窓に要る長さ（最短のメニュー）', () => {
  test('shortestBookingMinutes は予約画面の所要時間（未設定・0 は 60 分、15〜480 に丸める）の最小値', () => {
    expect(shortestBookingMinutes([{ duration_minutes: 90 }, { duration_minutes: 45 }])).toBe(45);
    expect(shortestBookingMinutes([{ duration_minutes: null }, { duration_minutes: 0 }])).toBe(60);
    expect(shortestBookingMinutes([{ duration_minutes: 5 }])).toBe(15);
    expect(shortestBookingMinutes([{ duration_minutes: 600 }])).toBe(480);
    // 予約できるメニューが無い・読めない形なら、空き枠 RPC が受け付ける最短（15 分）
    expect(shortestBookingMinutes([])).toBe(15);
    expect(shortestBookingMinutes(null)).toBe(15);
  });

  test('bookableMenusQuery は件数つきで、非公開以外のメニューの所要時間を読む', () => {
    const chain = countChain(0);
    const from = jest.fn(() => chain);
    bookableMenusQuery({ from } as never, 'f1');
    expect(from).toHaveBeenCalledWith('facility_menus');
    expect(chain.select).toHaveBeenCalledWith('duration_minutes', { count: 'exact' });
    expect(chain.eq).toHaveBeenCalledWith('facility_id', 'f1');
    expect(chain.or).toHaveBeenCalledWith('is_published.is.null,is_published.eq.true');
  });

  const MON_HOURS = { mon: { open: '10:00', close: '18:00' } };
  test.each([
    ['14 分の重なりは既定（15 分）に届かない', '17:46', '20:00', undefined, false],
    ['15 分ちょうどは届く（get_available_slots と同じく以上）', '17:45', '20:00', undefined, true],
    ['30 分の重なりは 60 分のメニューに届かない', '17:30', '20:00', 60, false],
    ['60 分ちょうどの重なりは 60 分のメニューに届く', '17:00', '20:00', 60, true],
    ['秒まで比べる（59 分 59 秒は届かない）', '17:00:01', '20:00', 60, false],
    ['15 分未満の指定は 15 分に丸める', '17:50', '20:00', 5, false],
    ['480 分を超える指定は 480 分に丸める（営業 8 時間ちょうどで届く）', '09:00', '18:00', 600, true],
    ['読めない指定は 15 分', '17:45', '20:00', Number.NaN, true],
  ])('%s', (_label, start, end, minMinutes, expected) => {
    expect(workingTimeMeetsBusinessHours(MON_HOURS, 1, start, end, minMinutes)).toBe(expected);
  });

  test('summarizeWorkingStaff は窓ごとに最短のメニューで確かめる', () => {
    const rows = [
      { id: 'short', staff_schedules: [{ day_of_week: 1, start_time: '07:00', end_time: '10:20' }], schedule_overrides: [] },
      { id: 'special-short', staff_schedules: [], schedule_overrides: [{ date: '2030-01-07', start_time: '17:40', end_time: '19:00' }] },
      { id: 'long', staff_schedules: [{ day_of_week: 1, start_time: '07:00', end_time: '12:00' }], schedule_overrides: [] },
    ];
    expect(summarizeWorkingStaff(rows, MON_HOURS, 60)).toEqual({
      activeIds: ['short', 'special-short', 'long'], workingIds: new Set(['long']), outsideHoursIds: new Set(['short', 'special-short']),
    });
    expect(summarizeWorkingStaff(rows, MON_HOURS).workingIds).toEqual(new Set(['short', 'special-short', 'long']));
  });

  test('checkBookingReadiness は店舗の最短のメニューで勤務の窓を数える', async () => {
    const admin = (menuRows: unknown) => ({
      from: (table: string) => {
        if (table === 'facility_menus') return countChain(1, null, menuRows);
        if (table === 'facility_photos') return countChain(1);
        if (table === 'staff_profiles') {
          return staffChain([{ id: 's0', staff_schedules: [{ day_of_week: 1, start_time: '07:00:00', end_time: '10:30:00' }], schedule_overrides: [] }]);
        }
        return profileChain({ name: '合成店舗', status: 'published', prefecture: '東京都', city: '渋谷区', address: '検証町1-1',
          business_hours: { mon: { open: '10:00', close: '18:00' }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } });
      },
    }) as never;
    // 営業時間と 30 分だけ重なる。最短のメニューが 60 分なら予約枠は出ない
    const short = await checkPublishReadiness(admin([{ duration_minutes: 60 }]), 'f1');
    expect(short.readiness.missing).toEqual(['営業時間内の勤務時間を保存したスタッフを1人以上登録してください']);
    // 30 分のメニューがあれば受けられる
    const fits = await checkPublishReadiness(admin([{ duration_minutes: 60 }, { duration_minutes: 30 }]), 'f1');
    expect(fits.readiness).toEqual({ ready: true, missing: [] });
  });
});

test('staff end-of-day accepts 24:00 without wrapping it to midnight', () => {
  expect(workingTimeMeetsBusinessHours({ mon: { open: '18:00', close: '05:00' } }, 1, '23:00', '24:00')).toBe(true);
});
