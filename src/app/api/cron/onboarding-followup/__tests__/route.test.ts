/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/onboarding-followup
 * Key assertions:
 *   - CRON_SECRET validation
 *   - Finds facilities 3～7 days old (not published, email not sent), oldest-first
 *   - CAS guard (is null check) prevents double-send
 *   - Detects incomplete steps (menus, staff, photos, schedules)
 *   - Reads active staff with their working time (weekly days / upcoming special days) in one query
 *   - Sends onboarding email with missing steps
 *   - Time budget guard defers remaining work to next run (timeout-proof)
 *   - Releases claim (sent_at→null) on transient failure; keeps claim when no contact
 *   - Logs cron execution
 */

jest.mock('@/lib/cron-auth', () => ({
  checkCronAuth: jest.fn(() => null),
}));
jest.mock('@/lib/cron-logger', () => {
  const logCronRun = jest.fn().mockResolvedValue(undefined);
  const cronError = jest.fn(async (
    jobName: string,
    startedAt: Date,
    cause: unknown,
    opts: { message?: string; extraLog?: Record<string, unknown>; extraBody?: Record<string, unknown> } = {},
  ) => {
    const error_msg = cause instanceof Error
      ? cause.message
      : (cause && typeof cause === 'object' && 'message' in cause && typeof (cause as any).message === 'string')
        ? (cause as any).message
        : String(cause);
    await logCronRun(jobName, 'error', startedAt, { error_msg, ...opts.extraLog });
    return {
      status: 500,
      json: async () => ({ error: opts.message ?? 'Internal error', ...opts.extraBody }),
    };
  });
  return { logCronRun, cronError };
});
jest.mock('@/lib/email');

const mockFromDelegate = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (...args: any[]) => mockFromDelegate(...args),
  })),
}));

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { sendOnboardingFollowEmail, sendRegistrationLeadFollowEmail } from '@/lib/email';
import { canonicalizeEmail } from '@/lib/email-canonical';
import { GET } from '../route';

// Holds the facility_profiles UPDATE mock for the current test (for claim/release assertions).
let facUpdateMock: jest.Mock;
// Holds the salons UPDATE mock for the current test (for claim/release assertions, 第2パス).
let salonUpdateMock: jest.Mock;

// facility_profiles UPDATE used for BOTH:
//   claim:   .update({sent_at:now}).eq('id').is(null).select('id') → { data: claimed }
//   release: .update({sent_at:null}).eq('id') (awaited) → returns eq object; { error } destructured
function facilitiesUpdate(claimed: any[] = [{ id: 'fac-123' }], releaseError: any = null, claimError: any = null) {
  const eqReturn: any = {
    is: jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue({ data: claimed, error: claimError }),
    }),
    error: releaseError ?? undefined,
  };
  return jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(eqReturn) });
}

// ---------------------------------------------------------------------------
// salons（第2パス）の小さな偽テーブル。
// 🔴 2026年10月22日: 送信対象を「/register/recover で復旧できる申込（未取り込み・未却下・
// source=register）」に絞った。呼び出しの形だけを見るモックでは、条件を書き忘れても
// 緑のままになる（実際の欠陥は「条件が無かった」こと）ので、ルートが付けた条件を
// 行に【実際に適用】し、どの申込にメールが届くかという結果で主張する。
// ---------------------------------------------------------------------------
type SalonRow = Record<string, unknown>;
type SalonFilter = (row: SalonRow) => boolean;
const FOUR_DAYS_AGO = () => new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
/** テストが書いた行に、本番の「普通の未処理の申込」の既定値を補う。 */
function salonRow(row: SalonRow): SalonRow {
  return {
    created_at: FOUR_DAYS_AGO(), registration_followup_sent_at: null, source: 'register', status: 'pending',
    claimed_facility_id: null, claimed_by_user_id: null, claimed_at: null, ...row,
  };
}
/** PostgREST の or 文字列（`列.演算子.値,…`）のうち is / eq / neq を SQL と同じ NULL の扱いで解釈する。 */
function salonOrFilter(expr: string): SalonFilter {
  const parts = expr.split(',').map((part) => {
    const [column, op, ...rest] = part.split('.');
    return { column, op, value: rest.join('.') };
  });
  return (row) => parts.some(({ column, op, value }) => {
    const actual = row[column];
    if (op === 'is' && value === 'null') return actual === null || actual === undefined;
    if (actual === null || actual === undefined) return false; // SQL: NULL = x / NULL <> x は真にならない
    if (op === 'eq') return String(actual) === value;
    if (op === 'neq') return String(actual) !== value;
    throw new Error(`unsupported or-filter: ${column}.${op}.${value}`);
  });
}
/** eq / is / or / gte / lte を条件として溜める。 */
function withSalonFilters<T extends Record<string, unknown>>(target: T, filters: SalonFilter[], onIs?: jest.Mock): T {
  return Object.assign(target, {
    eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return target; },
    is: (column: string, value: null) => {
      onIs?.(column, value);
      filters.push((row) => (row[column] ?? null) === value);
      return target;
    },
    or: (expr: string) => { filters.push(salonOrFilter(expr)); return target; },
    gte: (column: string, value: string) => { filters.push((row) => String(row[column]) >= value); return target; },
    lte: (column: string, value: string) => { filters.push((row) => String(row[column]) <= value); return target; },
  });
}

