/**
 * @jest-environment node
 *
 * サロンボードの「指名なし」の電話予約が、勤務時間を登録したスタッフがいないと
 * 「この時間帯は既に予約が入っています」と誤って断られる（2026年10月23日）。
 *
 * 20261023080100 からスタッフを追加しても勤務時間は作られない。在籍スタッフの誰も勤務時間を保存していない店舗で
 * 「指名なし」から電話予約を入れると、create_booking_for_menus_atomic のおまかせ分岐で割り当てる人がいない
 * （booking_pick_free_staff は勤務している人しか返さない）ため BOOKING_CONFLICT になり、空のボードに
 * 「既に予約が入っています」と出ていた。20261023130100 で、手動予約（p_enforce_schedule が true でない）かつ
 * 勤務している在籍スタッフが 1 人もいないときは BOOKING_NO_WORKING_STAFF を返すようにした。
 *
 * 実 DB での挙動は supabase/shadow/manual-unassigned-no-working-staff-fixtures.sql が CI の使い捨て PG17 で
 * 確かめる。ここでは migration が最新定義の写し＋意図した分岐だけであること、ネット予約の分岐を変えないこと、
 * 権限・適用順序の明記、fixture の配線を固定する。API と画面の対応は各テスト
 * （/api/admin/bookings・BoardScheduleGrid）が固定する。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const MIGRATION = '20261023130100_manual_unassigned_booking_no_working_staff.sql';
const SOURCE = '20261023000100_booking_visit_points_cap.sql';
const FIXTURE = 'supabase/shadow/manual-unassigned-no-working-staff-fixtures.sql';
const read = (name: string) => readFileSync(join(MIGRATIONS, name), 'utf8');
const sql = read(MIGRATION);
const HEAD = 'CREATE OR REPLACE FUNCTION public.create_booking_for_menus_atomic(';
const TAIL = 'GRANT EXECUTE ON FUNCTION public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])\n  TO service_role;';
const block = (text: string) => {
  const start = text.indexOf(HEAD);
  expect(start).toBeGreaterThanOrEqual(0);
  return text.slice(start, text.indexOf(TAIL, start) + TAIL.length);
};
const topLevel = (text: string) => text.replace(/\$\$[\s\S]*?\$\$/g, '$$ … $$').replace(/--[^\n]*/g, '');

const OLD_PICK = `    IF v_staff_id IS NULL THEN
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
`;
const NEW_PICK = `    IF v_staff_id IS NULL THEN
      -- 20261023130100: a manual (phone) booking without a nomination when no active
      -- staff member works the slot at all is not a double booking. Say so, so the
      -- shop picks a staff member (manual named bookings ignore shifts) or saves the
      -- shifts. Online bookings (p_enforce_schedule) keep BOOKING_CONFLICT.
      IF p_enforce_schedule IS NOT TRUE AND NOT EXISTS (
        SELECT 1 FROM public.staff_profiles sp
        WHERE sp.facility_id = p_facility_id AND sp.is_active = true
          AND public.booking_staff_works_slot(sp.id, p_booking_date, p_start_time, p_end_time)
      ) THEN
        RAISE EXCEPTION 'BOOKING_NO_WORKING_STAFF: この時間に勤務予定のスタッフがいません';
      END IF;
      RAISE EXCEPTION 'BOOKING_CONFLICT: この時間帯は既に予約が入っています';
    END IF;
`;

describe('migration の形', () => {
  test('接続先ガードが最初の文', () => {
    expect(topLevel(sql).trim()).toMatch(/^DO \$guard\$ BEGIN IF to_regclass\('public\.facility_profiles'\) IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END \$guard\$;/);
  });

  test('関数の置き換えだけで、データ・表は触らない', () => {
    const code = topLevel(sql);
    expect(code).not.toMatch(/\b(UPDATE|INSERT INTO|DELETE FROM|DROP|ALTER TABLE|CREATE TRIGGER|TRUNCATE)\b/i);
    expect(code.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
  });

  test('署名・属性・権限は以前と同じ（service_role 専用）', () => {
    const next = block(sql);
    expect(next).toContain('RETURNS UUID\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public\nAS $$');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])\n  FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain(TAIL);
    expect(sql).not.toMatch(/GRANT [^;]*create_booking_for_menus_atomic[^;]*TO [^;]*(anon|authenticated|PUBLIC)/);
  });

  test('適用順序（アプリのデプロイの後）と理由を明記している', () => {
    expect(sql).toContain('適用順序: アプリのデプロイの【後】に適用する。');
    expect(sql).toContain('BOOKING_NO_WORKING_STAFF を知らないので');
  });
});

describe('最新定義の写し＋おまかせ分岐の 1 か所だけ', () => {
  test('このファイルより前で最後に create_booking_for_menus_atomic を定義しているのは 20261023000100', () => {
    const earlier = readdirSync(MIGRATIONS)
      .filter((f) => /^\d{14}_.*\.sql$/.test(f) && f < MIGRATION)
      .filter((f) => /CREATE (?:OR REPLACE )?FUNCTION public\.create_booking_for_menus_atomic\(/.test(read(f)))
      .sort();
    expect(earlier[earlier.length - 1]).toBe(SOURCE);
    // pg_get_functiondef で書き換える migration も無い（写し元が最終形であること）
    for (const f of readdirSync(MIGRATIONS).filter((name) => name > SOURCE && name < MIGRATION)) {
      expect([f, /pg_get_functiondef\('public\.create_booking_for_menus_atomic/.test(read(f))]).toEqual([f, false]);
    }
    expect(read('combined_phase2_to_6.sql')).not.toContain('FUNCTION public.create_booking_for_menus_atomic(');
  });

  test('分岐を元に戻すと 20261023000100 と一字一句同じ', () => {
    const next = block(sql);
    expect(next.split(NEW_PICK)).toHaveLength(2);
    expect(next.replace(NEW_PICK, OLD_PICK)).toBe(block(read(SOURCE)));
  });

  test('新しいコードは BOOKING_CONFLICT を含まない（API が重複と取り違えない）', () => {
    expect('BOOKING_NO_WORKING_STAFF').not.toContain('BOOKING_CONFLICT');
    const route = readFileSync(join(ROOT, 'src/app/api/admin/bookings/route.ts'), 'utf8');
    expect(route.indexOf("includes('BOOKING_NO_WORKING_STAFF')")).toBeGreaterThan(0);
  });
});

test('実 DB での検証が CI で実行され、手動の指名なし・指名あり・ネット予約を確かめている', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
  expect(workflow).toContain(`-d carelink_shadow -f ${FIXTURE}`);
  expect(workflow.indexOf('bash scripts/gen-schema-fingerprint.sh --check')).toBeLessThan(workflow.indexOf(`-f ${FIXTURE}`));
  const fixture = readFileSync(join(ROOT, FIXTURE), 'utf8');
  expect(fixture).toMatch(/^BEGIN;$/m);
  expect(fixture.trim().endsWith('ROLLBACK;')).toBe(true);
  for (const label of ['指名なし without working staff', 'the refused booking and its operation are not stored',
    'named B is accepted at the same time', 'online おまかせ without working staff is unchanged',
    'online named B without a shift is unchanged', '指名なし goes to the working A',
    'working staff all busy is still BOOKING_CONFLICT', 'a shift ending inside the slot does not count',
    'after saving the shift, 指名なし goes to B', 'a holiday override is not working']) {
    expect(fixture).toContain(label);
  }
});
