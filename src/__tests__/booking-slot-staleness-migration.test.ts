/**
 * @jest-environment node
 *
 * 予約枠の鮮度（2026年10月23日）の migration 2 本を固定する。
 *
 *  - 20261023070000: 開始時刻（JST）を過ぎた時間は、ネット予約（create_online_booking_atomic）でも
 *    お客様の日時変更（change_booking_atomic・公開経路）でも受け付けない（BOOKING_SLOT_PASSED）。
 *  - 20261023070100: 空き枠 RPC get_available_slots に「変更する予約を数えない」5 引数版を足し、
 *    既存の 4 引数版はそれを NULL で呼ぶだけにする（結果は今までと同じ）。
 *
 * jest から SQL は実行できないため、実 DB での挙動は supabase/shadow/booking-slot-start-and-reschedule-fixtures.sql
 * が CI の使い捨て PG17 で確かめる。ここでは
 *   - 各関数が「最新定義の写し＋意図した行だけ」であること（写し間違いで他の挙動を壊さない）
 *   - 接続先ガード・権限・データを書き換えないこと
 *   - shadow fixture が CI に配線されていること
 * を固定する。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (name: string) => readFileSync(join(ROOT, 'supabase/migrations', name), 'utf8');
const START = read('20261023070000_booking_start_must_be_future.sql');
const SLOTS = read('20261023070100_available_slots_exclude_booking.sql');
const STAFF_ASSIGNMENT = read('20261022100000_booking_staff_assignment.sql');
const CHANGE_GUARDS = read('20261022100100_customer_booking_change_guards.sql');

/** n 番目の `CREATE OR REPLACE FUNCTION public.<name>(` から本文の終わり（`$$;`）まで。 */
function definition(text: string, name: string, nth = 0): string {
  let start = -1;
  for (let i = 0; i <= nth; i++) start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = text.indexOf('\n$$;', start);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end + 4);
}
/** $$ … $$ の中（関数本文）とコメントを除いた SQL。トップレベルの文だけを見るため。 */
const topLevel = (text: string) => text.replace(/\$([a-z]*)\$[\s\S]*?\$\1\$/g, () => '<body>').replace(/--[^\n]*/g, '');

describe.each([
  ['20261023070000', START],
  ['20261023070100', SLOTS],
])('%s の形', (_label, sql) => {
  test('接続先ガードが最初の文', () => {
    expect(topLevel(sql).trim()).toMatch(/^DO <body>;/);
    expect(sql).toMatch(/^DO \$guard\$\nBEGIN\n  IF to_regclass\('public\.facility_profiles'\) IS NULL THEN\n    RAISE EXCEPTION 'not the CareLink database';/m);
    expect(sql.indexOf('DO $guard$')).toBeLessThan(sql.indexOf('CREATE OR REPLACE FUNCTION'));
  });
  test('データを書き換えない（トップレベルに UPDATE / INSERT / DELETE が無い）', () => {
    expect(topLevel(sql)).not.toMatch(/\b(UPDATE|INSERT INTO|DELETE FROM|DROP)\b/i);
  });
  test('API のロールへ実行権を渡さない', () => {
    expect(sql).not.toMatch(/GRANT [^;]*TO [^;]*(anon|authenticated|PUBLIC)/);
  });
});

describe('20261023070000: 開始時刻を過ぎた時間を受け付けない', () => {
  const ONLINE_CHECK = `  -- 2026-10-23: a slot whose start (JST) has passed is not bookable online. Same
  -- rule as the availability API (a slot is offered only while slot_start > now).
  IF (p_booking_date + p_start_time) AT TIME ZONE 'Asia/Tokyo' <= clock_timestamp() THEN
    RAISE EXCEPTION 'BOOKING_SLOT_PASSED: 選択した時間は過ぎています';
  END IF;
`;
  const CHANGE_CHECK = `
  -- 2026-10-23: the new time must not have started either (public path only;
  -- the same rule as a new online booking). Before, a customer could move a
  -- reservation to a time of today that had already passed.
  IF p_enforce_schedule AND (p_booking_date + p_start_time) AT TIME ZONE 'Asia/Tokyo' <= clock_timestamp() THEN
    RAISE EXCEPTION 'BOOKING_SLOT_PASSED: 選択した時間は過ぎています';
  END IF;`;

  test('create_online_booking_atomic は最新定義（20261022100000）に判定を足しただけ', () => {
    const next = definition(START, 'create_online_booking_atomic');
    expect(next).toContain(ONLINE_CHECK);
    expect(next.replace(ONLINE_CHECK, '')).toBe(definition(STAFF_ASSIGNMENT, 'create_online_booking_atomic'));
    // 店舗の手動予約（create_manual_booking_atomic）はこの関数を通らない＝来店済みの事後登録は従来どおり。
    expect(STAFF_ASSIGNMENT).toContain("replacement := '  v_booking := public.create_booking_for_menus_atomic(v_facility, v_staff, NULL, v_menus[1], NULL,'");
    expect(STAFF_ASSIGNMENT).toContain("p_input->>''note'', v_price::int, 0, ''confirmed'', false, v_menus);';");
  });

  test('change_booking_atomic は最新定義（20261022100100）に判定を足しただけ（公開経路だけ）', () => {
    const next = definition(START, 'change_booking_atomic');
    expect(next).toContain(CHANGE_CHECK);
    // 開始済みの予約そのものの判定（BOOKING_ALREADY_STARTED）の直後に置く。
    expect(next.indexOf("RAISE EXCEPTION 'BOOKING_ALREADY_STARTED'")).toBeLessThan(next.indexOf('BOOKING_SLOT_PASSED'));
    expect(next.replace(CHANGE_CHECK, '')).toBe(definition(CHANGE_GUARDS, 'change_booking_atomic'));
  });

  test('権限は元の migration と同じ文を再記述する', () => {
    expect(START).toContain(`REVOKE ALL ON FUNCTION public.create_online_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[])
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_online_booking_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,uuid[])
  FROM service_role;`);
    expect(START).toContain('REVOKE ALL ON FUNCTION public.change_booking_atomic(uuid,uuid,date,time,time,boolean) FROM PUBLIC, anon, authenticated;');
    expect(START).toContain('GRANT EXECUTE ON FUNCTION public.change_booking_atomic(uuid,uuid,date,time,time,boolean) TO service_role;');
  });
});