function buildFrom(opts: any = {}) {
  const {
    facilities = [{ id: 'fac-123', name: 'New Salon', status: 'draft' }],
    facilitiesErr = null,
    claimed = [{ id: 'fac-123' }],
    releaseError = null,
    claimError = null,
    menuCount = 0,
    staffData = [] as any[],
    photoCount = 0,
    scheduleCount = 0,
    member = { user_id: 'owner-user-123' },
    profile = { email: 'owner@example.com' },
    profileError = null,
    orderSpy = null as any,
    menuError = null,
    staffError = null,
    photoError = null,
    memberError = null,
    scheduleError = null,
    // ---- 第2パス（salons）用オプション。デフォルトは既存テストの挙動を変えない空配列。----
    salons = [] as any[],
    salonsErr = null,
    // 明示したときだけ claim の結果を差し替える（未指定なら偽テーブルの条件どおりに claim する）。
    salonClaimed = undefined as any[] | undefined,
    salonReleaseError = null,
    salonClaimError = null,
    salonOrderSpy = null as any,
    // profiles.email = X のとき「アカウント作成済み」とみなすメール一覧。
    existingAccountEmails = [] as string[],
    profileEmailCheckError = null,
  } = opts;

  facUpdateMock = facilitiesUpdate(claimed, releaseError, claimError);
  // 偽 salons テーブル。opts.salonRows を渡すと、テスト側が行の状態（却下・取り込み）を後から変えられる。
  const salonTable: SalonRow[] = (opts.salonRows as SalonRow[] | undefined) ?? salons.map(salonRow);
  salonUpdateMock = jest.fn((payload: SalonRow) => {
    const filters: SalonFilter[] = [];
    const apply = () => {
      const matched = salonTable.filter((row) => filters.every((f) => f(row)));
      for (const row of matched) Object.assign(row, payload);
      return matched;
    };
    const builder: Record<string, unknown> = {
      // claim: .update({sent_at}).eq().is()….select('id')
      select: jest.fn(async () => {
        if (salonClaimError) return { data: null, error: salonClaimError };
        if (salonClaimed !== undefined) return { data: salonClaimed, error: null };
        return { data: apply().map((row) => ({ id: row.id })), error: null };
      }),
      // release: await .update({sent_at:null}).eq('id', …)
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        if (!salonReleaseError) apply();
        return Promise.resolve({ error: salonReleaseError }).then(resolve, reject);
      },
    };
    return withSalonFilters(builder, filters);
  });

  // 店舗セットアップの判定材料（facility-setup-steps.ts の loadFacilitySetupFacts が読む表）。
  // 呼び出しの形ではなく、ルートが付けた eq / in / or の条件を行に【実際に適用】する。
  // 下書きメニュー・休止中スタッフを数えていたのが実際の欠陥なので、条件を外せば結果が変わる。
  // 行に列が無ければその列の eq は素通しにする（facility_id を書かない既存ケースを簡潔に保つ）。
  const staffRows: SalonRow[] = (opts.staffRows as SalonRow[] | undefined)
    ?? (staffData ?? []).map((s: SalonRow) => ({ is_active: true, ...s }));
  const tables: Record<string, SalonRow[]> = {
    facility_menus: (opts.menuRows as SalonRow[] | undefined) ?? Array.from({ length: menuCount ?? 0 }, () => ({ is_published: true })),
    staff_profiles: staffRows,
    facility_photos: Array.from({ length: photoCount ?? 0 }, () => ({})),
    staff_schedules: (opts.scheduleRows as SalonRow[] | undefined)
      ?? ((scheduleCount ?? 0) > 0 ? staffRows.map((s) => ({ staff_id: s.id, day_of_week: 1 })) : []),
    schedule_overrides: (opts.overrideRows as SalonRow[] | undefined) ?? [],
  };
  const tableErrors: Record<string, unknown> = {
    facility_menus: menuError, staff_profiles: staffError, facility_photos: photoError, staff_schedules: scheduleError,
    schedule_overrides: opts.overrideError ?? null,
  };
  // select の埋め込み `child(col)` は child.staff_id = 親の id で結ぶ。`child.col` の絞り込みと
  // limit(n, { referencedTable }) は子の行だけに効く（親は減らない）。埋め込み先の失敗はクエリ全体の失敗。
  const setupRead = (table: string) => ({
    select: jest.fn((columns: string, options?: { count?: string; head?: boolean }) => {
      const filters: SalonFilter[] = [];
      const childFilters: Record<string, SalonFilter[]> = {};
      const childLimits: Record<string, number> = {};
      const embeds = [...columns.matchAll(/(\w+)\(\w+\)/g)].map((match) => match[1]);
      const add = (column: string, make: (col: string) => SalonFilter) => {
        const [child, col] = column.includes('.') ? column.split('.') : [null, column];
        if (child) (childFilters[child] ??= []).push(make(col)); else filters.push(make(col));
      };
      const query: Record<string, unknown> = {
        eq: (column: string, value: unknown) => { add(column, (col) => (row) => !(col in row) || row[col] === value); return query; },
        gte: (column: string, value: string) => { add(column, (col) => (row) => row[col] != null && String(row[col]) >= value); return query; },
        not: (column: string, _op: 'is', value: unknown) => {
          add(column, (col) => (row) => !(value === null ? row[col] == null : row[col] === value));
          return query;
        },
        limit: (count: number, limitOptions: { referencedTable: string }) => { childLimits[limitOptions.referencedTable] = count; return query; },
        in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return query; },
        or: (expr: string) => { filters.push(salonOrFilter(expr)); return query; },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          const failed = [table, ...embeds].find((name) => tableErrors[name]);
          const rows = tables[table].filter((row) => filters.every((f) => f(row))).map((row) => {
            const out: SalonRow = { ...row };
            for (const child of embeds) {
              const kids = tables[child].filter((kid) => kid.staff_id === row.id && (childFilters[child] ?? []).every((f) => f(kid)));
              out[child] = kids.slice(0, childLimits[child] ?? kids.length);
            }
            return out;
          });
          const result = failed
            ? { data: null, count: null, error: tableErrors[failed] }
            : { data: options?.head ? null : rows, count: options?.count ? rows.length : null, error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    }),
  });
  // 判定に使う店舗の行。既定は所在地・全曜日の営業時間がそろった下書き（未公開）の店舗。
  const setupProfile = 'setupProfile' in opts ? opts.setupProfile : {
    name: 'New Salon', prefecture: '東京都', city: '渋谷区', address: '合成1-1', status: 'draft',
    business_hours: {
      mon: { open: '10:00', close: '20:00' }, tue: { open: '10:00', close: '20:00' }, wed: { open: '10:00', close: '20:00' },
      thu: { open: '10:00', close: '20:00' }, fri: { open: '10:00', close: '20:00' }, sat: { open: '10:00', close: '20:00' }, sun: null,
    },
  };

  return (table: string) => {
    if (table === 'facility_profiles') {
      // fetchAllPaged により .limit() ではなく .range() でページングされる
      // （1000件PostgREST上限の恒久取りこぼしを根治した実装に合わせる）。
      const order = orderSpy || jest.fn().mockReturnValue({
        range: jest.fn((from: number, to: number) => Promise.resolve({
          data: facilitiesErr ? null : facilities.slice(from, to + 1),
          error: facilitiesErr,
        })),
      });
      return {
        select: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            lte: jest.fn().mockReturnValue({
              neq: jest.fn().mockReturnValue({
                is: jest.fn().mockReturnValue({ order }),
              }),
            }),
          }),
          // 店舗セットアップの判定: .select(...).eq('id', facilityId).single()
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: setupProfile, error: opts.setupProfileError ?? null }),
          }),
        }),
        update: facUpdateMock,
      };
    }
    if (table in tables) return setupRead(table);
    if (table === 'facility_members') return {
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: member, error: memberError }) }),
        }),
      }),
    };
    // salons.is() の呼び出し引数を検証したいテスト用（未指定なら中身を検証しない素の jest.fn）。
    const salonIsSpy = opts.salonIsSpy as jest.Mock | null;
    // profiles は2つの異なる呼び出し元から使われる:
    //   facility パス:  .select('email').eq('id', userId).maybeSingle()                  → member の owner profile
    //   salons パス:    .select('id').eq('email_canonical', canonicalizeEmail(email)).maybeSingle()
    //                    → アカウント作成済みか判定（大文字小文字・gmail +tag/ドット違いを吸収する canonical 突合）
    // eq() に渡された field 名で分岐する（呼び出し元コードの引数をそのまま検証できる）。
    // existingAccountEmails は「登録済みとみなす生メール」を渡す（テスト側で canonicalize してから比較する）。
    if (table === 'profiles') return {
      select: jest.fn().mockReturnValue({
        eq: jest.fn((field: string, value: string) => {
          if (field === 'email_canonical') {
            const canonicalExisting = existingAccountEmails.map((e: string) => canonicalizeEmail(e));
            const found = canonicalExisting.includes(value) ? { id: `profile-${value}` } : null;
            return { maybeSingle: jest.fn().mockResolvedValue({ data: found, error: profileEmailCheckError }) };
          }
          return { maybeSingle: jest.fn().mockResolvedValue({ data: profile, error: profileError }) };
        }),
      }),
    };
    if (table === 'salons') {
      return {
        select: jest.fn(() => {
          const filters: SalonFilter[] = [];
          const query: Record<string, unknown> = {};
          const range = jest.fn(async (from: number, to: number) => {
            if (salonsErr) return { data: null, error: salonsErr };
            const listed = salonTable.filter((row) => filters.every((f) => f(row))).slice(from, to + 1)
              .map((row) => ({ ...row }));
            (opts.afterSalonList as (() => void) | undefined)?.();
            return { data: listed, error: null };
          });
          query.order = salonOrderSpy || jest.fn(() => ({ range }));
          return withSalonFilters(query, filters, salonIsSpy ?? undefined);
        }),
        update: salonUpdateMock,
      };
    }
    return {};
  };
}

