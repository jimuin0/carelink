/** @jest-environment node */
/**
 * ネット予約の可否は「勤務時間のある在籍スタッフ」で決める（2026年10月23日）。
 *
 * 回帰の中身: スタッフを追加しても勤務は作られない（20261023080100）。facility_booking_ready と
 * 検索カードの active_staff_count が「在籍スタッフがいるか」しか見ていないと、追加したばかりの
 * スタッフしかいない公開店舗のカードに「予約OK」が出て、予約画面は毎日「満枠」になる
 * （get_available_slots は勤務時間の中にしか枠を出さない）。
 *
 * 振る舞いは supabase/shadow/listing-booking-fixtures.sql が使い捨て DB で確かめる。ここは次を固定する:
 *   - 【最後に適用される定義】の facility_booking_ready と facility_card_view が同じ判定関数を通ること
 *   - 判定関数が get_available_slots の勤務の窓と同じ条件（週間の勤務日／今日以降・休みでない・時刻ありの特別日）であること
 *   - アプリ側（workingStaffQuery）が同じ条件で読むこと
 *   - ビューの列の並びが変わっていないこと（CREATE OR REPLACE VIEW の前提・旧アプリが読める）
 *   - 勤務を作らなくする migration より前に適用される順序であること
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const MIGRATION = '20261023080000_booking_ready_requires_working_staff.sql';
const STAFF_CREATE = '20261023080100_staff_create_without_default_schedule.sql';
const PREVIOUS_VIEW = '20261021060000_card_view_booking_readiness.sql';

const withoutComments = (sql: string) => sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

/** 辞書順（＝適用順）で最後に現れる定義の文と、そのファイル。 */
function latest(pattern: RegExp, end: (sql: string, start: number) => number): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  for (const file of files) {
    const sql = withoutComments(readFileSync(join(MIGRATIONS, file), 'utf8'));
    for (const match of sql.matchAll(pattern)) found = { file, body: sql.slice(match.index, end(sql, match.index!)) };
  }
  if (!found) throw new Error(`no definition for ${pattern}`);
  return found;
}
const functionEnd = (sql: string, start: number) => {
  const open = sql.indexOf('$$', start);
  return sql.indexOf('$$', open + 2) + 2;
};
const statementEnd = (sql: string, start: number) => sql.indexOf(';', start) + 1;
const fn = (name: string) => latest(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`, 'g'), functionEnd);
const cardView = () => latest(/CREATE (?:OR REPLACE )?VIEW public\.facility_card_view\b/g, statementEnd);
/** SELECT から FROM までの列の別名（AS の右側、無ければ列名）を順に返す。 */
function viewColumns(body: string): string[] {
  const list = body.slice(body.indexOf('SELECT') + 'SELECT'.length, body.indexOf('\n FROM public.facility_profiles fp'));
  const columns: string[] = [];
  let depth = 0; let current = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { columns.push(current); current = ''; } else current += ch;
  }
  columns.push(current);
  return columns.map((column) => {
    const alias = column.match(/\bAS\s+(\w+)\s*$/i);
    return alias ? alias[1] : column.trim().split('.').pop()!;
  });
}

describe('最後に適用される定義が「勤務時間のある在籍スタッフ」で判定する', () => {
  test('判定関数は get_available_slots の勤務の窓と同じ条件を見る', () => {
    const { file, body } = fn('staff_has_working_time');
    expect(file).toBe(MIGRATION);
    expect(body).toContain("LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''");
    expect(body).toContain('EXISTS (SELECT 1 FROM public.staff_schedules ss WHERE ss.staff_id = p_staff_id)');
    for (const condition of [
      'so.staff_id = p_staff_id',
      "so.date >= (pg_catalog.now() AT TIME ZONE 'Asia/Tokyo')::date",
      'so.is_holiday IS NOT TRUE',
      'so.start_time IS NOT NULL',
      'so.end_time IS NOT NULL',
    ]) expect(body).toContain(condition);
  });

  test('facility_booking_ready は勤務時間のある在籍スタッフを要求し、ほかの条件は 1 つも落としていない', () => {
    const { file, body } = fn('facility_booking_ready');
    expect(file).toBe(MIGRATION);
    expect(body).toContain("LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''");
    expect(body).toMatch(/EXISTS \(SELECT 1 FROM public\.staff_profiles s WHERE s\.facility_id = f\.id AND s\.is_active\s+AND public\.staff_has_working_time\(s\.id\)\)/);
    for (const condition of [
      "f.status = 'published'", "f.name ~ '[^[:space:]　]'", "f.prefecture ~ '[^[:space:]　]'", "f.city ~ '[^[:space:]　]'",
      "f.address ~ '[^[:space:]　]'", 'public.confirmed_booking_hours(f.business_hours)',
      'EXISTS (SELECT 1 FROM public.facility_menus m WHERE m.facility_id = f.id AND m.is_published IS DISTINCT FROM false)',
      'EXISTS (SELECT 1 FROM public.facility_photos p WHERE p.facility_id = f.id)',
    ]) expect(body).toContain(condition);
  });

  test('検索カードの active_staff_count も同じ判定関数で数え、列の並びは変えていない', () => {
    const { file, body } = cardView();
    expect(file).toBe(MIGRATION);
    expect(body).toMatch(/SELECT count\(\*\)::integer AS active_staff_count FROM public\.staff_profiles s\s+WHERE s\.facility_id=fp\.id AND s\.is_active AND public\.staff_has_working_time\(s\.id\)/);
    expect(body).toContain('WITH (security_invoker=true,security_barrier=true)');
    const previous = withoutComments(readFileSync(join(MIGRATIONS, PREVIOUS_VIEW), 'utf8'));
    const before = previous.slice(previous.indexOf('CREATE OR REPLACE VIEW public.facility_card_view'));
    expect(viewColumns(body)).toEqual(viewColumns(before));
    expect(viewColumns(body)).toContain('active_staff_count');
  });

  test('アプリ側の読み方（workingStaffQuery）は同じ条件', () => {
    const source = readFileSync(join(ROOT, 'src/lib/facility-publish-gate.ts'), 'utf8');
    for (const call of [
      ".select('id, staff_schedules(staff_id), schedule_overrides(staff_id)')",
      ".eq('is_active', true)",
      ".gte('schedule_overrides.date', today)",
      ".not('schedule_overrides.is_holiday', 'is', true)",
      ".not('schedule_overrides.start_time', 'is', null)",
      ".not('schedule_overrides.end_time', 'is', null)",
    ]) expect(source).toContain(call);
    // 今日は日本時間（SQL 側の Asia/Tokyo と揃える）
    expect(source).toMatch(/today: string = todayJst\(\)/);
  });

  // 施設設定の注意書きだけが「有効スタッフ」のまま残っていた。スタッフを追加しただけで条件がそろったと
  // 読めてしまい、施設ページは「ネット予約は準備中です」のまま（ダッシュボード・3日目メールとも食い違う）。
  test('施設設定の注意書きも「勤務時間を保存したスタッフ」を条件として案内する', () => {
    const settings = readFileSync(join(ROOT, 'src/app/admin/settings/page.tsx'), 'utf8');
    // 全曜日の営業時間は 2026年10月23日から無料掲載の公開条件（LISTING_PUBLISH_REQUIREMENT）として先に案内する。
    expect(settings).toContain('{LISTING_PUBLISH_REQUIREMENT}ネット予約は、さらに公開メニュー・写真・勤務時間を保存したスタッフがそろうまで利用できません。');
    expect(settings).not.toContain('有効スタッフ');
  });
});

describe('migration の形', () => {
  const code = withoutComments(readFileSync(join(MIGRATIONS, MIGRATION), 'utf8'));

  test('CareLink の DB でなければ何もしない', () => {
    expect(code.trim().startsWith("DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;")).toBe(true);
  });

  test('置き換えと追加だけ（アプリより先に適用しても旧アプリが動く）・データは変えない', () => {
    expect(code).not.toMatch(/DROP\s+(TABLE|COLUMN|FUNCTION|VIEW)|ALTER\s+(TABLE|COLUMN)|RENAME|INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM/i);
    expect(code.match(/^CREATE FUNCTION/gm)).toBeNull();
  });

  test('来訪者（anon）もカードと予約可否を評価できる権限を、既存と同じ内容で書き直している', () => {
    expect(code).toContain('REVOKE ALL ON FUNCTION public.staff_has_working_time(uuid) FROM PUBLIC;');
    expect(code).toContain('GRANT EXECUTE ON FUNCTION public.staff_has_working_time(uuid) TO anon, authenticated, service_role;');
    expect(code).toContain('REVOKE ALL ON FUNCTION public.facility_booking_ready(uuid) FROM PUBLIC;');
    expect(code).toContain('GRANT EXECUTE ON FUNCTION public.facility_booking_ready(uuid) TO anon, authenticated, service_role;');
    expect(code).toContain('REVOKE ALL ON public.facility_card_view FROM PUBLIC,anon,authenticated,service_role;');
    expect(code).toContain('GRANT SELECT ON public.facility_card_view TO anon,authenticated,service_role;');
  });

  test('勤務を作らなくする migration より先に適用される（その間に「予約OK」と「満枠」が食い違わない）', () => {
    expect(files.indexOf(MIGRATION)).toBeGreaterThanOrEqual(0);
    expect(files.indexOf(MIGRATION)).toBeLessThan(files.indexOf(STAFF_CREATE));
  });
});
