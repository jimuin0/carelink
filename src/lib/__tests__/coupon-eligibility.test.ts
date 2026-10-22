/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * クーポンの「対象：新規／リピーター」（2026年10月22日 新設）。
 *
 * 判定の権威は予約 RPC（supabase/migrations/20261022160000_coupon_target_eligibility.sql）。
 * この環境から SQL は実行できないため（実行検証は supabase/shadow/coupon-target-eligibility-fixtures.sql
 * が CI の使い捨て PG17 で行う）、ここでは
 *  - 画面側の判定・文言（src/lib/coupon-eligibility.ts）
 *  - migration が「最新の関数定義の写し＋判定の追加だけ」であること
 *  - migration の拒否コード・数えないステータスが TS 側の定数と一致すること
 * を固定する。
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  COUPON_HISTORY_IGNORED_STATUSES,
  COUPON_TARGET_ADMIN_HELP,
  COUPON_TARGET_REJECTIONS,
  couponTargetCondition,
  isCouponBlockedByHistory,
} from '../coupon-eligibility';

const MIGRATIONS = join(process.cwd(), 'supabase/migrations');
const read = (name: string) => readFileSync(join(MIGRATIONS, name), 'utf8');
const NEW_MIGRATION = '20261022160000_coupon_target_eligibility.sql';
const PREVIOUS_DEFINITION = '20261022100000_booking_staff_assignment.sql';
const FUNCTION_HEAD = 'CREATE OR REPLACE FUNCTION public.create_booking_for_menus_atomic(';
const GRANT_TAIL = 'GRANT EXECUTE ON FUNCTION public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])\n  TO service_role;';

function functionBlock(sql: string): string {
  const start = sql.indexOf(FUNCTION_HEAD);
  const end = sql.indexOf(GRANT_TAIL, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end + GRANT_TAIL.length);
}

describe('isCouponBlockedByHistory', () => {
  test.each([
    ['new_customer', true, true],
    ['new_customer', false, false],
    ['repeat', true, false],
    ['repeat', false, true],
    ['all', true, false],
    ['all', false, false],
    ['limited_time', true, false],
  ] as const)('%s / 予約履歴 %s → 使えない=%s', (type, history, blocked) => {
    expect(isCouponBlockedByHistory(type, history)).toBe(blocked);
  });

  test.each(['new_customer', 'repeat', 'all'])('履歴が不明なら %s を止めない（確定時に RPC が判定する）', (type) => {
    expect(isCouponBlockedByHistory(type, null)).toBe(false);
  });
});

describe('couponTargetCondition', () => {
  test('新規・リピーターだけ利用条件を返す', () => {
    expect(couponTargetCondition('new_customer')).toBe('この店舗を初めてご予約の方限定');
    expect(couponTargetCondition('repeat')).toBe('この店舗で2回目以降のご予約の方限定');
    expect(couponTargetCondition('all')).toBeNull();
    expect(couponTargetCondition('limited_time')).toBeNull();
  });

  test('管理画面の説明はキャンセルを数えないことを明記する', () => {
    expect(COUPON_TARGET_ADMIN_HELP).toContain('キャンセルした予約は数えません');
  });
});

describe('migration（予約 RPC 側の判定）', () => {
  const sql = read(NEW_MIGRATION);

  test('CareLink のガードで始まり、関数の権限を再設定している', () => {
    expect(sql).toMatch(/DO \$guard\$\s*BEGIN\s*IF to_regclass\('public\.facility_profiles'\) IS NULL THEN\s*RAISE EXCEPTION 'not the CareLink database';/);
    expect(sql.indexOf('DO $guard$')).toBeLessThan(sql.indexOf(FUNCTION_HEAD));
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])\n  FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain(GRANT_TAIL);
    expect(sql).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
  });

  test('拒否コードは /api/booking の文言表と一致する', () => {
    const raised = [...sql.matchAll(/RAISE EXCEPTION '([A-Z_]+):/g)].map((m) => m[1]);
    for (const code of Object.keys(COUPON_TARGET_REJECTIONS)) expect(raised).toContain(code);
  });

  test('予約履歴として数えないステータスは TS 側と同じ集合', () => {
    const m = sql.match(/b\.status NOT IN \(([^)]*)\)/);
    expect(m).not.toBeNull();
    const statuses = m![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    expect(statuses).toEqual([...COUPON_HISTORY_IGNORED_STATUSES]);
  });

  test('最新の定義（20261022100000）の写しに、判定の追加だけをしている', () => {
    const previous = functionBlock(read(PREVIOUS_DEFINITION));
    const next = functionBlock(sql);
    const undo = next
      .replace(/  -- Coupon target \(新規／リピーター\) check, see below\.\n  v_coupon_type TEXT;\n  v_email_canonical TEXT;\n  v_has_history BOOLEAN;\n/, '')
      .replace('SELECT max_uses, coupon_type INTO v_max_uses, v_coupon_type FROM coupons', 'SELECT max_uses INTO v_max_uses FROM coupons')
      .replace(/RETURNING id, email_canonical INTO v_booking_id, v_email_canonical;\n\n  -- Coupon target \(2026-10-22\)[\s\S]*?\n  END IF;\n(?=\n  IF p_coupon_id IS NOT NULL THEN\n    BEGIN)/, 'RETURNING id INTO v_booking_id;\n');
    expect(undo).toBe(previous);
    expect(next).not.toBe(previous);
  });

  test('この migration より後に create_booking_for_menus_atomic を定義・改変する migration は無い', () => {
    const later = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && f > NEW_MIGRATION && /^\d/.test(f))
      .filter((f) => read(f).includes('create_booking_for_menus_atomic'));
    expect(later).toEqual([]);
  });
});