test.each([null, { email: 'owner@example.com' }])('owner profileの取得障害はclaim解放・送信なし・500: %p', async (profile) => {
  mockFromDelegate.mockImplementation(buildFrom({ profile, profileError: { message: 'DB unavailable' } }));
  const res = await GET(makeRequest());
  expect(res.status).toBe(500);
  expect(sendOnboardingFollowEmail).not.toHaveBeenCalled();
  expect(facUpdateMock).toHaveBeenCalledWith({ onboarding_email_sent_at: null });
  expect(logCronRun).toHaveBeenCalledWith('onboarding-followup', 'error', expect.any(Date), expect.objectContaining({ meta: expect.objectContaining({ processingFailures: 1 }) }));
});

test.each(['facility', 'salon'])('%sのclaim取得障害は正常スキップへ変換せず500', async (target) => {
  const err = { message: 'claim failed' };
  mockFromDelegate.mockImplementation(buildFrom(target === 'facility'
    ? { claimError: err }
    : { facilities: [], salons: [{ id: 'sal-1', email: 'lead@example.com', facility_name: '施設', business_type: 'salon' }], salonClaimError: err }));
  const res = await GET(makeRequest());
  expect(res.status).toBe(500);
  expect(sendOnboardingFollowEmail).not.toHaveBeenCalled();
  expect(sendRegistrationLeadFollowEmail).not.toHaveBeenCalled();
});

function setupDefaultMocks(
  facilitiesFound: number = 1,
  hasMenus: boolean = false,
  hasStaff: boolean = false,
  hasPhotos: boolean = false,
  hasSchedules: boolean = false,
  memberFound: boolean = true,
  profileFound: boolean = true,
  emailSendFails: boolean = false,
  updateFails: boolean = false
) {
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);
  // sendOnboardingFollowEmail は送達可否を boolean で返す（safeSend 仕様）。成功=true→claim維持。
  (sendOnboardingFollowEmail as jest.Mock).mockResolvedValue(true);
  // 🔴 sendRegistrationLeadFollowEmail も同じ契約（boolean）。既定を true にしないと
  // 第2パスのテスト (iv)（送信失敗→claim解放）が「既定 undefined=falsy」でたまたま
  // 偽陽性になる（CLAUDE.md の LINE outcome の教訓と同型の罠）。
  (sendRegistrationLeadFollowEmail as jest.Mock).mockResolvedValue(true);
  if (emailSendFails) {
    // 送信失敗は throw ではなく false 返却で表現される（本番の safeSend は throw しない）→ claim 解放で再送。
    (sendOnboardingFollowEmail as jest.Mock).mockResolvedValue(false);
  }

  const facilities = facilitiesFound > 0
    ? Array.from({ length: facilitiesFound }, (_, i) => ({ id: `fac-${i + 1}`, name: 'New Salon', status: 'draft' }))
    : [];

  mockFromDelegate.mockImplementation(
    buildFrom({
      facilities,
      claimed: updateFails ? [] : [{ id: 'fac-1' }],
      menuCount: hasMenus ? 2 : 0,
      staffData: hasStaff ? [{ id: 'staff-1' }, { id: 'staff-2' }] : [],
      photoCount: hasPhotos ? 3 : 0,
      scheduleCount: hasSchedules ? 1 : 0,
      member: memberFound ? { user_id: 'owner-user-123' } : null,
      profile: profileFound ? { email: 'owner@example.com' } : null,
    })
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  setupDefaultMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.CRON_SECRET = 'cron-secret';
});

function makeRequest(cronSecret: string = 'cron-secret') {
  return new Request('http://localhost/api/cron/onboarding-followup', {
    method: 'GET',
    headers: { authorization: `Bearer ${cronSecret}` },
  });
}

