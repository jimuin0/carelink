/**
 * @jest-environment node
 *
 * マイページ「お知らせメールを受け取る」の書き込み経路を固定する（2026年10月22日 新設）。
 *
 * 【欠陥】メールの配信停止リンクは profiles.email_unsubscribed と newsletter_subscriptions の抑止行の
 * 2 つを書くのに、マイページはブラウザから profiles の旗だけを戻していた。抑止行が残るので
 * 「配信を再開しました」と出るのにニュースレターは二度と届かなかった（抑止行は本人から見えず、
 * authenticated には書き込み権も無い）。
 *
 * 【守るもの】
 *   1. 切り替えは service_role 専用の set_newsletter_preference_atomic（旗と抑止行を 1 トランザクション）
 *      だけを通す。migration は接続先ガードが最初の文で、SECURITY DEFINER＋search_path 固定、
 *      ブラウザのロールには EXECUTE を渡さない。後続の migration が権限を戻していない
 *   2. 再購読する宛先は auth.users（確認済みログインメール）から取る。profiles.email は本人が自由に
 *      書き換えられるので、そこを宛先にすると他人が配信停止した宛先を再購読させられる
 *   3. アプリのコードが profiles.email_unsubscribed をブラウザから直接書き換えていない
 *   4. 実 DB での検証（shadow fixture）が CI に配線されている
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const MIGRATION = '20261022180000_newsletter_preference_atomic.sql';
const FIXTURE = 'supabase/shadow/newsletter-preference-fixtures.sql';
const SIGNATURE = 'set_newsletter_preference_atomic(uuid,boolean)';
/** コメントを除いた SQL（説明文の中の語に反応しない）。 */
const code = (text: string) => text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
const body = code(readFileSync(join(MIGRATIONS, MIGRATION), 'utf8'));
const GUARD_FIRST = /^DO \$guard\$ BEGIN IF to_regclass\('public\.facility_profiles'\) IS NULL THEN RAISE EXCEPTION/;

/** 関数本体（$$ … $$）だけを取り出す。 */
function functionBody(sql: string): string {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.set_newsletter_preference_atomic');
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$', open + 2);
  return sql.slice(open + 2, close);
}

describe('migration', () => {
  test('接続先ガードが最初の文', () => {
    expect(body.trim()).toMatch(GUARD_FIRST);
  });

  test('SECURITY DEFINER・search_path 固定・service_role 専用', () => {
    expect(body).toMatch(/CREATE OR REPLACE FUNCTION public\.set_newsletter_preference_atomic\(p_user_id uuid, p_receive boolean\) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''/);
    expect(body).toContain(`REVOKE ALL ON FUNCTION public.${SIGNATURE} FROM PUBLIC,anon,authenticated;`);
    expect(body).toContain(`GRANT EXECUTE ON FUNCTION public.${SIGNATURE} TO service_role;`);
    expect(body).not.toMatch(/GRANT [^;]*set_newsletter_preference_atomic[^;]*\bTO [^;]*\b(anon|authenticated|PUBLIC)\b/i);
  });

  test('再購読の宛先は確認済み（email_confirmed_at あり）のログインメール（auth.users）だけ。profiles.email を宛先に使わない', () => {
    const fn = functionBody(body);
    expect(fn).toMatch(/SELECT lower\(btrim\(u\.email\)\) INTO address FROM auth\.users u WHERE u\.id=p_user_id AND u\.email_confirmed_at IS NOT NULL;/);
    expect(fn).not.toMatch(/\b(p\.)?email\b[^;]*FROM public\.profiles/i);
    // profiles の旗は本人の行だけ
    expect(fn).toMatch(/UPDATE public\.profiles SET email_unsubscribed = NOT p_receive WHERE id=p_user_id;/);
    // 抑止行の解除は本人の宛先だけ。配信停止リンクが作った抑止専用行は消し、以前の購読は戻す
    expect(fn).toMatch(/DELETE FROM public\.newsletter_subscriptions WHERE lower\(btrim\(email\)\)=address AND NOT is_active AND source='unsubscribe';/);
    expect(fn).toMatch(/UPDATE public\.newsletter_subscriptions SET is_active=true, unsubscribed_at=NULL WHERE lower\(btrim\(email\)\)=address AND NOT is_active;/);
  });

  test('配信停止リンク（unsubscribe_newsletter_atomic）と同じロック順（アカウント → profiles → 抑止行）', () => {
    const fn = functionBody(body);
    const account = fn.indexOf('PERFORM public.lock_booking_account(p_user_id)');
    const profile = fn.indexOf('FROM public.profiles WHERE id=p_user_id FOR UPDATE');
    const subs = fn.indexOf('FROM public.newsletter_subscriptions WHERE lower(btrim(email))=address ORDER BY id FOR UPDATE');
    expect(account).toBeGreaterThan(-1);
    expect(profile).toBeGreaterThan(account);
    expect(subs).toBeGreaterThan(profile);
  });

  test('後続の migration が関数を置き換えたり、ブラウザのロールへ権限を戻したりしていない', () => {
    const later = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && f !== MIGRATION
      && (f > MIGRATION || !/^\d/.test(f)));
    for (const file of later) {
      const sql = code(readFileSync(join(MIGRATIONS, file), 'utf8'));
      expect({ file, redefines: /FUNCTION (public\.)?set_newsletter_preference_atomic/i.test(sql) }).toEqual({ file, redefines: false });
    }
  });
});

describe('アプリの経路', () => {
  /** src 配下のテスト以外の .ts / .tsx */
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }

  test('profiles.email_unsubscribed を直接書き換えるコードが無い（API → RPC だけ）', () => {
    const offenders = sources(join(ROOT, 'src'))
      .filter((path) => /\.update\(\s*\{[^}]*\bemail_unsubscribed\b/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });

  test('マイページのトグルは /api/profile/newsletter を通す', () => {
    const page = readFileSync(join(ROOT, 'src/app/mypage/profile/page.tsx'), 'utf8');
    expect(page).toContain("fetch('/api/profile/newsletter'");
  });

  test('API は本人の id で RPC を呼ぶ', () => {
    const route = readFileSync(join(ROOT, 'src/app/api/profile/newsletter/route.ts'), 'utf8');
    expect(route).toMatch(/rpc\('set_newsletter_preference_atomic', \{\s*p_user_id: ctx\.user!\.id,/);
  });

  test('実 DB の検証（shadow fixture）が CI に配線されている', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
    expect(workflow).toContain(`-f ${FIXTURE}`);
    const fixture = readFileSync(join(ROOT, FIXTURE), 'utf8');
    expect(fixture).toContain('set_newsletter_preference_atomic');
    expect(fixture.trim().endsWith('ROLLBACK;')).toBe(true);
  });
});
