/**
 * @jest-environment node
 *
 * migration 20261023180000 を固定する（2026年10月23日）。
 *
 *   1. ネット予約の可否（facility_booking_ready・検索カードの active_staff_count）は、勤務の窓が
 *      店舗の営業時間と重なるスタッフで決める。以前は勤務の窓があれば営業時間の外・定休日でも
 *      「予約を受けられる」と数え、検索カードは「予約OK」なのに予約画面は毎日「満枠」だった。
 *   2. 指名なしで、勤務しているスタッフの誰も選んだメニューを担当できない（menu_staff）ときは
 *      BOOKING_NO_CAPABLE_STAFF を返す。以前は空いている時間に「既に予約が入っています」と出た。
 *
 * jest から SQL は実行できないため、実 DB での挙動は
 * supabase/shadow/booking-ready-hours-overlap-fixtures.sql が CI の使い捨て PG17 で確かめる。
 * ここでは「最新定義の写し＋意図した行だけ」「接続先ガード」「権限の再記述」「適用順の記載」
 * 「fixture の配線」と、アプリ側の写し（facility-publish-gate.ts）との対応を固定する。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const read = (name: string) => readFileSync(join(MIGRATIONS, name), 'utf8');
const FILE = '20261023180000_booking_ready_hours_overlap_and_capable_staff.sql';
const SQL = read(FILE);
const PREVIOUS_CREATE = read('20261023130100_manual_unassigned_booking_no_working_staff.sql');
const PREVIOUS_CHANGE = read('20261023164100_customer_change_closes_with_free_cancel_window.sql');

/** `CREATE OR REPLACE FUNCTION public.<name>(` から本文の終わり（`$$;`）まで。 */
function definition(text: string, name: string): string {
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = text.indexOf('\n$$;', start);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end + 4);
}
/** $$ … $$ の中（関数本文）とコメントを除いた SQL。トップレベルの文だけを見るため。 */
const topLevel = (text: string) => text.replace(/\$([a-z]*)\$[\s\S]*?\$\1\$/g, () => '<body>').replace(/--[^\n]*/g, '');

/** 「勤務しているがメニューを担当できる人がいない」判定（create と change で変数名だけ違う）。 */
const capableCheck = (facility: string, menus: string) => `
      IF EXISTS (
        SELECT 1 FROM public.staff_profiles sp
        WHERE sp.facility_id = ${facility} AND sp.is_active = true
          AND public.booking_staff_works_slot(sp.id, p_booking_date, p_start_time, p_end_time)
      ) AND NOT EXISTS (
        SELECT 1 FROM public.staff_profiles sp
        WHERE sp.facility_id = ${facility} AND sp.is_active = true
          AND public.booking_staff_works_slot(sp.id, p_booking_date, p_start_time, p_end_time)
          AND NOT EXISTS (
            SELECT 1 FROM unnest(${menus}) AS chosen(id)
            WHERE EXISTS (SELECT 1 FROM public.menu_staff ms WHERE ms.menu_id = chosen.id)
              AND NOT EXISTS (SELECT 1 FROM public.menu_staff ms WHERE ms.menu_id = chosen.id AND ms.staff_id = sp.id)
          )
      ) THEN
        RAISE EXCEPTION 'BOOKING_NO_CAPABLE_STAFF: 選択したメニューを担当できるスタッフがいません';
      END IF;`;