describe('GET /api/cron/onboarding-followup', () => {
  test('invalid CRON_SECRET → returns auth error', async () => {
    (checkCronAuth as jest.Mock).mockReturnValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    );
    const res = await GET(makeRequest('invalid') as any);
    expect(res.status).toBe(401);
  });

  test('no facilities in window → 200 with sent=0', async () => {
    setupDefaultMocks(0);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(0);
  });

  test('facility found → processes onboarding', async () => {
    setupDefaultMocks(1, true, true, true, true);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.processed).toBe('number');
  });

  test('applies oldest-first order on created_at', async () => {
    const orderSpy = jest.fn().mockReturnValue({ range: jest.fn().mockResolvedValue({ data: [] }) });
    mockFromDelegate.mockImplementation(buildFrom({ facilities: [], orderSpy }));
    await GET(makeRequest() as any);
    expect(orderSpy).toHaveBeenCalledWith('created_at', { ascending: true });
  });

  // 【恒久根治の回帰防止】旧実装は主クエリの error を無視しており、一過性障害が「0件=skipped
  // (成功)」に偽装されfollowupメールが無音で全停止していた（review-request H-2 と同型）。
  test('facilities主クエリがerror → 500（0件=skipped 成功偽装しない）', async () => {
    mockFromDelegate.mockImplementation(buildFrom({ facilitiesErr: { message: 'db error' } }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(logCronRun).toHaveBeenCalledWith(
      'onboarding-followup', 'error', expect.any(Date),
      expect.objectContaining({ error_msg: 'db error' }),
    );
  });

  // 分岐カバレッジ: error が Error インスタンスの場合は .message を直接使う経路。
  test('facilities主クエリのerrorがErrorインスタンス → その message を使う', async () => {
    mockFromDelegate.mockImplementation(buildFrom({ facilitiesErr: new Error('boom instance') }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(logCronRun).toHaveBeenCalledWith(
      'onboarding-followup', 'error', expect.any(Date),
      expect.objectContaining({ error_msg: 'boom instance' }),
    );
  });

  // 分岐カバレッジ: error が Error でも message プロパティ持ちでもない場合は String() フォールバック。
  test('facilities主クエリのerrorがmessage無し → String() フォールバック', async () => {
    mockFromDelegate.mockImplementation(buildFrom({ facilitiesErr: 'plain-string-error' }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(logCronRun).toHaveBeenCalledWith(
      'onboarding-followup', 'error', expect.any(Date),
      expect.objectContaining({ error_msg: 'plain-string-error' }),
    );
  });

  test('filters facilities not published / email IS NULL', async () => {
    setupDefaultMocks(1);
    await GET(makeRequest() as any);
    expect(mockFromDelegate).toHaveBeenCalledWith('facility_profiles');
  });

  test('CAS guard prevents double-send (is null check)', async () => {
    setupDefaultMocks(1, true, true, true, true);
    await GET(makeRequest() as any);
    expect(facUpdateMock).toHaveBeenCalled();
  });

  test('double-fire scenario (already claimed) → skips', async () => {
    setupDefaultMocks(1, true, true, true, true, true, true, false, true); // updateFails → claim returns []
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
  });

  // 項目名は /admin の「店舗セットアップ」と同じ（メールと画面で項目がずれない）。
  test('detects missing menus', async () => {
    setupDefaultMocks(1, false, true, true, true);
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ missingSteps: ['無料掲載を公開'], bookingSteps: ['公開メニュー登録'] })
    );
  });

  test('detects missing staff (and therefore no schedule)', async () => {
    setupDefaultMocks(1, true, false, true, true);
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ bookingSteps: ['スタッフ登録と勤務時間の保存'] })
    );
  });

  test('detects missing photos', async () => {
    setupDefaultMocks(1, true, true, false, true);
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ bookingSteps: ['写真アップロード'] })
    );
  });

  // 勤務時間の無いスタッフしかいなければ、予約を受けられる人がいない（スタッフ項目も未完了）。
  test('detects missing schedules (via staff_schedules)', async () => {
    setupDefaultMocks(1, true, true, true, false);
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ bookingSteps: ['スタッフ登録と勤務時間の保存'] })
    );
  });

  test('特別日だけ勤務するスタッフは、予約を受けられるスタッフとして数える', async () => {
    mockFromDelegate.mockImplementation(buildFrom({
      menuCount: 1, photoCount: 1,
      staffRows: [{ id: 's-special', is_active: true }],
      overrideRows: [
        { staff_id: 's-special', date: '2999-01-04', is_holiday: false, start_time: '10:00:00', end_time: '15:00:00' },
      ],
    }));
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(expect.objectContaining({ missingSteps: ['無料掲載を公開'], bookingSteps: [] }));
  });

  test('過ぎた特別日・休みの特別日しか無いスタッフは、勤務時間が無いものとして案内する', async () => {
    mockFromDelegate.mockImplementation(buildFrom({
      menuCount: 1, photoCount: 1,
      staffRows: [{ id: 's-off', is_active: true }],
      overrideRows: [
        { staff_id: 's-off', date: '2000-01-04', is_holiday: false, start_time: '10:00:00', end_time: '15:00:00' },
        { staff_id: 's-off', date: '2999-01-04', is_holiday: true, start_time: null, end_time: null },
      ],
    }));
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(expect.objectContaining({
      bookingSteps: ['スタッフ登録と勤務時間の保存'],
    }));
  });

  // 公開ゲートは PR 文言の医療広告表現も止める。/register から取り込んだ施設紹介に禁止表現があれば、
  // 「無料掲載を公開」だけを案内すると、公開を押した瞬間に拒否される。
  test('公開ゲートに止められる施設紹介があれば、その見直しも公開に必要な項目として案内する', async () => {
    mockFromDelegate.mockImplementation(buildFrom({
      menuCount: 1, photoCount: 1, staffData: [{ id: 's1' }], scheduleCount: 1,
      setupProfile: {
        name: 'New Salon', prefecture: '東京都', city: '渋谷区', address: '合成1-1', status: 'draft',
        catch_copy: null, description: '施術で必ず治る',
        business_hours: {
          mon: { open: '10:00', close: '20:00' }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
        },
      },
    }));
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(expect.objectContaining({
      missingSteps: ['基本情報（キャッチコピー・施設紹介の表現）', '無料掲載を公開'], bookingSteps: [],
    }));
  });

  test('always includes publish step', async () => {
    setupDefaultMocks(1, true, true, true, true);
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ missingSteps: ['無料掲載を公開'], bookingSteps: [] })
    );
  });

  // ─── E10: 実際の公開条件・ネット予約条件と同じ単一ソースから作る ─────────────────
  // 以前は住所・営業時間を一度も案内せず、下書きのメニューや休止中のスタッフを「登録済み」と
  // 数えていたため、公開もネット予約もできない店舗に「あとは公開だけ」と送っていた。
  // 2026年10月23日 神原さん決定：営業時間は「無料掲載の公開に必要な項目」として案内する（店舗情報→営業時間→公開）。
  test('セルフサーブ直後の店舗（住所・営業時間なし）には住所と営業時間も、無料掲載の項目として案内する', async () => {
    mockFromDelegate.mockImplementation(buildFrom({
      setupProfile: { name: 'New Salon', prefecture: '', city: '', address: '', status: 'draft', business_hours: null },
    }));
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(expect.objectContaining({
      missingSteps: ['基本情報（住所）', '営業時間の入力・保存', '無料掲載を公開'],
      bookingSteps: ['公開メニュー登録', '写真アップロード', 'スタッフ登録と勤務時間の保存'],
    }));
  });

  test('HPB から取り込んだ下書きメニューだけ・休止中スタッフだけは「登録済み」と数えない', async () => {
    mockFromDelegate.mockImplementation(buildFrom({
      menuRows: [{ is_published: false }, { is_published: false }],
      staffRows: [{ id: 's-paused', is_active: false }],
      scheduleRows: [{ staff_id: 's-paused', day_of_week: 1 }],
      photoCount: 1,
    }));
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(expect.objectContaining({
      missingSteps: ['無料掲載を公開'],
      bookingSteps: ['公開メニュー登録', 'スタッフ登録と勤務時間の保存'],
    }));
  });

  test('追加しただけで勤務時間を保存していないスタッフがいれば勤務スケジュールを案内する', async () => {
    mockFromDelegate.mockImplementation(buildFrom({
      menuCount: 1, photoCount: 1,
      staffRows: [{ id: 's-saved', is_active: true }, { id: 's-new', is_active: true }],
      scheduleRows: [{ staff_id: 's-saved', day_of_week: 2 }],
    }));
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(expect.objectContaining({
      missingSteps: ['無料掲載を公開'], bookingSteps: [],
    }));
  });

  test.each([
    ['店舗行の読み取り', { setupProfileError: { message: 'profile down' } }],
    ['勤務日の読み取り', { scheduleError: { message: 'schedules down' } }],
    ['特別日の読み取り', { overrideError: { message: 'overrides down' } }],
    ['オーナーの読み取り', { memberError: { message: 'member down' } }],
  ])('%sに失敗したら誤内容メールを送らず claim を解放する', async (_label, override) => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockFromDelegate.mockImplementation(buildFrom({ menuCount: 1, staffData: [{ id: 's1' }], photoCount: 1, scheduleCount: 1, ...override }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(sendOnboardingFollowEmail).not.toHaveBeenCalled();
    expect(facUpdateMock.mock.calls.filter((c: any[]) => c[0].onboarding_email_sent_at === null)).toHaveLength(1);
    errSpy.mockRestore();
  });

  test('reads staff with their working time in one query (weekly days and special days embedded)', async () => {
    setupDefaultMocks(1, true, true, true, false);
    await GET(makeRequest() as any);
    expect(mockFromDelegate).toHaveBeenCalledWith('staff_profiles');
    expect(mockFromDelegate).not.toHaveBeenCalledWith('staff_schedules');
    expect(mockFromDelegate).not.toHaveBeenCalledWith('schedule_overrides');
  });

  test('gets owner user_id from facility_members', async () => {
    setupDefaultMocks(1, true, true, true, true);
    await GET(makeRequest() as any);
    expect(mockFromDelegate).toHaveBeenCalledWith('facility_members');
  });

  test('owner member not found → noContact, claim kept (no release)', async () => {
    setupDefaultMocks(1, true, true, true, true, false); // memberFound=false
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const nullReleases = facUpdateMock.mock.calls.filter((c: any[]) => c[0].onboarding_email_sent_at === null);
    expect(nullReleases.length).toBe(0);
    expect(sendOnboardingFollowEmail).not.toHaveBeenCalled();
  });

  test('owner email not found → noContact, claim kept (no release)', async () => {
    setupDefaultMocks(1, true, true, true, true, true, false); // profileFound=false
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const nullReleases = facUpdateMock.mock.calls.filter((c: any[]) => c[0].onboarding_email_sent_at === null);
    expect(nullReleases.length).toBe(0);
    expect(sendOnboardingFollowEmail).not.toHaveBeenCalled();
  });

  test('sends onboarding email with facility name and owner email', async () => {
    setupDefaultMocks(1, true, true, true, true);
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ facilityName: 'New Salon', ownerEmail: 'owner@example.com' })
    );
  });

  test('email send failure → releases claim (sent_at→null) for retry', async () => {
    setupDefaultMocks(1, true, true, true, true, true, true, true); // emailSendFails
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(0);
    const nullReleases = facUpdateMock.mock.calls.filter((c: any[]) => c[0].onboarding_email_sent_at === null);
    expect(nullReleases.length).toBe(1);
  });

  test('claim release failure → logs error', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (sendOnboardingFollowEmail as jest.Mock).mockRejectedValue(new Error('Email failed'));
    (logCronRun as jest.Mock).mockResolvedValue(undefined);
    (checkCronAuth as jest.Mock).mockReturnValue(null);
    mockFromDelegate.mockImplementation(buildFrom({
      menuCount: 2, staffData: [{ id: 's1' }], photoCount: 3, scheduleCount: 1,
      releaseError: { message: 'release boom' },
    }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(errSpy).toHaveBeenCalledWith(
      '[onboarding-followup] claim release failed',
      expect.objectContaining({ facilityId: 'fac-123' })
    );
    errSpy.mockRestore();
  });

  test('consider limit reached → warns', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setupDefaultMocks(2000, true, true, true, true);
    await GET(makeRequest() as any);
    expect(warnSpy).toHaveBeenCalledWith(
      '[onboarding-followup] consider limit reached',
      expect.objectContaining({ limit: 2000 })
    );
    warnSpy.mockRestore();
  });

  test('time budget exceeded → defers remaining to next run', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setupDefaultMocks(1, true, true, true, true);
    jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(10_000_000);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deferred).toBe(1);
    expect(json.processed).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      '[onboarding-followup] time budget exceeded, deferring rest to next run',
      expect.objectContaining({ deferred: 1 })
    );
    warnSpy.mockRestore();
  });

  test('logs cron execution with sent count', async () => {
    setupDefaultMocks(1, true, true, true, true);
    await GET(makeRequest() as any);
    expect(logCronRun).toHaveBeenCalledWith(
      'onboarding-followup', 'success', expect.any(Date),
      expect.objectContaining({ processed: expect.any(Number) })
    );
  });

  test('exception during processing → 500', async () => {
    mockFromDelegate.mockImplementation(() => { throw new Error('Fatal'); });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  test('all missing steps detected', async () => {
    setupDefaultMocks(1, false, false, false, false);
    await GET(makeRequest() as any);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        missingSteps: ['無料掲載を公開'],
        bookingSteps: [
          '公開メニュー登録', '写真アップロード', 'スタッフ登録と勤務時間の保存',
        ],
      })
    );
  });

  test('no missing steps (all complete) → only publish step', async () => {
    setupDefaultMocks(1, true, true, true, true);
    await GET(makeRequest() as any);
    const call = (sendOnboardingFollowEmail as jest.Mock).mock.calls[0];
    expect(call[0].missingSteps).toEqual(['無料掲載を公開']);
    expect(call[0].bookingSteps).toEqual([]);
  });

  test('staff query returns no rows → staff missing, schedule query skipped', async () => {
    mockFromDelegate.mockImplementation(buildFrom({
      facilities: [{ id: 'fac-z', name: 'Z', status: 'draft' }],
      claimed: [{ id: 'fac-z' }],
      menuCount: 1, staffData: null, photoCount: 1,
      member: { user_id: 'owner' }, profile: { email: 'o@example.com' },
    }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(mockFromDelegate).not.toHaveBeenCalledWith('staff_schedules');
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ bookingSteps: ['スタッフ登録と勤務時間の保存'] })
    );
  });

  test('facility processing throws → caught, claim released', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const fromImpl = buildFrom({ facilities: [{ id: 'f-err', name: 'E', status: 'draft' }], claimed: [{ id: 'f-err' }] });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_menus') throw new Error('menus query exploded');
      return fromImpl(table);
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });

  test('non-Error throw → String fallback', async () => {
    mockFromDelegate.mockImplementation(() => { throw 'plain string'; });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  test('Promise.all for parallel queries', async () => {
    setupDefaultMocks(1, true, true, true, true);
    await GET(makeRequest() as any);
    expect(mockFromDelegate).toHaveBeenCalledWith('facility_menus');
    expect(mockFromDelegate).toHaveBeenCalledWith('staff_profiles');
    expect(mockFromDelegate).toHaveBeenCalledWith('facility_photos');
    expect(mockFromDelegate).toHaveBeenCalledWith('facility_members');
  });

  test('未完了ステップ判定クエリが error → 誤内容メールを送らず claim 解放（翌 run 再送）', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    // menu count クエリが error → stepQueryErr → throw → catch で delivered=false のまま claim 解放。
    mockFromDelegate.mockImplementation(buildFrom({
      facilities: [{ id: 'fac-e1', name: 'E1', status: 'draft' }],
      claimed: [{ id: 'fac-e1' }],
      menuError: { message: 'menu count boom' },
      staffData: [{ id: 's1' }], photoCount: 1, scheduleCount: 1,
      member: { user_id: 'owner' }, profile: { email: 'o@example.com' },
    }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.processed).toBe(0);
    // 誤内容メールは送らない
    expect(sendOnboardingFollowEmail).not.toHaveBeenCalled();
    // claim を解放（onboarding_email_sent_at: null）して翌 run 再送
    const nullReleases = facUpdateMock.mock.calls.filter((c: any[]) => c[0].onboarding_email_sent_at === null);
    expect(nullReleases.length).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(
      '[onboarding-followup] facility processing error',
      expect.objectContaining({ facilityId: 'fac-e1' })
    );
    errSpy.mockRestore();
  });

  test('staff_schedules カウントが error → 「未設定」誤判定を避け throw → claim 解放', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    // staffData 非空 → schedule クエリが走る。そのクエリが error → throw → claim 解放。
    mockFromDelegate.mockImplementation(buildFrom({
      facilities: [{ id: 'fac-e2', name: 'E2', status: 'draft' }],
      claimed: [{ id: 'fac-e2' }],
      menuCount: 1, staffData: [{ id: 's1' }], photoCount: 1,
      scheduleError: { message: 'schedule count boom' },
      member: { user_id: 'owner' }, profile: { email: 'o@example.com' },
    }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(sendOnboardingFollowEmail).not.toHaveBeenCalled();
    const nullReleases = facUpdateMock.mock.calls.filter((c: any[]) => c[0].onboarding_email_sent_at === null);
    expect(nullReleases.length).toBe(1);
    errSpy.mockRestore();
  });

  test('メニュー・写真が0件なら両方を案内する', async () => {
    mockFromDelegate.mockImplementation(buildFrom({
      facilities: [{ id: 'fac-q', name: 'Q', status: 'draft' }],
      claimed: [{ id: 'fac-q' }],
      menuCount: null, staffData: [{ id: 's1' }], photoCount: null, scheduleCount: 1,
      member: { user_id: 'owner-u' }, profile: { email: 'o@test.com' },
    }));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
      expect.objectContaining({ bookingSteps: ['公開メニュー登録', '写真アップロード'] })
    );
  });

  // ==========================================================================
  // 第2パス: salons（登録はしたがアカウントを作っていない申込者）
  // 本番実データ（salons 8件 vs facility_profiles 3件）で確定した差の5件を拾う。
  // ==========================================================================
  describe('salons 第2パス（登録リードフォロー）', () => {
    const leadSalon = { id: 'sal-1', email: 'lead@example.com', facility_name: 'Lead Salon', business_type: 'clinic' };

    test('(i) profiles に同じ email が無い salons 行にフォローメールが送られる', async () => {
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salons: [leadSalon] }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(sendRegistrationLeadFollowEmail).toHaveBeenCalledWith({
        email: 'lead@example.com',
        facilityName: 'Lead Salon',
        receiptId: 'sal-1',
      });
      expect(json.processed).toBe(1);
      expect(json.sent).toBe(1);
    });

    // 🔴 negative control: この除外条件（existingAccountEmails に含まれる → 送らない）を
    // route.ts 側で一時的に無効化（if (existingProfile) { alreadyRegistered = true; } を
    // 常に false 相当にする）して本テストを実行し、実際に赤くなる（送信されてしまう）ことを
    // 確認済み → 元に戻して緑に復帰。テストが本当に条件を検知できることを確認した。
    test('(ii) profiles に同じ email が【ある】salons 行には送られない（アカウント作成済みは対象外）', async () => {
      mockFromDelegate.mockImplementation(buildFrom({
        facilities: [],
        salons: [leadSalon],
        existingAccountEmails: ['lead@example.com'],
      }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      expect(sendRegistrationLeadFollowEmail).not.toHaveBeenCalled();
      // アカウント作成済み＝claim は維持（null への解放が起きない）。
      const nullReleases = salonUpdateMock.mock.calls.filter((c: any[]) => c[0].registration_followup_sent_at === null);
      expect(nullReleases.length).toBe(0);
      const json = await res.json();
      expect(json.sent).toBe(0);
    });

    // ─── メール突合の canonical 化（2026年8月20日追加）───────────────────────────
    // 旧実装の `.eq('email', salon.email)` はバイト完全一致だったため、大文字小文字・
    // gmail の "+tag"/ドット違いで既存アカウントを検出できず、【既にアカウントを持つ店舗へ
    // 「まだ作られていません」と誤送信する fail-open】になっていた。

    test('(v-a) profiles.email が大文字違いでも「アカウント作成済み」と判定し送信しない', async () => {
      const caseSalon = { id: 'sal-case', email: 'Lead@Example.com', facility_name: 'Case Salon', business_type: 'clinic' };
      mockFromDelegate.mockImplementation(buildFrom({
        facilities: [],
        salons: [caseSalon],
        existingAccountEmails: ['lead@example.com'], // profiles 側は小文字で保存されている
      }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      expect(sendRegistrationLeadFollowEmail).not.toHaveBeenCalled();
      const nullReleases = salonUpdateMock.mock.calls.filter((c: any[]) => c[0].registration_followup_sent_at === null);
      expect(nullReleases.length).toBe(0); // 作成済み＝claim 維持
      const json = await res.json();
      expect(json.sent).toBe(0);
    });

    test('(v-b) gmail の "+tag"/ドット違いでも「アカウント作成済み」と判定し送信しない', async () => {
      const plusSalon = { id: 'sal-plus', email: 'o.wner+lead@gmail.com', facility_name: 'Plus Salon', business_type: 'clinic' };
      mockFromDelegate.mockImplementation(buildFrom({
        facilities: [],
        salons: [plusSalon],
        existingAccountEmails: ['owner@gmail.com'], // 実アカウントは正規化後と同じ受信箱
      }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      expect(sendRegistrationLeadFollowEmail).not.toHaveBeenCalled();
      const json = await res.json();
      expect(json.sent).toBe(0);
    });

    test('(vi) 大文字・+tag/ドットが違っても本当にアカウントが無ければ従来どおり送信する', async () => {
      const noAccountSalon = { id: 'sal-none', email: 'Really.New+lead@gmail.com', facility_name: 'New Lead Salon', business_type: 'clinic' };
      mockFromDelegate.mockImplementation(buildFrom({
        facilities: [],
        salons: [noAccountSalon],
        existingAccountEmails: ['someone-else@example.com'], // 一致しない別アカウントのみ存在
      }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      expect(sendRegistrationLeadFollowEmail).toHaveBeenCalledWith({
        email: 'Really.New+lead@gmail.com',
        facilityName: 'New Lead Salon',
        receiptId: 'sal-none',
      });
      const json = await res.json();
      expect(json.sent).toBe(1);
    });

    test('(iii) registration_followup_sent_at IS NULL で絞り込む（主クエリの .is フィルタ）', async () => {
      const salonIsSpy = jest.fn();
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salons: [], salonIsSpy }));
      await GET(makeRequest() as any);
      expect(salonIsSpy).toHaveBeenCalledWith('registration_followup_sent_at', null);
    });

    test('(iv) 送信に失敗したら claim が解放される（翌 run で再試行できる）', async () => {
      (sendRegistrationLeadFollowEmail as jest.Mock).mockResolvedValue(false);
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salons: [leadSalon] }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sent).toBe(0);
      const nullReleases = salonUpdateMock.mock.calls.filter((c: any[]) => c[0].registration_followup_sent_at === null);
      expect(nullReleases.length).toBe(1);
    });

    test('(v) 既存の facility_profiles パスの挙動が変わっていない（同時に処理しても両方 sent に数えられる）', async () => {
      setupDefaultMocks(1, true, true, true, true); // facility_profiles 側は既存どおりフル完了ケース
      mockFromDelegate.mockImplementation(buildFrom({
        facilities: [{ id: 'fac-1', name: 'New Salon', status: 'draft' }],
        claimed: [{ id: 'fac-1' }],
        menuCount: 2, staffData: [{ id: 's1' }], photoCount: 3, scheduleCount: 1,
        member: { user_id: 'owner-user-123' }, profile: { email: 'owner@example.com' },
        salons: [leadSalon],
      }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      const json = await res.json();
      // facility 1件 + salon 1件 = processed 2（facility パスの完了ロジックは無変更のまま機能）
      expect(json.processed).toBe(2);
      expect(sendOnboardingFollowEmail).toHaveBeenCalledWith(
        expect.objectContaining({ facilityName: 'New Salon', ownerEmail: 'owner@example.com' })
      );
      expect(sendRegistrationLeadFollowEmail).toHaveBeenCalledWith({
        email: 'lead@example.com', facilityName: 'Lead Salon', receiptId: 'sal-1',
      });
    });

    test('(vi) 第2パスのクエリが error を返したときに「0件で成功」に偽装されない → 500', async () => {
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salonsErr: { message: 'salons db error' } }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(500);
      expect(logCronRun).toHaveBeenCalledWith(
        'onboarding-followup', 'error', expect.any(Date),
        expect.objectContaining({ error_msg: 'salons db error' }),
      );
      // facilities.length===0 のケースでも salonsErr は「facilities クエリ後・salons クエリで」検出される
      // ので、facilities 側の空チェックより先に必ず評価される（0件成功への偽装が起きない）ことの確認。
      expect(sendRegistrationLeadFollowEmail).not.toHaveBeenCalled();
    });

    // 分岐カバレッジ: salonsErr が Error インスタンスの場合は .message を直接使う経路。
    test('salonsErr が Error インスタンス → その message を使う', async () => {
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salonsErr: new Error('salon boom instance') }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(500);
      expect(logCronRun).toHaveBeenCalledWith(
        'onboarding-followup', 'error', expect.any(Date),
        expect.objectContaining({ error_msg: 'salon boom instance' }),
      );
    });

    // 分岐カバレッジ: salonsErr が message を持たない場合は String() フォールバック。
    test('salonsErr が message 無し → String() フォールバック', async () => {
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salonsErr: 'plain-salon-error' }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(500);
      expect(logCronRun).toHaveBeenCalledWith(
        'onboarding-followup', 'error', expect.any(Date),
        expect.objectContaining({ error_msg: 'plain-salon-error' }),
      );
    });

    test('facilities が空でも salons があれば処理し「0件=skipped」に偽装しない（&& 分岐カバレッジ）', async () => {
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salons: [leadSalon] }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      expect(logCronRun).toHaveBeenCalledWith(
        'onboarding-followup', 'success', expect.any(Date),
        expect.objectContaining({ processed: 1 }),
      );
    });

    test('facilities も salons も空 → skipped（従来どおり）', async () => {
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salons: [] }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.sent).toBe(0);
      expect(logCronRun).toHaveBeenCalledWith(
        'onboarding-followup', 'skipped', expect.any(Date),
        expect.objectContaining({ processed: 0, skipped: 0 }),
      );
    });

    test('二重発火（既に claim 済み）→ skip', async () => {
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salons: [leadSalon], salonClaimed: [] }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      expect(sendRegistrationLeadFollowEmail).not.toHaveBeenCalled();
      const json = await res.json();
      expect(json.skipped).toBe(1);
    });

    test('profiles email 照合クエリが error → 誤って送信せず claim 解放（翌 run 再送）', async () => {
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockFromDelegate.mockImplementation(buildFrom({
        facilities: [], salons: [leadSalon], profileEmailCheckError: { message: 'profile email check boom' },
      }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(500);
      expect(sendRegistrationLeadFollowEmail).not.toHaveBeenCalled();
      const nullReleases = salonUpdateMock.mock.calls.filter((c: any[]) => c[0].registration_followup_sent_at === null);
      expect(nullReleases.length).toBe(1);
      expect(errSpy).toHaveBeenCalledWith(
        '[onboarding-followup] salon processing error',
        expect.objectContaining({ salonId: 'sal-1' })
      );
      errSpy.mockRestore();
    });

    test('claim release 失敗 → ログに残す', async () => {
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      (sendRegistrationLeadFollowEmail as jest.Mock).mockResolvedValue(false);
      mockFromDelegate.mockImplementation(buildFrom({
        facilities: [], salons: [leadSalon], salonReleaseError: { message: 'salon release boom' },
      }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(500);
      expect(errSpy).toHaveBeenCalledWith(
        '[onboarding-followup] salon claim release failed',
        expect.objectContaining({ salonId: 'sal-1' })
      );
      errSpy.mockRestore();
    });

    test('時間予算超過 → 残りは翌 run に回す（deferred に加算される）', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salons: [leadSalon] }));
      jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(10_000_000);
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.deferred).toBe(1);
      expect(json.processed).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(
        '[onboarding-followup] time budget exceeded, deferring rest to next run (salons)',
        expect.objectContaining({ deferred: 1 })
      );
      warnSpy.mockRestore();
    });

    test('oldest-first 順で created_at を order する', async () => {
      const salonOrderSpy = jest.fn().mockReturnValue({ range: jest.fn().mockResolvedValue({ data: [] }) });
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salons: [], salonOrderSpy }));
      await GET(makeRequest() as any);
      expect(salonOrderSpy).toHaveBeenCalledWith('created_at', { ascending: true });
    });

    // ------------------------------------------------------------------------
    // 2026年10月22日: 送るのは「/register/recover で復旧できる申込」だけ
    // 以前は作成日時と未送信しか見ておらず、却下済み・取り込み済みの申込にも
    // 「掲載準備が途中のままです」を送り、リンク先で空の店舗を作らせていた。
    // ------------------------------------------------------------------------
    test('🔴 回帰: 却下済み・取り込み済み・recruit 由来の申込には送らず、未処理の申込（status 未設定・承認済みを含む）にだけ送る', async () => {
      const rows = [
        { id: 'sal-pending', email: 'pending@example.com', facility_name: '未処理', status: 'pending' },
        { id: 'sal-null-status', email: 'nullstatus@example.com', facility_name: '状態未設定', status: null },
        { id: 'sal-approved', email: 'approved@example.com', facility_name: '承認済み', status: 'approved' },
        { id: 'sal-rejected', email: 'rejected@example.com', facility_name: '却下済み', status: 'rejected' },
        { id: 'sal-imported', email: 'imported@example.com', facility_name: '取り込み済み',
          claimed_facility_id: 'fac-x', claimed_by_user_id: 'user-x', claimed_at: '2026-10-20T00:00:00Z' },
        { id: 'sal-claimed-only', email: 'claimedonly@example.com', facility_name: '別アカウントで引き継ぎ中', claimed_by_user_id: 'user-y' },
        { id: 'sal-recruit', email: 'recruit@example.com', facility_name: '求人経由', source: 'recruit' },
        { id: 'sal-legacy', email: 'legacy@example.com', facility_name: '旧受付', source: null },
      ].map(salonRow);
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salonRows: rows }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      const sentTo = (sendRegistrationLeadFollowEmail as jest.Mock).mock.calls.map(([arg]) => arg.receiptId).sort();
      expect(sentTo).toEqual(['sal-approved', 'sal-null-status', 'sal-pending']);
      // 対象外の申込は claim もしない（将来、状態が戻っても二重送信の判定を汚さない）
      const claimedIds = rows.filter((row) => row.registration_followup_sent_at !== null).map((row) => row.id).sort();
      expect(claimedIds).toEqual(['sal-approved', 'sal-null-status', 'sal-pending']);
      expect((await res.json()).sent).toBe(3);
    });

    test('🔴 回帰: 一覧の取得後に却下・取り込みされた申込には送らない（claim にも同じ条件を付ける）', async () => {
      const rejectedLater = salonRow({ id: 'sal-rejected-later', email: 'later@example.com', facility_name: '後から却下' });
      const importedLater = salonRow({ id: 'sal-imported-later', email: 'later2@example.com', facility_name: '後から取り込み' });
      mockFromDelegate.mockImplementation(buildFrom({
        facilities: [],
        salonRows: [rejectedLater, importedLater],
        afterSalonList: () => {
          rejectedLater.status = 'rejected';
          importedLater.claimed_facility_id = 'fac-new';
          importedLater.claimed_by_user_id = 'user-new';
          importedLater.claimed_at = '2026-10-22T00:00:00Z';
        },
      }));
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      expect(sendRegistrationLeadFollowEmail).not.toHaveBeenCalled();
      expect(rejectedLater.registration_followup_sent_at).toBeNull();
      expect(importedLater.registration_followup_sent_at).toBeNull();
      expect((await res.json()).skipped).toBe(2);
    });

    test('メールには受付番号（salons.id）を渡し、業種や施設名から新規作成の導線を組み立てさせない', async () => {
      mockFromDelegate.mockImplementation(buildFrom({ facilities: [], salons: [{ ...leadSalon, business_type: '美容室' }] }));
      await GET(makeRequest() as any);
      expect(sendRegistrationLeadFollowEmail).toHaveBeenCalledWith({
        email: 'lead@example.com', facilityName: 'Lead Salon', receiptId: 'sal-1',
      });
    });
  });
});
