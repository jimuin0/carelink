/**
 * @jest-environment node
 *
 * HPB メニュー取り込み（hpb_menu_durations）の書き込み経路を固定する（2026年10月23日 新設）。
 *
 * お客様メニューへの一括反映は、kind（クーポンは作らない）・store_id（別の店舗IDの行は作らない）・
 * missing_since（HPB で掲載終了の行は作らない）・applied_at（削除したものは作り直さない）を見て判断する。
 * 以前のポリシー hpb_menu_durations_member_all は FOR ALL で「その施設のメンバーか」しか見ず、
 * authenticated に INSERT / UPDATE / DELETE 権があったため、API が断る role='staff' を含むどのメンバーも
 * PostgREST を直接叩いてこれらの列を書き換えられた（kind='menu', price=1 の行を足すこともできた）。
 * RLS では列を絞れないので、ブラウザのロールから書き込み権を撤回し、読み取りも owner / admin に絞った。
 *
 * 守るもの:
 *   1. migration が接続先ガードを最初に持ち、FOR ALL ポリシーを消して owner / admin の読み取りだけを残し、
 *      anon / authenticated の書き込み権を撤回している。後の migration が戻していない
 *   2. アプリは service_role 経由でしかこの表に触れない（画面のコードは API を通す）
 *   3. 実 DB での検証（shadow fixture）が CI に配線されている
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const TRACKING_MIGRATION = '20261023030000_hpb_import_tracking.sql';
const CLOSE_MIGRATION = '20261023030100_hpb_menu_durations_service_role_writes.sql';
/** コメントを除いた SQL（説明文の中の語に反応しない）。 */
const code = (text: string) => text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
const closeBody = code(readFileSync(join(MIGRATIONS, CLOSE_MIGRATION), 'utf8'));
const GUARD_FIRST = /^DO \$guard\$ BEGIN IF to_regclass\('public\.facility_profiles'\) IS NULL THEN RAISE EXCEPTION/;

/** hpb_menu_durations への書き込み権をブラウザのロールへ（戻して）渡す GRANT。全テーブル一括も含む。 */
const REOPEN_GRANT = /GRANT [^;]*\b(INSERT|UPDATE|DELETE|ALL)\b[^;]*\bON (TABLE )?((public\.)?"?hpb_menu_durations"?(?!\w)|ALL TABLES IN SCHEMA public\b)[^;]*\bTO [^;]*\b(anon|authenticated|PUBLIC)\b/i;
/** FOR SELECT と明記していない CREATE POLICY は書き込みも含む（FOR 句なし＝FOR ALL）。 */
const WRITE_POLICY = /CREATE POLICY [^;]*?\bON (public\.)?"?hpb_menu_durations"?(?!\w)(?![^;]*\bFOR SELECT\b)/i;

describe('migration', () => {
  test('接続先ガードが最初の文で、列を足す migration の後に適用される', () => {
    expect(closeBody.trim()).toMatch(GUARD_FIRST);
    expect(CLOSE_MIGRATION > TRACKING_MIGRATION).toBe(true);
  });

  test('FOR ALL のポリシーを消し、owner / admin の読み取りだけを残す', () => {
    expect(closeBody).toContain('DROP POLICY IF EXISTS hpb_menu_durations_member_all ON public.hpb_menu_durations;');
    const policies = closeBody.match(/CREATE POLICY [^;]*;/g) ?? [];
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/^CREATE POLICY hpb_menu_durations_member_read ON public\.hpb_menu_durations FOR SELECT TO authenticated USING /);
    expect(policies[0]).toContain("role IN ('owner','admin')");
    expect(policies[0]).toContain('user_id=(SELECT auth.uid())');
  });

  test('anon / authenticated の書き込み権を撤回し、authenticated には読み取りだけを渡す', () => {
    expect(closeBody).toContain('REVOKE ALL ON public.hpb_menu_durations FROM anon, authenticated;');
    expect(closeBody.match(/\bGRANT [^;]*;/g)).toEqual(['GRANT SELECT ON public.hpb_menu_durations TO authenticated;']);
    expect(closeBody.indexOf('REVOKE ALL')).toBeLessThan(closeBody.indexOf('GRANT SELECT'));
  });

  test('後に適用される migration が書き込み権・書き込みポリシーを戻していない', () => {
    // 辞書順で後に走るもの＋タイムスタンプ接頭辞の無いもの（combined_phase2_to_6.sql は必ず最後に走る）
    const later = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && (f > CLOSE_MIGRATION || !/^\d{14}_/.test(f)));
    expect(later).toContain('combined_phase2_to_6.sql'); // 空振りしていない
    for (const file of later) {
      const text = code(readFileSync(join(MIGRATIONS, file), 'utf8'));
      expect([file, REOPEN_GRANT.test(text)]).toEqual([file, false]);
      expect([file, WRITE_POLICY.test(text)]).toEqual([file, false]);
    }
  });

  test.each([
    ['GRANT SELECT, INSERT, UPDATE, DELETE ON hpb_menu_durations TO authenticated', true],
    ['GRANT UPDATE (applied_at) ON public.hpb_menu_durations TO authenticated', true],
    ['GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon', true],
    ['GRANT SELECT ON public.hpb_menu_durations TO authenticated', false],
    ['GRANT ALL ON public.hpb_menu_durations TO service_role', false],
  ])('書き込み権の検出（負の対照つき）: %s', (statement, reopened) => {
    expect(REOPEN_GRANT.test(`${statement};`)).toBe(reopened);
  });

  test.each([
    ['CREATE POLICY "hpb_menu_durations_member_all" ON hpb_menu_durations FOR ALL USING (true)', true],
    ['CREATE POLICY p ON public.hpb_menu_durations USING (true)', true],
    ['CREATE POLICY p ON public.hpb_menu_durations FOR UPDATE USING (true)', true],
    ['CREATE POLICY hpb_menu_durations_member_read ON public.hpb_menu_durations FOR SELECT TO authenticated USING (true)', false],
  ])('書き込みポリシーの検出（FOR 句なし＝ALL も拾う・負の対照つき）: %s', (statement, found) => {
    expect(WRITE_POLICY.test(`${statement};`)).toBe(found);
  });
});

