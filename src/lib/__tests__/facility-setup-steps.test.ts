/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 店舗セットアップ（/admin のチェックリスト・登録3日後のフォローメール）の単一ソース。
 *
 * 呼び出しの形ではなく、行に条件を【実際に適用】した結果で主張する。下書きのメニューや
 * 休止中のスタッフ、勤務日の無いスタッフを「登録済み」と数えていたのが実際の欠陥なので、
 * 条件を書き忘れれば結果が変わるようにしておく。
 */
import {
  facilitySetupSteps, loadFacilitySetupFacts, loadScheduledStaffIds, type FacilitySetupFacts,
} from '../facility-setup-steps';

const CONFIRMED_HOURS = {
  mon: { open: '10:00', close: '20:00' }, tue: { open: '10:00', close: '20:00' }, wed: { open: '10:00', close: '20:00' },
  thu: { open: '10:00', close: '20:00' }, fri: { open: '10:00', close: '20:00' }, sat: { open: '10:00', close: '20:00' }, sun: null,
};

function facts(overrides: Partial<FacilitySetupFacts> = {}): FacilitySetupFacts {
  return {
    name: '合成店舗', prefecture: '東京都', city: '渋谷区', address: '合成1-1', status: 'published',
    businessHours: CONFIRMED_HOURS, publishedMenuCount: 1, photoCount: 1,
    activeStaffIds: ['s1'], unscheduledStaffIds: [], ...overrides,
  };
}
const pending = (f: FacilitySetupFacts) => facilitySetupSteps(f).filter(step => !step.done).map(step => step.key);

describe('facilitySetupSteps', () => {
  test('すべて揃えば全項目完了。並びと案内先・区分はダッシュボードの表示順どおり', () => {
    const steps = facilitySetupSteps(facts());
    expect(steps.map(s => [s.key, s.label, s.href, s.group, s.done])).toEqual([
      ['address', '基本情報（住所）', '/admin/settings', 'listing', true],
      ['publish', '無料掲載を公開', '/admin/settings', 'listing', true],
      ['menu', 'ネット予約：公開メニュー登録', '/admin/menus', 'booking', true],
      ['staff', 'ネット予約：有効スタッフ登録', '/admin/staff', 'booking', true],
      ['photo', 'ネット予約：写真アップロード', '/admin/photos', 'booking', true],
      ['hours', 'ネット予約：営業時間の確認・保存', '/admin/settings', 'booking', true],
      ['schedule', '予約枠：勤務スケジュール設定', '/admin/staff', 'booking', true],
    ]);
  });

  test('セルフサーブ直後（施設名だけ）は住所・営業時間を含む全項目が未完了', () => {
    expect(pending(facts({
      prefecture: '', city: null, address: null, status: 'draft', businessHours: null,
      publishedMenuCount: 0, photoCount: 0, activeStaffIds: [], unscheduledStaffIds: [],
    }))).toEqual(['address', 'publish', 'menu', 'staff', 'photo', 'hours', 'schedule']);
  });

  test.each([
    ['name', { name: '　' }],
    ['prefecture', { prefecture: null }],
    ['city', { city: ' ' }],
    ['address', { address: '　\t' }],
  ])('基本情報は %s が空白だけでも未完了（公開ゲートと同じ判定）', (_field, override) => {
    expect(pending(facts(override))).toEqual(['address']);
  });

  test('未確定の営業時間（曜日の欠け）は未完了', () => {
    expect(pending(facts({ businessHours: { mon: { open: '10:00', close: '20:00' } } }))).toEqual(['hours']);
  });

  test('勤務日の無い有効スタッフが1人でもいれば勤務スケジュールは未完了', () => {
    expect(pending(facts({ activeStaffIds: ['s1', 's2'], unscheduledStaffIds: ['s2'] }))).toEqual(['schedule']);
  });

  test('有効スタッフがいなければ勤務スケジュールも完了にしない', () => {
    expect(pending(facts({ activeStaffIds: [], unscheduledStaffIds: [] }))).toEqual(['staff', 'schedule']);
  });
});

// ─── 読み取り ────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

/** PostgREST の or 文字列のうち is.null / eq を SQL と同じ NULL の扱いで解釈する。 */
function orFilter(expr: string): Filter {
  const parts = expr.split(',').map(part => part.split('.'));
  return row => parts.some(([column, op, value]) => {
    if (op === 'is') return row[column] === null || row[column] === undefined;
    if (row[column] === null || row[column] === undefined) return false;
    if (op === 'eq') return String(row[column]) === value;
    throw new Error(`unsupported or-filter ${expr}`);
  });
}

function fakeClient(tables: Record<string, Row[]>, errors: Record<string, unknown> = {}, opts: { nullData?: boolean } = {}) {
  const from = jest.fn((table: string) => ({
    select: (_columns: string, options?: { count?: string; head?: boolean }) => {
      const filters: Filter[] = [];
      const result = () => {
        if (errors[table]) return { data: null, count: null, error: errors[table] };
        const rows = (tables[table] ?? []).filter(row => filters.every(f => f(row)));
        if (opts.nullData) return { data: null, count: null, error: null };
        return { data: options?.head ? null : rows, count: options?.count ? rows.length : null, error: null };
      };
      const query: Record<string, unknown> = {
        eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return query; },
        in: (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return query; },
        or: (expr: string) => { filters.push(orFilter(expr)); return query; },
        single: async () => {
          const r = result();
          return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
        },
        then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
      };
      return query;
    },
  }));
  return { client: { from } as never, from };
}

