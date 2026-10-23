/**
 * @jest-environment node
 *
 * migration 20261023190000 を固定する（2026年10月23日）。
 *
 * ネット予約の可否（facility_booking_ready・検索カードの active_staff_count）は、勤務の窓が店舗の
 * 営業時間の中に「最短のメニュー以上」残るスタッフで決める。以前は数分でも重なれば「予約を受けられる」と
 * 数え、検索カードは「予約OK」なのに予約画面（get_available_slots は所要時間がまるごと入る窓にしか
 * 枠を出さない）は毎日「満枠」だった。
 *
 * jest から SQL は実行できないため、実 DB での挙動は
 * supabase/shadow/booking-ready-min-menu-overlap-fixtures.sql が CI の使い捨て PG17 で確かめる。
 * ここでは「直前の定義の写し＋意図した行だけ」「接続先ガード」「権限の再記述」「適用順と本番の確認手順」
 * 「fixture の配線」と、アプリ側の写し（facility-publish-gate.ts）との対応を固定する。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const read = (name: string) => readFileSync(join(MIGRATIONS, name), 'utf8');
const FILE = '20261023190000_booking_ready_min_menu_overlap.sql';
const SQL = read(FILE);
const PREVIOUS = read('20261023180000_booking_ready_hours_overlap_and_capable_staff.sql');

/** `CREATE OR REPLACE FUNCTION public.<signature>` から本文の終わり（`$$;`）まで。 */
function definition(text: string, signature: string): string {
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${signature}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = text.indexOf('\n$$;', start);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end + 4);
}
/** $$ … $$ の中（関数本文）とコメントを除いた SQL。トップレベルの文だけを見るため。 */
const topLevel = (text: string) => text.replace(/\$([a-z]*)\$[\s\S]*?\$\1\$/g, () => '<body>').replace(/--[^\n]*/g, '');

const FOUR_ARGS = 'working_time_meets_business_hours(\n  p_hours jsonb, p_dow integer, p_start time, p_end time\n)';
const FIVE_ARGS = 'working_time_meets_business_hours(\n  p_hours jsonb, p_dow integer, p_start time, p_end time, p_min_minutes integer\n)';