describe(`${FILE} の形`, () => {
  test('接続先ガードが最初の文', () => {
    expect(topLevel(SQL).trim()).toMatch(/^DO <body>;/);
    expect(SQL).toMatch(/^DO \$guard\$\nBEGIN\n  IF to_regclass\('public\.facility_profiles'\) IS NULL THEN\n    RAISE EXCEPTION 'not the CareLink database';/m);
    expect(SQL.indexOf('DO $guard$')).toBeLessThan(SQL.indexOf('CREATE OR REPLACE FUNCTION'));
  });

  test('データを書き換えない（トップレベルに UPDATE / INSERT / DELETE / DROP / ALTER が無い）', () => {
    expect(topLevel(SQL)).not.toMatch(/\b(UPDATE|INSERT INTO|DELETE FROM|DROP|ALTER)\b/i);
    expect(topLevel(SQL)).not.toMatch(/CREATE FUNCTION/);
  });

  test('facility_booking_ready と facility_card_view は定義し直さない（列の並び・本文はそのまま）', () => {
    expect(SQL).not.toMatch(/FUNCTION\s+public\.facility_booking_ready\s*\(/);
    expect(SQL).not.toMatch(/VIEW\s+public\.facility_card_view\b/);
  });

  test('権限は元の migration と同じ文を再記述する', () => {
    for (const statement of [
      'REVOKE ALL ON FUNCTION public.staff_has_working_time(uuid) FROM PUBLIC;',
      'GRANT EXECUTE ON FUNCTION public.staff_has_working_time(uuid) TO anon, authenticated, service_role;',
      'REVOKE ALL ON FUNCTION public.working_time_meets_business_hours(jsonb,integer,time,time) FROM PUBLIC;',
      'GRANT EXECUTE ON FUNCTION public.working_time_meets_business_hours(jsonb,integer,time,time) TO anon, authenticated, service_role;',
      'REVOKE ALL ON FUNCTION public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])\n  FROM PUBLIC, anon, authenticated;',
      'GRANT EXECUTE ON FUNCTION public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])\n  TO service_role;',
      'REVOKE ALL ON FUNCTION public.change_booking_atomic(uuid,uuid,date,time,time,boolean) FROM PUBLIC, anon, authenticated;',
      'GRANT EXECUTE ON FUNCTION public.change_booking_atomic(uuid,uuid,date,time,time,boolean) TO service_role;',
    ]) expect(SQL).toContain(statement);
    // 予約関数の実行権を API のロールへ渡さない
    expect(SQL).not.toMatch(/GRANT [^;]*(create_booking_for_menus_atomic|change_booking_atomic)[^;]*TO [^;]*(anon|authenticated)/);
  });

  test('適用順（アプリのデプロイの後）と、本番の確認手順を明記している', () => {
    expect(SQL).toContain('AFTER deploying the application that knows BOOKING_NO_CAPABLE_STAFF');
    expect(SQL).toContain('after every migration up to 20261023170000_publish_requires_confirmed_hours.sql');
    expect(SQL).toContain('scripts/diagnose-booking-ready-hours-overlap.sql');
    expect(readFileSync(join(ROOT, 'scripts/diagnose-booking-ready-hours-overlap.sql'), 'utf8')).toContain('適用後に予約を受けられなくなる店舗');
  });

  test('この migration が create_booking_for_menus_atomic・change_booking_atomic の最新定義', () => {
    const later = readdirSync(MIGRATIONS).filter((f) => /^\d{14}_/.test(f) && f > FILE);
    for (const f of later) {
      expect(read(f)).not.toMatch(/FUNCTION\s+(public\.)?(create_booking_for_menus_atomic|change_booking_atomic)\s*\(/i);
      // staff_has_working_time・working_time_meets_business_hours は 20261023190000 だけが
      // （最短のメニュー以上の重なりを要るように）定義し直す。それ以外は触らない。
      if (f !== '20261023190000_booking_ready_min_menu_overlap.sql') {
        expect(read(f)).not.toMatch(/FUNCTION\s+(public\.)?(staff_has_working_time|working_time_meets_business_hours)\s*\(/i);
      }
    }
  });
});

describe('勤務の窓は営業時間と重なるものだけを数える', () => {
  const overlap = definition(SQL, 'working_time_meets_business_hours');
  const staff = definition(SQL, 'staff_has_working_time');

  test('判定関数は SECURITY INVOKER・search_path 空・読めない時刻で例外を投げない', () => {
    expect(overlap).toContain("LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$");
    // 時刻へのキャストは、形を確かめてからだけ（検索カードのビューが全公開店舗で評価するため）
    expect(overlap.indexOf("v_open !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'")).toBeLessThan(overlap.indexOf('v_open::time'));
    expect(overlap).toContain("IF jsonb_typeof(v_day) = 'null' THEN RETURN false; END IF;");
    expect(overlap).toContain('RETURN v_end > v_start;');
  });

  test('アプリ側の写し（workingTimeMeetsBusinessHours）と同じ時刻の形・曜日の並び', () => {
    const app = readFileSync(join(ROOT, 'src/lib/facility-publish-gate.ts'), 'utf8');
    expect(app).toContain("const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;");
    expect(overlap).toContain("(ARRAY['sun','mon','tue','wed','thu','fri','sat'])[p_dow + 1]");
    expect(app).toContain('const CLOCK = /^([01]?\\d|2[0-3]):([0-5]\\d)(?::([0-5]\\d))?$/;');
  });

  test('staff_has_working_time は週間の勤務日と今日以降の勤務する特別日の両方に営業時間の判定を掛ける', () => {
    expect(staff).toContain("LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''");
    expect(staff).toContain('public.working_time_meets_business_hours(f.business_hours, ss.day_of_week, ss.start_time, ss.end_time)');
    expect(staff).toContain('public.working_time_meets_business_hours(f.business_hours, EXTRACT(DOW FROM so.date)::integer, so.start_time, so.end_time)');
    for (const condition of ["so.date >= (pg_catalog.now() AT TIME ZONE 'Asia/Tokyo')::date", 'so.is_holiday IS NOT TRUE',
      'so.start_time IS NOT NULL', 'so.end_time IS NOT NULL']) expect(staff).toContain(condition);
  });
});

describe('指名なしでメニューを担当できるスタッフがいないときの拒否コード', () => {
  test('create_booking_for_menus_atomic は 20261023130100 の写しに判定を 1 か所足しただけ', () => {
    const next = definition(SQL, 'create_booking_for_menus_atomic');
    const added = `
      -- BOOKING_NO_CAPABLE_STAFF (20261023180000): someone works the slot, but nobody
      -- who works it handles every chosen menu (menu_staff). That is not a double
      -- booking, so do not say 「既に予約が入っています」.${capableCheck('p_facility_id', 'v_menu_ids')}`;
    expect(next).toContain(added);
    expect(next.replace(added, '')).toBe(definition(PREVIOUS_CREATE, 'create_booking_for_menus_atomic'));
    // 勤務しているスタッフが 1 人もいない手動予約（BOOKING_NO_WORKING_STAFF）の判定が先
    expect(next.indexOf("'BOOKING_NO_WORKING_STAFF:")).toBeLessThan(next.indexOf("'BOOKING_NO_CAPABLE_STAFF:"));
    expect(next.indexOf("'BOOKING_NO_CAPABLE_STAFF:")).toBeLessThan(next.lastIndexOf("RAISE EXCEPTION 'BOOKING_CONFLICT:"));
  });

  test('change_booking_atomic は 20261023164100 の写しに、同じ判定とメニューの一覧の変数を足しただけ', () => {
    const next = definition(SQL, 'change_booking_atomic');
    const previous = definition(PREVIOUS_CHANGE, 'change_booking_atomic');
    const declaration = `
  -- BOOKING_NO_CAPABLE_STAFF (20261023180000): every booked menu, for the assignment and its refusal.
  v_chosen_menu_ids UUID[];`;
    const oldPick = `    v_staff_id := public.booking_pick_free_staff(v_facility_id, p_booking_date, p_start_time, p_end_time, v_buffer_minutes,
      ARRAY(
        SELECT DISTINCT chosen.id
        FROM unnest(array_append(COALESCE(v_menu_ids, ARRAY[]::uuid[]), v_menu_id)) AS chosen(id)
        WHERE chosen.id IS NOT NULL
      ),
      p_booking_id, v_staff_id);

    IF v_staff_id IS NULL THEN
      RAISE EXCEPTION`;
    const newPick = `    v_chosen_menu_ids := ARRAY(
      SELECT DISTINCT chosen.id
      FROM unnest(array_append(COALESCE(v_menu_ids, ARRAY[]::uuid[]), v_menu_id)) AS chosen(id)
      WHERE chosen.id IS NOT NULL
    );
    v_staff_id := public.booking_pick_free_staff(v_facility_id, p_booking_date, p_start_time, p_end_time, v_buffer_minutes,
      v_chosen_menu_ids, p_booking_id, v_staff_id);

    IF v_staff_id IS NULL THEN
      -- BOOKING_NO_CAPABLE_STAFF (20261023180000): the same rule as a new おまかせ
      -- reservation. Someone works the new slot, but nobody who works it handles
      -- every booked menu (menu_staff): not a double booking.${capableCheck('v_facility_id', 'v_chosen_menu_ids')}
      RAISE EXCEPTION`;
    expect(previous).toContain(oldPick);
    expect(next).toContain(declaration);
    expect(next).toContain(newPick);
    expect(next.replace(declaration, '').replace(newPick, oldPick)).toBe(previous);
  });
});

test('実 DB での挙動を確かめる shadow fixture が CI に配線されている', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
  expect(workflow).toContain('psql -X -v ON_ERROR_STOP=1 -d carelink_shadow -f supabase/shadow/booking-ready-hours-overlap-fixtures.sql');
  const fixture = readFileSync(join(ROOT, 'supabase/shadow/booking-ready-hours-overlap-fixtures.sql'), 'utf8');
  expect(fixture).toMatch(/^BEGIN;$/m);
  expect(fixture.trim().endsWith('ROLLBACK;')).toBe(true);
  expect(fixture).toContain("IF current_database() NOT LIKE 'carelink_shadow%'");
  for (const label of [
    'the shop is not offered for online booking (before: ready, and 満枠 every day)',
    'special days outside the hours do not count',
    'a weekly window inside the hours makes the shop bookable',
    'anonymous card counts A',
    'online 指名なし M2 without a capable member (before: BOOKING_CONFLICT',
    'manual 指名なし M2 without a capable member',
    'capable B busy is still BOOKING_CONFLICT',
    'manual without any working member keeps BOOKING_NO_WORKING_STAFF',
    'customer change without a capable member',
    'business_hours is read like get_available_slots',
  ]) expect(fixture).toContain(label);
});