const F = 'f1';
function seed(): Record<string, Row[]> {
  return {
    facility_profiles: [{ id: F, name: '合成店舗', prefecture: '東京都', city: '渋谷区', address: '合成1-1', business_hours: CONFIRMED_HOURS, status: 'draft' }],
    facility_menus: [
      { facility_id: F, is_published: true }, { facility_id: F, is_published: null },
      { facility_id: F, is_published: false }, { facility_id: 'other', is_published: true },
    ],
    staff_profiles: [
      { id: 's-active', facility_id: F, is_active: true }, { id: 's-new', facility_id: F, is_active: true },
      { id: 's-paused', facility_id: F, is_active: false }, { id: 's-other', facility_id: 'other', is_active: true },
    ],
    facility_photos: [{ facility_id: F }, { facility_id: 'other' }],
    staff_schedules: [
      { staff_id: 's-active', day_of_week: 1 }, { staff_id: 's-active', day_of_week: 2 },
      { staff_id: 's-paused', day_of_week: 1 }, { staff_id: 's-other', day_of_week: 1 },
    ],
  };
}

describe('loadFacilitySetupFacts', () => {
  test('公開メニュー・有効スタッフだけを数え、勤務日の無い有効スタッフを特定する', async () => {
    const { client } = fakeClient(seed());
    expect(await loadFacilitySetupFacts(client, F)).toEqual({
      name: '合成店舗', prefecture: '東京都', city: '渋谷区', address: '合成1-1', status: 'draft',
      businessHours: CONFIRMED_HOURS,
      publishedMenuCount: 2, // 下書き（is_published=false）と他店舗は数えない
      photoCount: 1,
      activeStaffIds: ['s-active', 's-new'], // 休止中・他店舗は数えない
      unscheduledStaffIds: ['s-new'], // 追加しただけで勤務を保存していないスタッフ
    });
  });

  test('下書きメニューだけ・休止中スタッフだけの店舗は、それぞれ未完了になる', async () => {
    const tables = seed();
    tables.facility_menus = [{ facility_id: F, is_published: false }];
    tables.staff_profiles = [{ id: 's-paused', facility_id: F, is_active: false }];
    const { client, from } = fakeClient(tables);
    const loaded = await loadFacilitySetupFacts(client, F);
    expect(pending(loaded)).toEqual(['publish', 'menu', 'staff', 'schedule']);
    // 有効スタッフがいなければ勤務の読み取りはしない
    expect(from).not.toHaveBeenCalledWith('staff_schedules');
  });

  test('読み取りはすべて渡された関数を通る（ページの時間制限つき読み取り）', async () => {
    const { client } = fakeClient(seed());
    const labels: string[] = [];
    await loadFacilitySetupFacts(client, F, (label, query) => { labels.push(label); return Promise.resolve(query); });
    expect(labels.sort()).toEqual(['facility', 'menus', 'photos', 'schedules', 'staff']);
  });

  test.each(['facility_menus', 'staff_profiles', 'facility_photos', 'facility_profiles'])(
    '%s を読めなければ例外にする（未設定・0件に偽装しない）', async (table) => {
      const { client } = fakeClient(seed(), { [table]: { message: `${table} down` } });
      await expect(loadFacilitySetupFacts(client, F)).rejects.toThrow(`店舗セットアップの状況を取得できませんでした: ${table} down`);
    });

  test('勤務スケジュールを読めなければ例外にする', async () => {
    const { client } = fakeClient(seed(), { staff_schedules: { message: 'schedules down' } });
    await expect(loadFacilitySetupFacts(client, F)).rejects.toThrow('勤務スケジュールの取得に失敗しました: schedules down');
  });

  test('件数・行が null でも 0・空として扱う（行の無い店舗）', async () => {
    const { client } = fakeClient(seed(), {}, { nullData: true });
    expect(await loadFacilitySetupFacts(client, F)).toEqual({
      name: null, prefecture: null, city: null, address: null, status: null, businessHours: null,
      publishedMenuCount: 0, photoCount: 0, activeStaffIds: [], unscheduledStaffIds: [],
    });
  });
});

describe('loadScheduledStaffIds', () => {
  test('対象が空なら読まずに空', async () => {
    const { client, from } = fakeClient(seed());
    expect(await loadScheduledStaffIds(client, [])).toEqual(new Set());
    expect(from).not.toHaveBeenCalled();
  });

  test('勤務日を1日以上保存したスタッフだけを返す', async () => {
    const { client } = fakeClient(seed());
    expect(await loadScheduledStaffIds(client, ['s-active', 's-new'])).toEqual(new Set(['s-active']));
  });

  test('data が null なら空', async () => {
    const { client } = fakeClient(seed(), {}, { nullData: true });
    expect(await loadScheduledStaffIds(client, ['s-active'])).toEqual(new Set());
  });
});
