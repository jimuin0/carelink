/**
 * @jest-environment node
 *
 * 無料キャンセルの期限を過ぎた予約は、お客様がオンラインで日時を変更できない
 * （神原さん決定・2026年10月23日・案A）。migration 20261023164100 を固定する。
 *
 * jest から SQL は実行できないため、実 DB での挙動は supabase/shadow/change-free-cancel-window-fixtures.sql
 * が CI の使い捨て PG17 で確かめる。ここでは
 *   - change_booking_atomic が「最新定義（20261023070000）の写し＋意図した行だけ」であること
 *   - 判定が公開経路（p_enforce_schedule = true）だけに効き、店舗の手動変更には効かないこと
 *   - 判定がアプリの isPastFreeCancelWindow と同じ読み方（NULL の読み替え）をしていること
 *   - 接続先ガード・権限・データを書き換えないこと・適用順の記載
 *   - shadow fixture が CI に配線されていること
 * を固定する。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const read = (name: string) => readFileSync(join(MIGRATIONS, name), 'utf8');
const FILE = '20261023164100_customer_change_closes_with_free_cancel_window.sql';
const WINDOW = read(FILE);
const PREVIOUS = read('20261023070000_booking_start_must_be_future.sql');

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

const DECLARATIONS = `
  -- 2026-10-23 (BOOKING_CHANGE_WINDOW_CLOSED): the shop's cancellation policy.
  v_cancel_rule TEXT;
  v_free_cancel_hours INT;
  v_late_cancel_rate INT;`;

describe(`${FILE} の形`, () => {
  test('接続先ガードが最初の文', () => {
    expect(topLevel(WINDOW).trim()).toMatch(/^DO <body>;/);
    expect(WINDOW).toMatch(/^DO \$guard\$\nBEGIN\n  IF to_regclass\('public\.facility_profiles'\) IS NULL THEN\n    RAISE EXCEPTION 'not the CareLink database';/m);
    expect(WINDOW.indexOf('DO $guard$')).toBeLessThan(WINDOW.indexOf('CREATE OR REPLACE FUNCTION'));
  });

  test('データを書き換えない（トップレベルに UPDATE / INSERT / DELETE / DROP が無い）', () => {
    expect(topLevel(WINDOW)).not.toMatch(/\b(UPDATE|INSERT INTO|DELETE FROM|DROP)\b/i);
  });

  test('アプリのデプロイの前後どちらに適用しても安全と明記している', () => {
    expect(WINDOW).toContain('Order: safe to apply before or after the application deploy.');
  });

  test('権限は元の migration と同じ文を再記述し、API のロールへ実行権を渡さない', () => {
    expect(WINDOW).toContain('REVOKE ALL ON FUNCTION public.change_booking_atomic(uuid,uuid,date,time,time,boolean) FROM PUBLIC, anon, authenticated;');
    expect(WINDOW).toContain('GRANT EXECUTE ON FUNCTION public.change_booking_atomic(uuid,uuid,date,time,time,boolean) TO service_role;');
    expect(WINDOW).not.toMatch(/GRANT [^;]*TO [^;]*(anon|authenticated|PUBLIC)/);
    expect(WINDOW.indexOf('REVOKE ALL ON FUNCTION public.change_booking_atomic')).toBeGreaterThan(WINDOW.indexOf('\n$$;'));
  });

  // 後続で定義し直す migration（20261023180000＝BOOKING_NO_CAPABLE_STAFF を足した写し）も、
  // 宣言と判定を一字一句そのまま引き継ぐこと＝定義し直しで期限の判定が消えないこと。
  test('後続で change_booking_atomic を定義し直す migration も、期限の判定をそのまま引き継ぐ', () => {
    const later = readdirSync(MIGRATIONS)
      .filter((f) => /^\d{14}_/.test(f) && f > FILE)
      .filter((f) => /FUNCTION\s+(public\.)?change_booking_atomic\s*\(/i.test(read(f)));
    expect(later).toEqual(['20261023180000_booking_ready_hours_overlap_and_capable_staff.sql']);
    const own = definition(WINDOW, 'change_booking_atomic');
    const check = own.slice(own.indexOf('  -- 2026-10-23 BOOKING_CHANGE_WINDOW_CLOSED'), own.indexOf('  v_nominated :='));
    for (const f of later) {
      const redefined = definition(read(f), 'change_booking_atomic');
      expect(redefined).toContain(DECLARATIONS);
      expect(redefined).toContain(check);
    }
  });
});

describe('change_booking_atomic: 無料キャンセルの期限を過ぎたら公開経路の変更を断る', () => {
  const next = definition(WINDOW, 'change_booking_atomic');
  const check = next.slice(next.indexOf('  -- 2026-10-23 BOOKING_CHANGE_WINDOW_CLOSED'), next.indexOf('  v_nominated :='));

  test('最新定義（20261023070000）に宣言と判定を足しただけ（署名・SECURITY DEFINER・search_path は同じ）', () => {
    expect(next).toContain(DECLARATIONS);
    expect(check).toContain("RAISE EXCEPTION 'BOOKING_CHANGE_WINDOW_CLOSED:");
    expect(next.replace(DECLARATIONS, '').replace(check, '')).toBe(definition(PREVIOUS, 'change_booking_atomic'));
    expect(next).toContain('p_enforce_schedule BOOLEAN DEFAULT FALSE\n)\nRETURNS VOID\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public\nAS $$');
  });

  test('判定は開始済み・変更先の判定の後、ロックと更新の前に置く', () => {
    expect(next.indexOf("RAISE EXCEPTION 'BOOKING_ALREADY_STARTED'")).toBeLessThan(next.indexOf('BOOKING_CHANGE_WINDOW_CLOSED:'));
    expect(next.indexOf("RAISE EXCEPTION 'BOOKING_SLOT_PASSED")).toBeLessThan(next.indexOf('BOOKING_CHANGE_WINDOW_CLOSED:'));
    expect(next.indexOf('BOOKING_CHANGE_WINDOW_CLOSED:')).toBeLessThan(next.indexOf('UPDATE bookings'));
  });

  test('公開経路（p_enforce_schedule = true）だけ。店舗の手動変更（false）は影響を受けない', () => {
    expect(check).toMatch(/^ {2}IF p_enforce_schedule THEN\n/m);
    // 判定は全てこの IF の内側にある（IF と END IF の対応が閉じている）。
    const inner = check.slice(check.indexOf('  IF p_enforce_schedule THEN'));
    expect(inner.trimEnd().endsWith('  END IF;')).toBe(true);
  });

  test('アプリ（isPastFreeCancelWindow）と同じ読み方: 今の開始時刻・free_window か旧い行・時間 NULL=24・料率 NULL=0', () => {
    expect(check).toContain('FROM public.facility_cancel_policies p\n    WHERE p.facility_id = v_facility_id\n    FOR SHARE;');
    expect(check).toContain("AND (v_cancel_rule IS NULL OR v_cancel_rule = 'free_window')");
    expect(check).toContain('AND COALESCE(v_free_cancel_hours, 24) > 0');
    expect(check).toContain('AND COALESCE(v_late_cancel_rate, 0) > 0');
    // 変更先（p_booking_date）ではなく、今の予約（v_old_date + v_old_start）の開始時刻で判定する。
    expect(check).toContain("AND (v_old_date + v_old_start) AT TIME ZONE 'Asia/Tokyo'\n        < clock_timestamp() + make_interval(hours => COALESCE(v_free_cancel_hours, 24)) THEN");
    expect(check).not.toContain('p_booking_date');
  });

  test('API は DB の拒否コードを同じ案内に写す', () => {
    const route = readFileSync(join(ROOT, 'src/app/api/booking/[id]/change/route.ts'), 'utf8');
    expect(route).toContain("msg.includes('BOOKING_CHANGE_WINDOW_CLOSED')");
    expect(route).toContain('isPastFreeCancelWindow(');
  });
});

test('実 DB での挙動を確かめる shadow fixture が CI に配線されている', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
  expect(workflow).toContain('psql -X -v ON_ERROR_STOP=1 -d carelink_shadow -f supabase/shadow/change-free-cancel-window-fixtures.sql');
  const fixture = readFileSync(join(ROOT, 'supabase/shadow/change-free-cancel-window-fixtures.sql'), 'utf8');
  expect(fixture).toMatch(/^BEGIN;$/m);
  expect(fixture.trim().endsWith('ROLLBACK;')).toBe(true);
  expect(fixture).toContain("IF current_database() NOT LIKE 'carelink_shadow%'");
  for (const label of [
    'a customer change inside the free-cancellation window is refused',
    'the shop can still move the reservation inside the window',
    'a customer change before the free-cancellation deadline is accepted',
    'change_customer_booking_with_channels_atomic',
    '期限なし (always_fee): a change is accepted',
  ]) {
    expect(fixture).toContain(label);
  }
});