describe('20261023070100: 変更する予約を数えない空き枠', () => {
  const five = definition(SLOTS, 'get_available_slots', 0);
  const four = definition(SLOTS, 'get_available_slots', 1);

  test('5 引数版は最新の 4 引数版（20261022100000）に、引数と除外 3 か所を足しただけ', () => {
    expect(five).toContain('  p_duration_minutes INT,\n  p_exclude_booking_id UUID\n)');
    expect(five.split('b.id IS DISTINCT FROM p_exclude_booking_id')).toHaveLength(3);
    expect(five).toContain('p_facility_id, p_date, v_current_start, v_current_end, v_buffer_minutes, p_exclude_booking_id);');
    const undone = five
      .replace('  p_duration_minutes INT,\n  p_exclude_booking_id UUID\n)', '  p_duration_minutes INT\n)')
      .replace(/\n *AND b\.id IS DISTINCT FROM p_exclude_booking_id/g, '')
      .replace('v_buffer_minutes, p_exclude_booking_id);', 'v_buffer_minutes, NULL);');
    expect(undone).toBe(definition(STAFF_ASSIGNMENT, 'get_available_slots'));
    // 既定値を持たない＝4 つの名前付き引数の呼び出しは 4 引数版だけに解決される（PostgREST の曖昧さを作らない）。
    expect(five).not.toMatch(/p_exclude_booking_id UUID DEFAULT/i);
  });

  test('4 引数版は署名・SECURITY・search_path を保ち、5 引数版を NULL で呼ぶだけ', () => {
    expect(four).toContain(`CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_facility_id UUID,
  p_staff_id UUID,
  p_date DATE,
  p_duration_minutes INT
)
RETURNS TABLE(slot_start TIME, slot_end TIME)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public`);
    expect(four).toContain('FROM public.get_available_slots(p_facility_id, p_staff_id, p_date, p_duration_minutes, NULL::uuid) AS s;');
  });

  test('どちらもサーバー専用（service_role だけ・20261020150500 と同じ）', () => {
    for (const signature of ['uuid, uuid, date, integer', 'uuid, uuid, date, integer, uuid']) {
      expect(SLOTS).toContain(`REVOKE EXECUTE ON FUNCTION public.get_available_slots(${signature}) FROM PUBLIC, anon, authenticated;`);
      expect(SLOTS).toContain(`GRANT EXECUTE ON FUNCTION public.get_available_slots(${signature}) TO service_role;`);
    }
    // 5 引数版の権限は、作った直後（4 引数版を置き換える前）に絞る。
    expect(SLOTS.indexOf('REVOKE EXECUTE ON FUNCTION public.get_available_slots(uuid, uuid, date, integer, uuid)'))
      .toBeLessThan(SLOTS.indexOf('CREATE OR REPLACE FUNCTION public.get_available_slots(\n  p_facility_id UUID,\n  p_staff_id UUID,\n  p_date DATE,\n  p_duration_minutes INT\n)'));
  });
});

test('実 DB での挙動を確かめる shadow fixture が CI に配線されている', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
  expect(workflow).toContain('psql -X -v ON_ERROR_STOP=1 -d carelink_shadow -f supabase/shadow/booking-slot-start-and-reschedule-fixtures.sql');
  const fixture = readFileSync(join(ROOT, 'supabase/shadow/booking-slot-start-and-reschedule-fixtures.sql'), 'utf8');
  expect(fixture).toMatch(/^BEGIN;$/m);
  expect(fixture.trim().endsWith('ROLLBACK;')).toBe(true);
  expect(fixture).toContain("IF current_database() NOT LIKE 'carelink_shadow%'");
  for (const label of ['BOOKING_SLOT_PASSED', "get_available_slots(uuid,uuid,date,integer,uuid)", 'leaving the moved reservation out offers the times overlapping it']) {
    expect(fixture).toContain(label);
  }
});