describe(`${FILE} の形`, () => {
  test('接続先ガードが最初の文', () => {
    expect(topLevel(SQL).trim()).toMatch(/^DO <body>;/);
    expect(SQL).toContain("IF to_regclass('public.facility_profiles') IS NULL OR to_regclass('public.facility_menus') IS NULL THEN\n    RAISE EXCEPTION 'not the CareLink database';");
    expect(SQL.indexOf('DO $guard$')).toBeLessThan(SQL.indexOf('CREATE OR REPLACE FUNCTION'));
  });

  test('データを書き換えない・ビューと facility_booking_ready・get_available_slots は定義し直さない', () => {
    expect(topLevel(SQL)).not.toMatch(/\b(UPDATE|INSERT INTO|DELETE FROM|DROP|ALTER)\b/i);
    expect(topLevel(SQL)).not.toMatch(/CREATE FUNCTION/);
    expect(SQL).not.toMatch(/FUNCTION\s+public\.(facility_booking_ready|get_available_slots)\s*\(/);
    expect(SQL).not.toMatch(/VIEW\s+public\.facility_card_view\b/);
  });

  test('権限は元の migration と同じ文を再記述し、新しい関数にも同じ利用者を与える', () => {
    for (const statement of [
      'REVOKE ALL ON FUNCTION public.staff_has_working_time(uuid) FROM PUBLIC;',
      'GRANT EXECUTE ON FUNCTION public.staff_has_working_time(uuid) TO anon, authenticated, service_role;',
      'REVOKE ALL ON FUNCTION public.working_time_meets_business_hours(jsonb,integer,time,time) FROM PUBLIC;',
      'GRANT EXECUTE ON FUNCTION public.working_time_meets_business_hours(jsonb,integer,time,time) TO anon, authenticated, service_role;',
    ]) {
      expect(PREVIOUS).toContain(statement);
      expect(SQL).toContain(statement);
    }
    expect(SQL).toContain('REVOKE ALL ON FUNCTION public.working_time_meets_business_hours(jsonb,integer,time,time,integer) FROM PUBLIC;');
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.working_time_meets_business_hours(jsonb,integer,time,time,integer) TO anon, authenticated, service_role;');
    expect(SQL).toContain('REVOKE ALL ON FUNCTION public.facility_shortest_booking_minutes(uuid) FROM PUBLIC;');
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.facility_shortest_booking_minutes(uuid) TO anon, authenticated, service_role;');
  });

  test('適用順・デプロイとの前後・本番の確認手順を明記している', () => {
    expect(SQL).toContain('Apply order: after every migration up to 20261023180000_booking_ready_hours_overlap_and_capable_staff.sql.');
    expect(SQL).toContain('Safe before or after deploying the application');
    expect(SQL).toContain('BEFORE APPLYING, run\n--   scripts/diagnose-booking-ready-hours-overlap.sql');
    expect(SQL).toContain('xzafxiupbflvgbarrihe');
    const diagnose = readFileSync(join(ROOT, 'scripts/diagnose-booking-ready-hours-overlap.sql'), 'utf8');
    expect(diagnose).toContain('migration 20261023190000');
    expect(diagnose).toContain('適用後に予約を受けられなくなる店舗');
    // 診断も同じ最短の長さで判定する（未設定・0 は 60 分、15〜480 分、メニューなしは 15 分）
    expect(diagnose).toContain('least(greatest(coalesce(nullif(m.duration_minutes, 0), 60), 15), 480)');
    expect(diagnose).toContain('make_interval(mins => need.minutes)');
  });

  test('この migration が staff_has_working_time・working_time_meets_business_hours・facility_shortest_booking_minutes の最新定義', () => {
    const later = readdirSync(MIGRATIONS).filter((f) => /^\d{14}_/.test(f) && f > FILE);
    for (const f of later) {
      expect(read(f)).not.toMatch(/FUNCTION\s+(public\.)?(staff_has_working_time|working_time_meets_business_hours|facility_shortest_booking_minutes)\s*\(/i);
    }
  });
});

describe('勤務の窓は最短のメニュー以上が営業時間の中に残るものだけを数える', () => {
  const five = definition(SQL, FIVE_ARGS);
  const four = definition(SQL, FOUR_ARGS);
  const shortest = definition(SQL, 'facility_shortest_booking_minutes(');
  const staff = definition(SQL, 'staff_has_working_time(');
  const previousOverlap = definition(PREVIOUS, FOUR_ARGS);
  const previousStaff = definition(PREVIOUS, 'staff_has_working_time(');

  test('5 引数の判定は 20261023180000 の写しに、最短の長さの変数と最後の判定だけを変えたもの', () => {
    const declaration = '\n  v_need integer := least(greatest(coalesce(p_min_minutes, 15), 15), 480);';
    const newReturn = '  -- Same test as get_available_slots: the (clamped) window must hold a whole slot.\n  RETURN v_end > v_start AND v_end - v_start >= make_interval(mins => v_need);';
    expect(five).toContain(declaration);
    expect(five).toContain(newReturn);
    expect(five.replace(FIVE_ARGS, FOUR_ARGS).replace(declaration, '').replace(newReturn, '  RETURN v_end > v_start;'))
      .toBe(previousOverlap);
  });

  test('4 引数は署名・引数名・SECURITY INVOKER・search_path を保ち、15 分で 5 引数へ委ねる', () => {
    expect(four).toContain("LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$");
    expect(four).toContain('RETURN public.working_time_meets_business_hours(p_hours, p_dow, p_start, p_end, 15);');
    expect(previousOverlap).toContain("LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$");
  });

  test('最短の長さは予約画面と同じ読み方（未設定・0 は 60 分、15〜480 分、非公開以外、メニューなしは 15 分）', () => {
    expect(shortest).toContain("LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''");
    expect(shortest).toContain('min(least(greatest(coalesce(nullif(m.duration_minutes, 0), 60), 15), 480))::integer');
    expect(shortest).toMatch(/coalesce\(\s*min\([\s\S]*\),\s*15\)/);
    expect(shortest).toContain('AND m.is_published IS DISTINCT FROM false');
    // アプリ側の同じ数（booking-slot-rules.ts）
    const rules = readFileSync(join(ROOT, 'src/lib/booking-slot-rules.ts'), 'utf8');
    expect(rules).toContain('export const BOOKING_DURATION_MIN_MINUTES = 15;');
    expect(rules).toContain('export const BOOKING_DURATION_MAX_MINUTES = 480;');
    expect(rules).toContain('export const MENU_DURATION_FALLBACK_MINUTES = 60;');
  });

  test('staff_has_working_time は 20261023180000 の写しに、店舗の最短のメニューを渡すだけ', () => {
    const lateral = '\n    CROSS JOIN LATERAL (SELECT public.facility_shortest_booking_minutes(s.facility_id) AS minutes) need';
    expect(staff).toContain(lateral);
    expect(staff.replace(lateral, '').replace(/, need\.minutes\)/g, ')')).toBe(previousStaff);
    expect(staff.match(/need\.minutes/g)).toHaveLength(2);
  });

  test('get_available_slots の判定（窓の長さ ≥ 所要時間）と同じ式', () => {
    const slots = read('20261023070100_available_slots_exclude_booking.sql');
    expect(slots).toContain('AND v_work_end - v_current_start >= make_interval(mins => p_duration_minutes) LOOP');
    expect(slots).toContain('IF p_duration_minutes IS NULL OR p_duration_minutes < 15 OR p_duration_minutes > 480 THEN RETURN; END IF;');
  });

  test('アプリ側の写し（workingTimeMeetsBusinessHours・shortestBookingMinutes）が同じ規則を持つ', () => {
    const app = readFileSync(join(ROOT, 'src/lib/facility-publish-gate.ts'), 'utf8');
    expect(app).toContain('return to > from && to - from >= need * 60;');
    expect(app).toContain('if (list.length === 0) return BOOKING_DURATION_MIN_MINUTES;');
    expect(app).toContain('return Math.min(...list.map(menu => bookingDurationForMenus([menu])));');
    expect(app).toContain(".or('is_published.is.null,is_published.eq.true');");
  });
});

test('実 DB での挙動を確かめる shadow fixture が CI に配線されている', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
  expect(workflow).toContain('psql -X -v ON_ERROR_STOP=1 -d carelink_shadow -f supabase/shadow/booking-ready-min-menu-overlap-fixtures.sql');
  const fixture = readFileSync(join(ROOT, 'supabase/shadow/booking-ready-min-menu-overlap-fixtures.sql'), 'utf8');
  expect(fixture).toMatch(/^BEGIN;$/m);
  expect(fixture.trim().endsWith('ROLLBACK;')).toBe(true);
  expect(fixture).toContain("IF current_database() NOT LIKE 'carelink_shadow%'");
  for (const label of [
    'the shortest bookable menu is 60 minutes (unset = 60, drafts ignored)',
    'a 30-minute overlap is not working time for 60-minute menus',
    'the shop is not offered for online booking (before: ready, and 満枠 every day)',
    'a special day with a short overlap does not count',
    'a 30-minute overlap makes the shop bookable for a 30-minute menu',
    'and get_available_slots opens the 10:00-10:30 slot',
    'a normal shift inside the hours stays bookable',
    'anonymous card does not count a short overlap',
    'the 4-argument form needs 15 minutes',
  ]) expect(fixture).toContain(label);
});
