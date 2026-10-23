/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 店舗セットアップ（/admin のチェックリスト・登録3日後のフォローメール）の単一ソース。
 *
 * 呼び出しの形ではなく、行に条件を【実際に適用】した結果で主張する。下書きのメニューや
 * 休止中のスタッフ、勤務時間の無いスタッフを「登録済み」と数えていたのが実際の欠陥なので、
 * 条件を書き忘れれば結果が変わるようにしておく。
 */
import { facilitySetupSteps, loadFacilitySetupFacts, setupGuideSteps, SETUP_STEP_HOWTO, type FacilitySetupFacts } from '../facility-setup-steps';

const CONFIRMED_HOURS = {
  mon: { open: '10:00', close: '20:00' }, tue: { open: '10:00', close: '20:00' }, wed: { open: '10:00', close: '20:00' },
  thu: { open: '10:00', close: '20:00' }, fri: { open: '10:00', close: '20:00' }, sat: { open: '10:00', close: '20:00' }, sun: null,
};

function facts(overrides: Partial<FacilitySetupFacts> = {}): FacilitySetupFacts {
  return {
    name: '合成店舗', slug: 'synthetic-shop', prefecture: '東京都', city: '渋谷区', address: '合成1-1', catchCopy: '駅チカ3分', description: null,
    status: 'published', businessHours: CONFIRMED_HOURS, publishedMenuCount: 1, photoCount: 1,
    activeStaffIds: ['s1'], unscheduledStaffIds: [], ...overrides,
  };
}
const pending = (f: FacilitySetupFacts) => facilitySetupSteps(f).filter(step => !step.done).map(step => step.key);