describe('アプリは service_role 経由でしか hpb_menu_durations に触れない', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : walk(full);
      return /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  }
  const sources = walk(join(ROOT, 'src')).map((file) => ({ file: relative(ROOT, file), text: readFileSync(file, 'utf8') }));

  test('表を直接指す .from() は src/lib/hpb-menu.ts の定数だけ', () => {
    expect(sources.length).toBeGreaterThan(500); // 空振りしていない
    const direct = sources.filter((s) => /\.from\(\s*['"]hpb_menu_durations['"]\s*\)/.test(s.text)).map((s) => s.file);
    expect(direct).toEqual([]);
    const lib = sources.find((s) => s.file === 'src/lib/hpb-menu.ts')!.text;
    expect(lib).toContain("const TABLE = 'hpb_menu_durations';");
  });

  test('src/lib/hpb-menu.ts を使うのは API と cron だけで、どれも service_role のクライアントを渡す', () => {
    const importers = sources.filter((s) => s.text.includes("from '@/lib/hpb-menu'"));
    expect(importers.map((s) => s.file).sort()).toEqual([
      'src/app/api/admin/hpb-menus/apply/route.ts',
      'src/app/api/admin/hpb-menus/route.ts',
      'src/app/api/cron/hpb-menu-scrape/route.ts',
    ]);
    for (const { file, text } of importers) {
      expect([file, text.includes('createServiceRoleClient()')]).toEqual([file, true]);
      expect([file, /createBrowserSupabaseClient|createServerSupabaseAuthClient/.test(text)]).toEqual([file, false]);
    }
  });

  test('管理画面は表を直接読まず API を通す', () => {
    const page = sources.find((s) => s.file === 'src/app/admin/hpb-menus/page.tsx')!.text;
    expect(page).not.toMatch(/\.from\(\s*['"]hpb_menu_durations['"]/);
    expect(page).toContain('/api/admin/hpb-menus?facility_id=');
  });
});

test('実 DB での検証（ブラウザのロールは書けず、owner / admin だけが自施設を読める）が CI で実行される', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
  const step = '-d carelink_shadow -f supabase/shadow/hpb-menu-durations-privilege-fixtures.sql';
  expect(workflow).toContain(step);
  expect(workflow.indexOf('bash scripts/gen-schema-fingerprint.sh --check')).toBeLessThan(workflow.indexOf(step));
  const fixture = readFileSync(join(ROOT, 'supabase/shadow/hpb-menu-durations-privilege-fixtures.sql'), 'utf8');
  expect(fixture).toMatch(/^BEGIN;$/m);
  expect(fixture.trim().endsWith('ROLLBACK;')).toBe(true);
  for (const label of ['browser roles cannot write; service_role can', 'only the owner/admin read policy remains',
    'direct INSERT accepted', 'direct UPDATE accepted', 'direct DELETE accepted', 'direct writes changed nothing',
    'owner reads only their facility', 'staff reads nothing']) {
    expect(fixture).toContain(label);
  }
});
