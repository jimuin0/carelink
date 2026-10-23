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
  COUPON_VISIT_STATUSES,
  couponTargetBlock,
  couponTargetCondition,
  isTargetedCoupon,
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

describe('couponTargetBlock', () => {
  test.each(['new_customer', 'repeat'])('ゲストと分かれば %s は選べない（ログインが必要）', (type) => {
    expect(couponTargetBlock(type, { signedIn: false, hasBooking: null })).toBe('login');
    expect(couponTargetBlock(type, { signedIn: false, hasBooking: true })).toBe('login');
  });

  test.each([
    ['new_customer', true, 'history'],
    ['new_customer', null, null],
    ['repeat', true, null],
    ['repeat', null, null],
  ] as const)('ログイン中・%s・本人の予約あり=%s → %s', (type, hasBooking, block) => {
    expect(couponTargetBlock(type, { signedIn: true, hasBooking })).toBe(block);
  });

  test.each(['new_customer', 'repeat'])('ログイン状態が分からないうちは %s を止めない', (type) => {
    expect(couponTargetBlock(type, { signedIn: null, hasBooking: null })).toBeNull();
  });

  test.each(['all', 'limited_time'])('%s は誰でも選べる', (type) => {
    expect(couponTargetBlock(type, { signedIn: false, hasBooking: true })).toBeNull();
    expect(isTargetedCoupon(type)).toBe(false);
  });
});

