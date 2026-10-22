/**
 * @jest-environment node
 *
 * 電話・来店受付の予約（メール無し）を電話番号で顧客管理に出す経路を固定する（2026年10月23日 新設）。
 *
 * 以前はメールでしか同じ人かを判定しなかったため、メール欄を空のまま完了にした電話予約は
 * 顧客管理のどこにも出ず、電話番号だけで台帳に登録したお客様は来店 0 回のままだった。
 *
 * 守るもの:
 *   1. migration が接続先ガードを最初に持ち、3 つの関数を SECURITY INVOKER・search_path='' で作り、
 *      anon から実行権を外している。既存の get_unique_customers は変えない（旧アプリを壊さない）
 *   2. DB（customer_phone_digits）とアプリ（phoneDigits / customerIdentityKey）の規則が同じ
 *      （全角数字の対応・10 桁の下限・'tel:' の接頭辞）。ずれると一覧と詳細で同じ人が別人になる
 *   3. アプリが新しい関数を使い、実 DB での検証（shadow fixture）が CI に配線されている
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { FULLWIDTH_DIGITS, MIN_PHONE_DIGITS, PHONE_KEY_PREFIX } from '@/lib/customer-identity';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const MIGRATION = '20261023090000_customer_phone_identity.sql';
const FIXTURE = 'supabase/shadow/customer-phone-identity-fixtures.sql';
const code = (text: string) => text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
const body = code(readFileSync(join(MIGRATIONS, MIGRATION), 'utf8'));
const FUNCTIONS = [
  ['customer_phone_digits', 'text'],
  ['get_customer_visit_summary', 'uuid'],
  ['get_customer_phone_visits', 'uuid, text'],
] as const;

describe('migration', () => {
  test('接続先ガードが最初の文', () => {
    expect(body.trim()).toMatch(/^DO \$guard\$ BEGIN IF to_regclass\('public\.facility_profiles'\) IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END \$guard\$;/);
  });

  test.each(FUNCTIONS)('%s は呼び出し元の権限で動き（RLS が効く）、anon は実行できない', (name, args) => {
    const def = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([^)]*\\) RETURNS [^$]*? SECURITY INVOKER SET search_path='' AS \\$\\$`);
    expect(body).toMatch(def);
    expect(body).toContain(`REVOKE ALL ON FUNCTION public.${name}(${args}) FROM PUBLIC, anon;`);
    expect(body).toContain(`GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO authenticated, service_role;`);
  });

  test('関数を足すだけ（既存の get_unique_customers・表・権限は変えない＝適用後も旧アプリが動く）', () => {
    expect(body).not.toMatch(/\bDROP\b/i);
    expect(body).not.toMatch(/get_unique_customers/);
    expect(body).not.toMatch(/\bALTER\b/i);
    expect(body.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(3);
    expect(body).not.toMatch(/SECURITY DEFINER/);
  });

  test('後の migration が 3 つの関数を作り直していない', () => {
    const later = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && (f > MIGRATION || !/^\d{14}_/.test(f)));
    expect(later).toContain('combined_phase2_to_6.sql'); // 空振りしていない
    for (const file of later) {
      const text = code(readFileSync(join(MIGRATIONS, file), 'utf8'));
      for (const [name] of FUNCTIONS) expect([file, new RegExp(`FUNCTION (public\\.)?${name}\\b`).test(text)]).toEqual([file, false]);
    }
  });
});

describe('DB とアプリで電話番号の規則が同じ', () => {
  test('全角数字の対応表が同じ', () => {
    expect(body).toContain(`translate(coalesce(p_phone, ''), '${FULLWIDTH_DIGITS}', '0123456789')`);
    expect([...FULLWIDTH_DIGITS].map((c) => c.normalize('NFKC')).join('')).toBe('0123456789');
  });

  test('数字以外を捨て、10 桁未満は使わない', () => {
    expect(body).toContain("'[^0-9]', '', 'g'");
    expect(body).toContain(`CASE WHEN length(d) >= ${MIN_PHONE_DIGITS} THEN d END`);
  });

  test("一覧のキーはメール（email_canonical）優先、無ければ 'tel:' ＋ 数字", () => {
    expect(body).toContain(`COALESCE(nullif(btrim(v.email_canonical), ''), '${PHONE_KEY_PREFIX}' || public.customer_phone_digits(b.phone)) AS customer_key`);
    // 詳細（電話番号の履歴）はメールの無い来店だけ
    expect(body).toContain("AND nullif(btrim(v.email_canonical), '') IS NULL AND public.customer_phone_digits(b.phone) = public.customer_phone_digits(p_phone)");
  });
});

describe('アプリの配線', () => {
  const admin = readFileSync(join(ROOT, 'src/lib/admin.ts'), 'utf8');
  const types = readFileSync(join(ROOT, 'src/types/database.types.ts'), 'utf8');
  const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
  const fixture = readFileSync(join(ROOT, FIXTURE), 'utf8');

  test('顧客一覧・詳細は新しい関数を使い、メールだけで数える旧関数は呼ばない', () => {
    expect(admin).toContain(".rpc('get_customer_visit_summary'");
    expect(admin).toContain(".rpc('get_customer_phone_visits'");
    expect(admin).not.toContain('get_unique_customers');
  });

  test('型に 3 つの関数が載っている', () => {
    for (const [name] of FUNCTIONS) expect(types).toMatch(new RegExp(`^ {6}${name}: \\{`, 'm'));
  });

  test('実 DB の検証が CI に配線され、3 つの関数すべてを実行している', () => {
    expect(workflow).toContain(`-f ${FIXTURE}`);
    for (const [name] of FUNCTIONS) expect(fixture).toContain(`public.${name}(`);
    expect(fixture).toMatch(/^BEGIN;$/m);
    expect(fixture.trim().endsWith('ROLLBACK;')).toBe(true);
  });
});