describe('facilitySetupSteps', () => {
  test('すべて揃えば全項目完了。並びは依存の順（掲載：店舗情報→営業時間→公開／ネット予約：メニュー→写真→スタッフ）', () => {
    const steps = facilitySetupSteps(facts());
    expect(steps.map(s => [s.key, s.label, s.href, s.group, s.done])).toEqual([
      ['address', '基本情報（住所）', '/admin/settings', 'listing', true],
      ['pr_text', '基本情報（キャッチコピー・施設紹介の表現）', '/admin/settings', 'listing', true],
      ['hours', '営業時間の入力・保存', '/admin/settings', 'listing', true],
      ['publish', '無料掲載を公開', '/admin/settings', 'listing', true],
      ['menu', '公開メニュー登録', '/admin/menus', 'booking', true],
      ['photo', '写真アップロード', '/admin/photos', 'booking', true],
      ['staff', 'スタッフ登録と勤務時間の保存', '/admin/staff', 'booking', true],
    ]);
    expect(steps.every(s => s.note === undefined && s.optional === undefined)).toBe(true);
  });

  // スタッフの勤務時間の下書きは店舗の営業時間から作る。営業時間がスタッフより後にあると、
  // スタッフを追加した直後に「店舗の営業時間がまだ保存されていない」と差し戻されていた。
  test('営業時間はスタッフより前に並ぶ', () => {
    const keys = facilitySetupSteps(facts()).map(s => s.key);
    expect(keys.indexOf('hours')).toBeLessThan(keys.indexOf('staff'));
  });

  // 2026年10月23日 神原さん決定：営業時間は「無料掲載に必要」。公開ゲート（listingPublishMissing）と
  // DB の公開 RPC が営業時間の無い公開を断るので、チェックリストも同じ区分・同じ順で見せる。
  test('営業時間は「無料掲載に必要」の区分で、店舗情報の後・公開の前に並ぶ', () => {
    const listing = facilitySetupSteps(facts()).filter(s => s.group === 'listing').map(s => s.key);
    expect(listing).toEqual(['address', 'pr_text', 'hours', 'publish']);
    expect(facilitySetupSteps(facts()).filter(s => s.group === 'booking').map(s => s.key)).toEqual(['menu', 'photo', 'staff']);
  });

  test('「勤務スケジュール設定」の重複項目は無い（スタッフの項目に一本化）', () => {
    expect(facilitySetupSteps(facts()).map(s => s.key)).not.toContain('schedule');
  });

  test('キャッチコピー・施設紹介が両方とも空なら「完了」ではなく任意・未入力として見せる（公開は止めない）', () => {
    const step = facilitySetupSteps(facts({ catchCopy: ' ', description: null })).find(s => s.key === 'pr_text');
    expect(step).toMatchObject({ done: true, optional: true, note: '任意・未入力' });
  });

  test('施設紹介だけ入っていれば任意・未入力にはしない', () => {
    const step = facilitySetupSteps(facts({ catchCopy: null, description: '丁寧なカウンセリング' })).find(s => s.key === 'pr_text');
    expect(step?.optional).toBeUndefined();
  });

  test('セルフサーブ直後（施設名だけ）は住所・営業時間を含む全項目が未完了（PR 文言は未入力なので問題なし）', () => {
    expect(pending(facts({
      prefecture: '', city: null, address: null, status: 'draft', businessHours: null, catchCopy: null,
      publishedMenuCount: 0, photoCount: 0, activeStaffIds: [], unscheduledStaffIds: [],
    }))).toEqual(['address', 'hours', 'publish', 'menu', 'photo', 'staff']);
  });

  test.each([
    ['name', { name: '　' }],
    ['prefecture', { prefecture: null }],
    ['city', { city: ' ' }],
    ['address', { address: '　\t' }],
  ])('基本情報は %s が空白だけでも未完了（公開ゲートと同じ判定）', (_field, override) => {
    expect(pending(facts(override))).toEqual(['address']);
  });

  // 公開ゲートは PR 文言の医療広告表現も止める。/register から取り込んだ施設紹介に禁止表現があると、
  // 以前のメール・ダッシュボードは「無料掲載を公開」だけを案内し、公開を押すと拒否されていた。
  test.each([
    [{ catchCopy: '技術力No.1' }],
    [{ description: '施術で必ず治る' }],
  ])('PR 文言が公開ゲートに止められる表現なら「表現」の項目を未完了にする：%p', (override) => {
    expect(pending(facts({ status: 'draft', ...override }))).toEqual(['pr_text', 'publish']);
  });

  test('問題の無い PR 文言は完了扱い', () => {
    expect(pending(facts({ catchCopy: '駅チカ3分', description: '丁寧なカウンセリング' }))).toEqual([]);
  });

  test('未確定の営業時間（曜日の欠け）は未完了', () => {
    expect(pending(facts({ businessHours: { mon: { open: '10:00', close: '20:00' } } }))).toEqual(['hours']);
  });

  // 他の人が勤務していれば予約は受けられる。勤務時間の無い人がいることは補足で知らせ、未完了にはしない
  // （以前は別項目「勤務スケジュール設定」が、予約を受けないスタッフがいる限り永久に未完了だった）。
  test('勤務時間の無い有効スタッフがいても、勤務するスタッフがいれば完了。人数は補足に出す', () => {
    const steps = facilitySetupSteps(facts({ activeStaffIds: ['s1', 's2'], unscheduledStaffIds: ['s2'] }));
    expect(steps.filter(s => !s.done)).toEqual([]);
    expect(steps.find(s => s.key === 'staff')?.note).toBe('勤務時間が未登録か営業時間外で予約を受けられないスタッフ：1人');
  });

  // 予約を受けられるのは勤務時間のあるスタッフだけ。追加しただけのスタッフ1人では予約を受けられない。
  test('有効スタッフが全員勤務時間なしなら、スタッフ（ネット予約）は未完了', () => {
    expect(pending(facts({ activeStaffIds: ['s1'], unscheduledStaffIds: ['s1'] }))).toEqual(['staff']);
  });

  test('有効スタッフがいなければスタッフは未完了', () => {
    expect(pending(facts({ activeStaffIds: [], unscheduledStaffIds: [] }))).toEqual(['staff']);
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

/**
 * 小さな PostgREST。select の埋め込み `child(col)` は child.staff_id = 親の id で結び、
 * `child.col` の絞り込みと `limit(n, { referencedTable })` は子の行だけに効く（親は減らない）。
 * 埋め込み先の失敗は、本物と同じくクエリ全体の失敗になる。
 */
function fakeClient(tables: Record<string, Row[]>, errors: Record<string, unknown> = {}, opts: { nullData?: boolean } = {}) {
  const from = jest.fn((table: string) => ({
    select: (columns: string, options?: { count?: string; head?: boolean }) => {
      const filters: Filter[] = [];
      const childFilters: Record<string, Filter[]> = {};
      const childLimits: Record<string, number> = {};
      const embeds = [...columns.matchAll(/(\w+)\([\w, ]+\)/g)].map(match => match[1]);
      const add = (column: string, make: (col: string) => Filter) => {
        const [child, col] = column.includes('.') ? column.split('.') : [null, column];
        if (child) (childFilters[child] ??= []).push(make(col)); else filters.push(make(col));
      };
      const result = () => {
        const failed = [table, ...embeds].find(name => errors[name]);
        if (failed) return { data: null, count: null, error: errors[failed] };
        const rows = (tables[table] ?? []).filter(row => filters.every(f => f(row))).map(row => {
          const out: Row = { ...row };
          for (const child of embeds) {
            const kids = (tables[child] ?? []).filter(kid => kid.staff_id === row.id && (childFilters[child] ?? []).every(f => f(kid)));
            out[child] = kids.slice(0, childLimits[child] ?? kids.length);
          }
          return out;
        });
        if (opts.nullData) return { data: null, count: null, error: null };
        return { data: options?.head ? null : rows, count: options?.count ? rows.length : null, error: null };
      };
      const query: Record<string, unknown> = {
        eq: (column: string, value: unknown) => { add(column, col => row => row[col] === value); return query; },
        gte: (column: string, value: string) => { add(column, col => row => row[col] != null && String(row[col]) >= value); return query; },
        // NOT (col IS value)：SQL と同じく NULL は「true ではない」側に入る。
        not: (column: string, op: string, value: unknown) => {
          if (op !== 'is') throw new Error(`unsupported not-filter ${op}`);
          add(column, col => row => !(value === null ? row[col] == null : row[col] === value));
          return query;
        },
        limit: (count: number, limitOptions?: { referencedTable?: string }) => {
          if (!limitOptions?.referencedTable) throw new Error('top-level limit is not expected here');
          childLimits[limitOptions.referencedTable] = count;
          return query;
        },
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

// 2026-10-22T15:30Z は日本時間で 10月23日 00:30。UTC の日付（22日）ではなく JST の今日（23日）で切る。
const NOW = new Date('2026-10-22T15:30:00Z');
const F = 'f1';
function seed(): Record<string, Row[]> {
  return {
    facility_profiles: [{
      id: F, name: '合成店舗', slug: 'synthetic-shop', prefecture: '東京都', city: '渋谷区', address: '合成1-1', catch_copy: '駅チカ3分',
      description: '施術で必ず治る', business_hours: CONFIRMED_HOURS, status: 'draft',
    }],
    facility_menus: [
      { facility_id: F, is_published: true }, { facility_id: F, is_published: null },
      { facility_id: F, is_published: false }, { facility_id: 'other', is_published: true },
    ],
    staff_profiles: [
      { id: 's-active', facility_id: F, is_active: true }, { id: 's-new', facility_id: F, is_active: true },
      { id: 's-special', facility_id: F, is_active: true }, { id: 's-holiday', facility_id: F, is_active: true },
      { id: 's-yesterday', facility_id: F, is_active: true }, { id: 's-timeless', facility_id: F, is_active: true },
      { id: 's-paused', facility_id: F, is_active: false }, { id: 's-other', facility_id: 'other', is_active: true },
    ],
    facility_photos: [{ facility_id: F }, { facility_id: 'other' }],
    staff_schedules: [
      { staff_id: 's-active', day_of_week: 1, start_time: '10:00:00', end_time: '19:00:00' },
      { staff_id: 's-active', day_of_week: 2, start_time: '10:00:00', end_time: '19:00:00' },
      { staff_id: 's-paused', day_of_week: 1, start_time: '10:00:00', end_time: '19:00:00' },
      { staff_id: 's-other', day_of_week: 1, start_time: '10:00:00', end_time: '19:00:00' },
    ],
    schedule_overrides: [
      // 週間の勤務日は無いが、JST の今日に勤務する特別日がある → 予約を受けられる
      { staff_id: 's-special', date: '2026-10-23', is_holiday: false, start_time: '10:00:00', end_time: '15:00:00' },
      // 休みの特別日・時刻の無い特別日・過ぎた日（UTC ではまだ今日だが JST では昨日）は勤務ではない
      { staff_id: 's-holiday', date: '2026-10-30', is_holiday: true, start_time: null, end_time: null },
      { staff_id: 's-timeless', date: '2026-10-30', is_holiday: null, start_time: null, end_time: null },
      { staff_id: 's-yesterday', date: '2026-10-22', is_holiday: false, start_time: '10:00:00', end_time: '15:00:00' },
    ],
  };
}

describe('loadFacilitySetupFacts', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate'] });
  });
  afterEach(() => jest.useRealTimers());

  test('公開メニュー・有効スタッフだけを数え、勤務時間（週間の勤務日か今後の勤務する特別日）の無い有効スタッフを特定する', async () => {
    const { client } = fakeClient(seed());
    expect(await loadFacilitySetupFacts(client, F)).toEqual({
      name: '合成店舗', slug: 'synthetic-shop', prefecture: '東京都', city: '渋谷区', address: '合成1-1',
      catchCopy: '駅チカ3分', description: '施術で必ず治る', status: 'draft',
      businessHours: CONFIRMED_HOURS,
      publishedMenuCount: 2, // 下書き（is_published=false）と他店舗は数えない
      photoCount: 1,
      activeStaffIds: ['s-active', 's-new', 's-special', 's-holiday', 's-yesterday', 's-timeless'], // 休止中・他店舗は数えない
      // 追加しただけ・休みの特別日だけ・昨日（JST）の特別日だけ・時刻の無い特別日だけのスタッフ
      unscheduledStaffIds: ['s-new', 's-holiday', 's-yesterday', 's-timeless'],
    });
  });

  test('施設紹介の禁止表現は、公開ゲートと同じく「表現」の未完了として出る', async () => {
    const { client } = fakeClient(seed());
    expect(pending(await loadFacilitySetupFacts(client, F))).toEqual(['pr_text', 'publish']);
  });

  test('特別日だけ勤務するスタッフしかいなくても、予約を受けられるスタッフとして数える', async () => {
    const tables = seed();
    tables.staff_profiles = tables.staff_profiles.filter(row => row.id === 's-special');
    const { client } = fakeClient(tables);
    const loaded = await loadFacilitySetupFacts(client, F);
    expect(loaded.unscheduledStaffIds).toEqual([]);
    expect(pending(loaded)).toEqual(['pr_text', 'publish']);
  });

  // 2026年10月23日: 勤務時間はあるが、どれも営業時間（月〜土 10:00-20:00・日曜定休）と重ならない。
  // 予約枠は営業時間の中にしか出ないので、予約を受けられるスタッフとして数えない。
  test('営業時間の外・定休日にしか勤務が無いスタッフしかいなければ、スタッフ（ネット予約）は未完了', async () => {
    const tables = seed();
    tables.staff_profiles = [{ id: 's-off', facility_id: F, is_active: true }];
    tables.staff_schedules = [
      { staff_id: 's-off', day_of_week: 0, start_time: '10:00:00', end_time: '19:00:00' }, // 日曜は定休日
      { staff_id: 's-off', day_of_week: 1, start_time: '07:00:00', end_time: '10:00:00' }, // 開店前に終わる
    ];
    tables.schedule_overrides = [];
    const { client } = fakeClient(tables);
    const loaded = await loadFacilitySetupFacts(client, F);
    expect(loaded.unscheduledStaffIds).toEqual(['s-off']);
    expect(pending(loaded)).toEqual(['pr_text', 'publish', 'staff']);
  });

  test('追加しただけのスタッフしかいなければ、スタッフ（ネット予約）は未完了', async () => {
    const tables = seed();
    tables.staff_profiles = tables.staff_profiles.filter(row => row.id === 's-new');
    const { client } = fakeClient(tables);
    expect(pending(await loadFacilitySetupFacts(client, F))).toEqual(['pr_text', 'publish', 'staff']);
  });

  test('下書きメニューだけ・休止中スタッフだけの店舗は、それぞれ未完了になる', async () => {
    const tables = seed();
    tables.facility_profiles[0].description = null;
    tables.facility_menus = [{ facility_id: F, is_published: false }];
    tables.staff_profiles = [{ id: 's-paused', facility_id: F, is_active: false }];
    const { client } = fakeClient(tables);
    expect(pending(await loadFacilitySetupFacts(client, F))).toEqual(['publish', 'menu', 'staff']);
  });

  test('読み取りはすべて渡された関数を通る（ページの時間制限つき読み取り）', async () => {
    const { client } = fakeClient(seed());
    const labels: string[] = [];
    await loadFacilitySetupFacts(client, F, (label, query) => { labels.push(label); return Promise.resolve(query); });
    expect(labels.sort()).toEqual(['facility', 'menus', 'photos', 'staff']);
  });

  test.each(['facility_menus', 'staff_profiles', 'staff_schedules', 'schedule_overrides', 'facility_photos', 'facility_profiles'])(
    '%s を読めなければ例外にする（未設定・0件に偽装しない）', async (table) => {
      const { client } = fakeClient(seed(), { [table]: { message: `${table} down` } });
      await expect(loadFacilitySetupFacts(client, F)).rejects.toThrow(`店舗セットアップの状況を取得できませんでした: ${table} down`);
    });

  test('件数・行が null でも 0・空として扱う（行の無い店舗）', async () => {
    const { client } = fakeClient(seed(), {}, { nullData: true });
    expect(await loadFacilitySetupFacts(client, F)).toEqual({
      name: null, slug: null, prefecture: null, city: null, address: null, catchCopy: null, description: null,
      status: null, businessHours: null, publishedMenuCount: 0, photoCount: 0, activeStaffIds: [], unscheduledStaffIds: [],
    });
  });
});

describe('setupGuideSteps（/admin/manual の初期設定）', () => {
  test('チェックリストと同じ項目・同じ順・同じ見出し・同じ区分で、全項目に手順がある', () => {
    const guide = setupGuideSteps();
    expect(guide.map(({ key, label, group }) => ({ key, label, group })))
      .toEqual(facilitySetupSteps(facts()).map(({ key, label, group }) => ({ key, label, group })));
    for (const step of guide) {
      expect(step.howto).toBe(SETUP_STEP_HOWTO[step.key]);
      expect(step.howto.length).toBeGreaterThan(10);
    }
  });

  test('写真は1枚以上（ネット予約の判定と同じ）。以前のマニュアルの「5枚以上」「公開設定」を書かない', () => {
    const text = setupGuideSteps().map((step) => step.howto).join('\n');
    expect(SETUP_STEP_HOWTO.photo).toContain('1枚以上');
    expect(text).not.toMatch(/5枚以上|公開設定|公開中」に変更/);
  });
});