describe('couponTargetCondition', () => {
  test('新規・リピーターだけ利用条件を返す', () => {
    expect(couponTargetCondition('new_customer')).toBe('この店舗を初めてご予約の方限定');
    expect(couponTargetCondition('repeat')).toBe('この店舗にご来店いただいたことがある方限定');
    expect(couponTargetCondition('all')).toBeNull();
    expect(couponTargetCondition('limited_time')).toBeNull();
  });

  test('管理画面の説明は、キャンセルを数えないこと・リピーターは来店で決まること・ログインが必要なことを明記する', () => {
    expect(COUPON_TARGET_ADMIN_HELP).toContain('キャンセルした予約は数えません');
    expect(COUPON_TARGET_ADMIN_HELP).toContain('リピーター：この店舗に来店されたことがある方（ステータスが「受付」か「完了」の予約がある方）');
    expect(COUPON_TARGET_ADMIN_HELP).toContain('ログインしたお客様だけ');
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

  const statusList = (pattern: RegExp) => {
    const m = sql.match(pattern);
    expect(m).not.toBeNull();
    return m![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  };

  test('予約履歴として数えないステータスは TS 側と同じ集合', () => {
    expect(statusList(/b\.status NOT IN \(([^)]*)\)/)).toEqual([...COUPON_HISTORY_IGNORED_STATUSES]);
  });

  test('来店として数えるステータス（リピーター）は TS 側と同じ集合で、未来店の予約・無断キャンセルを含まない', () => {
    const visits = statusList(/b\.status IN \(([^)]*)\)/);
    expect(visits).toEqual([...COUPON_VISIT_STATUSES]);
    for (const notVisited of ['pending', 'confirmed', 'no_show', 'cancelled', 'cancel_fee_paid']) expect(visits).not.toContain(notVisited);
  });

  // 回帰（2026年10月22日 レビュー指摘）: 旧版は予約フォームに入力されたメールアドレス（p_email の正規化値）で
  // 他人の予約履歴を照合し、拒否はロールバックされて本人に何も届かないため、任意のアドレスの来店歴を
  // 調べられた。判定に使ってよいのはログインしたアカウント（p_user_id）とその確認済みメールだけ。
  describe('予約履歴の照合はログインしたアカウント自身に限る', () => {
    const block = sql.slice(sql.indexOf('  -- Coupon target (2026-10-22)'), sql.indexOf('  INSERT INTO bookings ('));

    test('判定は予約行を書く前に行い、入力されたメールアドレスを使わない', () => {
      expect(block.length).toBeGreaterThan(0);
      expect(block).toContain("IF v_coupon_type IN ('new_customer', 'repeat') THEN");
      expect(block).not.toMatch(/p_email|email_canonical INTO|v_email_canonical/);
      expect(sql).not.toContain('RETURNING id, email_canonical');
    });

    test('ゲストは履歴を見る前に COUPON_TARGET_LOGIN_REQUIRED で断る', () => {
      const guest = block.indexOf("IF p_user_id IS NULL THEN\n      RAISE EXCEPTION 'COUPON_TARGET_LOGIN_REQUIRED:");
      expect(guest).toBeGreaterThan(0);
      expect(guest).toBeLessThan(block.indexOf('FROM bookings b'));
      expect(guest).toBeLessThan(block.indexOf('FROM auth.users u'));
    });

    test('照合はアカウントの予約と、アカウントの確認済みメールアドレスの予約だけ', () => {
      expect(block).toContain('WHERE u.id = p_user_id AND u.email_confirmed_at IS NOT NULL;');
      const matches = [...block.matchAll(/AND \((b\.user_id = [^\n]*)\)\n/g)].map((m) => m[1]);
      expect(matches).toEqual([
        'b.user_id = p_user_id OR b.email_canonical = v_account_email',
        'b.user_id = p_user_id OR b.email_canonical = v_account_email',
      ]);
    });

    test('アカウントのメールアドレスの正規化は bookings.email_canonical の生成式と同じ', () => {
      const flat = (t: string) => t.replace(/\s+/g, ' ').trim();
      const generated = read('20260607_email_canonical_column.sql')
        .match(/ALTER TABLE bookings\s+ADD COLUMN IF NOT EXISTS email_canonical TEXT\s+GENERATED ALWAYS AS \(\s*(CASE[\s\S]*?END)\s*\) STORED;/);
      const account = block.match(/SELECT (CASE[\s\S]*?END)\s+INTO v_account_email/);
      expect(generated).not.toBeNull();
      expect(account).not.toBeNull();
      expect(flat(account![1]!)).toBe(flat(generated![1]!).replace(/\bemail\b/g, 'u.email'));
    });
  });

  test('最新の定義（20261022100000）の写しに、判定の追加だけをしている', () => {
    const previous = functionBlock(read(PREVIOUS_DEFINITION));
    const next = functionBlock(sql);
    const undo = next
      .replace(/  -- Coupon target \(新規／リピーター\) check, see below\.\n  v_coupon_type TEXT;\n  v_account_email TEXT;\n/, '')
      .replace('SELECT max_uses, coupon_type INTO v_max_uses, v_coupon_type FROM coupons', 'SELECT max_uses INTO v_max_uses FROM coupons')
      .replace(/\n  -- Coupon target \(2026-10-22\)[\s\S]*?\n  END IF;\n(?=\n  INSERT INTO bookings \()/, '');
    expect(undo).toBe(previous);
    expect(next).not.toBe(previous);
  });

  // 後の migration が関数を定義し直す場合（20261023000100 の来店ポイント上限）も、
  // 判定の部分を一字一句そのまま引き継いでいること＝定義し直しで判定が消えないこと。
  test('この migration より後に create_booking_for_menus_atomic を定義し直す migration も、判定をそのまま引き継ぐ', () => {
    const couponBlock = (text: string) => {
      const block = functionBlock(text);
      return block.slice(block.indexOf('  -- Coupon target (2026-10-22)'), block.indexOf('  INSERT INTO bookings ('));
    };
    const expected = couponBlock(sql);
    expect(expected).toContain("IF v_coupon_type IN ('new_customer', 'repeat') THEN");
    const later = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && f > NEW_MIGRATION && /^\d/.test(f))
      // 定義し直す migration だけを見る（呼び出すだけの migration＝20261023070000 の公開ラッパーは対象外）。
      .filter((f) => /CREATE (?:OR REPLACE )?FUNCTION public\.create_booking_for_menus_atomic\(/.test(read(f)));
    // 20261023130100 は「指名なし」で勤務中のスタッフがいないときのコードだけを変えた写し。
    // 20261023180000 は「指名なし」でメニューを担当できるスタッフがいないときのコードだけを足した写し。
    expect(later).toEqual([
      '20261023000100_booking_visit_points_cap.sql',
      '20261023130100_manual_unassigned_booking_no_working_staff.sql',
      '20261023180000_booking_ready_hours_overlap_and_capable_staff.sql',
    ]);
    for (const file of later) expect([file, couponBlock(read(file))]).toEqual([file, expected]);
  });
});
