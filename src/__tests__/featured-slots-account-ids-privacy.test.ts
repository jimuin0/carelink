/**
 * @jest-environment node
 *
 * 有料の広告枠（featured_slots）の書き込み経路と、Q&A・「役に立った」のアカウント ID の非公開を固定する
 * （2026年10月23日 新設）。
 *
 * 【直したもの】
 *   1. featured_slots_owner が FOR ALL（WITH CHECK なし）で authenticated に INSERT / UPDATE 権があり、
 *      公開済み店舗のオーナーなら誰でも PostgREST から自店の「スポンサー」枠を作って
 *      （is_active の既定値 true・期限 2099 年・全エリア全業種）/search の最上部に無料で出せた。
 *      未払いの枠（/api/admin/featured-ads が is_active=false で作る）の有効化や期限延長もできた。
 *      → ブラウザのロールは読むだけ。書くのは service_role（API と Stripe webhook）だけ。既定値は false。
 *   2. 公開 Q&A の質問者（user_id）・回答した店舗スタッフ（answered_by）と、「役に立った」を押した人の
 *      アカウント ID がログインなしで読めた。ID はプロフィール写真の公開パス（avatars/<ID>/…）でもある。
 *      → facility_qa は画面が使う列だけを列単位で GRANT。review_helpful は本人の行だけ。
 *        件数は get_review_helpful_counts（口コミ ID と件数だけ）で読む。
 *
 * migration は 3 本:
 *   20261023110000_featured_slots_owner_read_only.sql  … 広告枠（デプロイの前後どちらでもよい）
 *   20261023110100_review_helpful_counts_rpc.sql       … 件数の関数を足すだけ（前後どちらでもよい）
 *   20261023110200_account_ids_hidden_from_browser.sql … 列単位の権限・本人の行だけ（デプロイ後）
 * 実 DB での検証は supabase/shadow/featured-slots-account-ids-fixtures.sql（CI の schema-fingerprint で実行）。
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const FEATURED = '20261023110000_featured_slots_owner_read_only.sql';
const COUNTS = '20261023110100_review_helpful_counts_rpc.sql';
const HIDE_IDS = '20261023110200_account_ids_hidden_from_browser.sql';
/** コメントを除いた SQL（説明文の中の語に反応しない）。 */
const code = (text: string) => text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const sql = (file: string) => code(readFileSync(join(MIGRATIONS, file), 'utf8'));
const GUARD_FIRST = /^DO \$guard\$ BEGIN IF to_regclass\('public\.facility_profiles'\) IS NULL THEN RAISE EXCEPTION/;
const BROWSER = '(anon|authenticated|PUBLIC)';
const onTable = (table: string) => `\\bON (TABLE )?((public\\.)?"?${table}"?(?!\\w)|ALL TABLES IN SCHEMA public\\b)`;

/** 指定の表への書き込み権をブラウザのロールへ（戻して）渡す GRANT。全テーブル一括も含む。 */
const reopenWrite = (table: string) => new RegExp(
  `GRANT [^;]*\\b(INSERT|UPDATE|DELETE|TRUNCATE|ALL)\\b[^;]*${onTable(table)}[^;]*\\bTO [^;]*\\b${BROWSER}\\b`, 'i');
/** FOR SELECT と明記したもの以外のポリシー（FOR 句なし＝ALL も書き込みを含む）。 */
const writePolicy = (table: string) => new RegExp(`CREATE POLICY [^;]*?\\bON (public\\.)?"?${table}"?(?!\\w)(?![^;]*\\bFOR SELECT\\b)`, 'i');
const anyPolicy = (table: string) => new RegExp(`CREATE POLICY [^;]*?\\bON (public\\.)?"?${table}"?(?!\\w)`, 'i');
/** review_helpful を anon / PUBLIC に（何であれ）渡す GRANT。 */
const REOPEN_HELPFUL_ANON = new RegExp(`GRANT [^;]*${onTable('review_helpful')}[^;]*\\bTO [^;]*\\b(anon|PUBLIC)\\b`, 'i');

/** facility_qa のアカウント ID（user_id / answered_by）をブラウザのロールに読ませる GRANT 文を返す。 */
function qaAccountIdReadGrants(text: string): string[] {
  return (text.match(/GRANT [^;]*;/gi) ?? []).filter((statement) => {
    if (!new RegExp(onTable('facility_qa'), 'i').test(statement)) return false;
    if (!new RegExp(`\\bTO [^;]*\\b${BROWSER}\\b`, 'i').test(statement)) return false;
    const privileges = statement.slice('GRANT '.length, statement.search(/\bON\b/i));
    if (/\bALL\b/i.test(privileges)) return true;
    const select = privileges.match(/\bSELECT\b\s*(\(([^)]*)\))?/i);
    if (!select) return false;
    if (!select[1]) return true; // 列を指定しない SELECT＝全列（今後足される列も含む）
    return /\b(user_id|answered_by)\b/i.test(select[2]);
  });
}

/** 辞書順で後に走るもの＋タイムスタンプ接頭辞の無いもの（combined_phase2_to_6.sql は必ず最後に走る）。 */
function laterThan(file: string): string[] {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && (f > file || !/^\d{14}_/.test(f)));
}

/** 20261023110200 が anon / authenticated に読ませる facility_qa の列。 */
function grantedQaColumns(): string[] {
  const grant = sql(HIDE_IDS).match(/GRANT SELECT \(([^)]*)\) ON public\.facility_qa TO anon, authenticated;/);
  expect(grant).not.toBeNull();
  return grant![1].split(',').map((c) => c.trim());
}

describe('migration: 広告枠', () => {
  const body = sql(FEATURED);

  test('接続先ガードが最初の文', () => {
    expect(body).toMatch(GUARD_FIRST);
  });

  test('FOR ALL の 2 本を消し、読み取り専用（FOR SELECT TO authenticated）だけを作る', () => {
    expect(body).toContain('DROP POLICY IF EXISTS featured_slots_owner ON public.featured_slots;');
    expect(body).toContain('DROP POLICY IF EXISTS featured_slots_platform_admin ON public.featured_slots;');
    const policies = body.match(/CREATE POLICY [^;]*;/g) ?? [];
    expect(policies).toHaveLength(2);
    expect(policies[0]).toMatch(/^CREATE POLICY featured_slots_owner_read ON public\.featured_slots FOR SELECT TO authenticated USING /);
    expect(policies[0]).toContain("fm.role IN ('owner', 'admin')");
    expect(policies[0]).toContain('fm.user_id = (SELECT auth.uid())');
    expect(policies[0]).toContain('fm.facility_id = featured_slots.facility_id');
    expect(policies[1]).toMatch(/^CREATE POLICY featured_slots_platform_admin_read ON public\.featured_slots FOR SELECT TO authenticated USING /);
    expect(policies[1]).toContain('p.is_platform_admin = true');
    for (const p of policies) expect([p, writePolicy('featured_slots').test(p)]).toEqual([p, false]);
    // 公開読み（検索のスポンサー表示）は消さない
    expect(body).not.toMatch(/DROP POLICY [^;]*featured_slots_public_read/);
  });

  test('ブラウザのロールの権限を全て撤回して SELECT だけを戻し、service_role は全権のまま', () => {
    expect(body).toContain('REVOKE ALL ON public.featured_slots FROM anon, authenticated;');
    expect(body.match(/\bGRANT [^;]*;/g)).toEqual([
      'GRANT SELECT ON public.featured_slots TO anon, authenticated;',
      'GRANT ALL ON public.featured_slots TO service_role;',
    ]);
    expect(body.indexOf('REVOKE ALL')).toBeLessThan(body.indexOf('GRANT SELECT'));
  });

  test('is_active の既定値を false にする（書き忘れた行が表示されない側へ倒す）', () => {
    expect(body).toContain('ALTER TABLE public.featured_slots ALTER COLUMN is_active SET DEFAULT false;');
  });

  test('後に適用される migration が書き込み権・書き込みポリシーを戻していない', () => {
    const later = laterThan(FEATURED);
    expect(later).toContain('combined_phase2_to_6.sql'); // 空振りしていない
    for (const file of later) {
      const text = code(readFileSync(join(MIGRATIONS, file), 'utf8'));
      expect([file, reopenWrite('featured_slots').test(text)]).toEqual([file, false]);
      expect([file, writePolicy('featured_slots').test(text)]).toEqual([file, false]);
      expect([file, /ALTER COLUMN is_active SET DEFAULT true/i.test(text) && /featured_slots/.test(text)]).toEqual([file, false]);
    }
  });

  test.each([
    ['GRANT INSERT ON public.featured_slots TO authenticated', true],
    ['GRANT UPDATE (is_active) ON featured_slots TO authenticated', true],
    ['GRANT ALL ON TABLE public."featured_slots" TO anon', true],
    ['GRANT TRUNCATE ON public.featured_slots TO PUBLIC', true],
    ['GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO authenticated', true],
    ['GRANT SELECT ON public.featured_slots TO anon, authenticated', false],
    ['GRANT ALL ON public.featured_slots TO service_role', false],
    ['GRANT INSERT ON public.featured_slots_archive TO authenticated', false],
  ])('書き込み権の検出（負の対照つき）: %s', (statement, reopened) => {
    expect(reopenWrite('featured_slots').test(`${statement};`)).toBe(reopened);
  });

  test.each([
    ['CREATE POLICY "featured_slots_owner" ON featured_slots FOR ALL USING (true)', true],
    ['CREATE POLICY p ON public.featured_slots USING (true)', true],
    ['CREATE POLICY p ON public.featured_slots FOR UPDATE TO authenticated USING (true)', true],
    ['CREATE POLICY featured_slots_owner_read ON public.featured_slots FOR SELECT TO authenticated USING (true)', false],
  ])('書き込みポリシーの検出（FOR 句なし＝ALL も拾う・負の対照つき）: %s', (statement, found) => {
    expect(writePolicy('featured_slots').test(`${statement};`)).toBe(found);
  });
});

describe('migration: 「役に立った」の件数の関数', () => {
  const body = sql(COUNTS);

  test('接続先ガードが最初の文で、ID を隠す migration より先に適用される', () => {
    expect(body).toMatch(GUARD_FIRST);
    expect(COUNTS < HIDE_IDS).toBe(true);
    expect(FEATURED < COUNTS).toBe(true);
  });

  test('SECURITY DEFINER・search_path 固定で、口コミ ID と件数だけを返す', () => {
    expect(body).toContain(
      'CREATE OR REPLACE FUNCTION public.get_review_helpful_counts(p_review_ids uuid[]) RETURNS TABLE(review_id uuid, helpful_count integer) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = \'\' AS $$',
    );
    const fn = body.slice(body.indexOf('AS $$'), body.indexOf('$$;'));
    expect(fn).toMatch(/^AS \$\$ SELECT h\.review_id, count\(\*\)::integer FROM public\.review_helpful h /);
    expect(fn).not.toMatch(/\buser_id\b/);
    expect(fn).toContain('GROUP BY h.review_id');
  });

  test('数えるのは公開中の口コミだけ（public_reviews と同じ条件）', () => {
    expect(body).toContain("r.status = 'published'");
    expect(body).toContain('r.is_flagged = false');
    expect(body).toContain("f.status = 'published'");
    const view = code(readFileSync(join(MIGRATIONS, '20261022130000_public_reviews_is_member.sql'), 'utf8'));
    expect(view).toContain("WHERE r.status='published' AND r.is_flagged=false AND f.status='published'");
  });

  test('ページ（anon / authenticated）から呼べる', () => {
    expect(body).toContain('REVOKE ALL ON FUNCTION public.get_review_helpful_counts(uuid[]) FROM PUBLIC, anon, authenticated;');
    expect(body).toContain('GRANT EXECUTE ON FUNCTION public.get_review_helpful_counts(uuid[]) TO anon, authenticated, service_role;');
  });
});

describe('migration: アカウント ID をブラウザのロールから隠す', () => {
  const body = sql(HIDE_IDS);

  test('接続先ガードが最初の文', () => {
    expect(body).toMatch(GUARD_FIRST);
  });

  test('facility_qa: 表単位の SELECT を外し、画面が使う列だけを付け直す（user_id / answered_by は含めない）', () => {
    expect(body).toContain('REVOKE SELECT ON public.facility_qa FROM anon, authenticated;');
    expect(grantedQaColumns().sort()).toEqual(
      ['answer', 'answered_at', 'created_at', 'facility_id', 'id', 'is_public', 'question', 'status'],
    );
    expect(body.indexOf('REVOKE SELECT ON public.facility_qa')).toBeLessThan(body.indexOf('GRANT SELECT ('));
    expect(qaAccountIdReadGrants(body)).toEqual([]);
    // 書き込み権は 20261022230100 / 20261022230300 で撤回済み。ここで戻さない。
    expect(reopenWrite('facility_qa').test(body)).toBe(false);
  });

  test('review_helpful: 公開読みポリシーを消し、anon は無し・authenticated は本人の行の読み取り・追加・取り消しだけ', () => {
    expect(body).toContain('DROP POLICY IF EXISTS review_helpful_public_count ON public.review_helpful;');
    expect(body).toContain('REVOKE ALL ON public.review_helpful FROM anon, authenticated;');
    expect(body).not.toMatch(anyPolicy('review_helpful'));
    const grants = (body.match(/\bGRANT [^;]*;/g) ?? []).filter((g) => g.includes('review_helpful'));
    expect(grants).toEqual([
      'GRANT SELECT, DELETE ON public.review_helpful TO authenticated;',
      'GRANT INSERT (review_id, user_id) ON public.review_helpful TO authenticated;',
    ]);
    // 残るポリシーは本人の行だけを扱う review_helpful_user_manage（作成時から条件は変わっていない）
    const created = code(readFileSync(join(MIGRATIONS, '20260417000024_phase7_hpb_extensions.sql'), 'utf8'));
    expect(created).toContain('CREATE POLICY "review_helpful_user_manage" ON review_helpful FOR ALL USING (user_id = auth.uid());');
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) {
      const text = code(readFileSync(join(MIGRATIONS, file), 'utf8'));
      expect([file, /DROP POLICY [^;]*review_helpful_user_manage/i.test(text)]).toEqual([file, false]);
    }
  });

  test('後に適用される migration がアカウント ID の読み取り・公開読みを戻していない', () => {
    const later = laterThan(HIDE_IDS);
    expect(later).toContain('combined_phase2_to_6.sql'); // 空振りしていない
    for (const file of later) {
      const text = code(readFileSync(join(MIGRATIONS, file), 'utf8'));
      expect([file, qaAccountIdReadGrants(text)]).toEqual([file, []]);
      expect([file, REOPEN_HELPFUL_ANON.test(text)]).toEqual([file, false]);
      expect([file, anyPolicy('review_helpful').test(text)]).toEqual([file, false]);
    }
  });

  test.each([
    ['GRANT SELECT ON public.facility_qa TO anon, authenticated', 1],
    ['GRANT SELECT (id, user_id) ON facility_qa TO authenticated', 1],
    ['GRANT SELECT (answered_by) ON public."facility_qa" TO anon', 1],
    ['GRANT ALL ON public.facility_qa TO authenticated', 1],
    ['GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon', 1],
    ['GRANT SELECT (id, question, answer) ON public.facility_qa TO anon, authenticated', 0],
    ['GRANT SELECT ON public.facility_qa TO service_role', 0],
    ['GRANT SELECT ON public.facility_qa_archive TO anon', 0],
    ['GRANT INSERT (facility_id, user_id) ON public.facility_qa TO authenticated', 0],
  ])('アカウント ID を読ませる GRANT の検出（負の対照つき）: %s', (statement, found) => {
    expect(qaAccountIdReadGrants(`${statement};`)).toHaveLength(found);
  });

  test.each([
    ['GRANT SELECT ON public.review_helpful TO anon', true],
    ['GRANT ALL ON TABLE review_helpful TO PUBLIC', true],
    ['GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon', true],
    ['GRANT SELECT, DELETE ON public.review_helpful TO authenticated', false],
    ['GRANT SELECT ON public.review_helpful_archive TO anon', false],
  ])('review_helpful を anon に渡す GRANT の検出（負の対照つき）: %s', (statement, found) => {
    expect(REOPEN_HELPFUL_ANON.test(`${statement};`)).toBe(found);
  });
});

describe('アプリのコード', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : walk(full);
      return /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  }
  const sources = walk(join(ROOT, 'src')).map((file) => ({ file: relative(ROOT, file), text: readFileSync(file, 'utf8') }));
  const statementsOn = (table: string) => sources.flatMap(({ file, text }) =>
    [...text.matchAll(new RegExp(`\\.from\\(\\s*['"]${table}['"]\\s*\\)[^;]*`, 'g'))].map((m) => ({ file, text, statement: m[0] })));
  const WRITE = /\.(insert|update|upsert|delete)\s*\(/;
  const usesServiceRole = (text: string) => text.includes('createServiceRoleClient()');
  const isClientComponent = (text: string) => /^\s*['"]use client['"]/.test(text);

  test('featured_slots へ書くのは service_role の API と Stripe webhook だけ', () => {
    expect(sources.length).toBeGreaterThan(500); // 空振りしていない
    const writes = statementsOn('featured_slots').filter((s) => WRITE.test(s.statement));
    expect([...new Set(writes.map((s) => s.file))].sort()).toEqual([
      'src/app/api/admin/featured-ads/route.ts',
      'src/app/api/stripe/webhook/route.ts',
    ]);
    for (const { file, text } of writes) {
      expect([file, usesServiceRole(text)]).toEqual([file, true]);
      expect([file, isClientComponent(text)]).toEqual([file, false]);
    }
    // 正規の作成は未払い（is_active=false）。有効化は決済後の webhook だけ
    const route = sources.find((s) => s.file === 'src/app/api/admin/featured-ads/route.ts')!.text;
    expect(route).toMatch(/is_active: false, \/\/ becomes active after payment/);
  });

  test('featured_slots をブラウザ（クライアントコンポーネント）から触らない。検索の表示は読み取りだけ', () => {
    const statements = statementsOn('featured_slots');
    for (const { file, text } of statements) {
      expect([file, isClientComponent(text)]).toEqual([file, false]);
    }
    const reads = statements.filter((s) => s.file === 'src/lib/facilities.ts');
    expect(reads).toHaveLength(1);
    expect(WRITE.test(reads[0].statement)).toBe(false);
    expect(reads[0].statement).toContain(".eq('is_active', true)");
  });

  test('facility_qa をブラウザのロールで読むコードは、権限のある列だけを指定する（select(\'*\') を使わない）', () => {
    const granted = new Set(grantedQaColumns());
    const browserReads = statementsOn('facility_qa').filter((s) => !usesServiceRole(s.text));
    expect(browserReads.map((s) => s.file).sort()).toEqual([
      'src/app/admin/qa/page.tsx',
      'src/components/facility/QASection.tsx',
    ]);
    for (const { file, text, statement } of browserReads) {
      const arg = statement.match(/\.select\(\s*(?:'([^']*)'|([A-Z_]+))\s*\)/);
      expect([file, arg !== null]).toEqual([file, true]);
      const literal = arg![1] ?? text.match(new RegExp(`const ${arg![2]} = '([^']*)';`))?.[1];
      expect([file, typeof literal]).toEqual([file, 'string']);
      const selected = literal!.split(',').map((c) => c.trim());
      const filtered = [...statement.matchAll(/\.(?:eq|neq|in|order|is)\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
      const used = [...selected, ...filtered];
      expect([file, used.filter((c) => !granted.has(c))]).toEqual([file, []]);
      expect([file, selected.includes('*')]).toEqual([file, false]);
    }
  });

  test('「役に立った」はブラウザから本人の行だけを読み、件数は関数から受け取る', () => {
    const statements = statementsOn('review_helpful');
    expect([...new Set(statements.map((s) => s.file))]).toEqual(['src/components/facility/ReviewList.tsx']);
    for (const { statement } of statements) {
      // 読み取り・取り消しは必ず本人の user_id で絞る（他人の押下は RLS でも見えない）
      if (/\.(select|delete)\s*\(/.test(statement)) expect(statement).toMatch(/\.eq\(\s*'user_id',\s*user\.id\s*\)/);
    }
    const list = statements[0].text;
    expect(list).toContain(".rpc('get_review_helpful_counts', { p_review_ids: reviewIds })");
    expect(isClientComponent(list)).toBe(true);
  });

  test('検出が働いている（負の対照）', () => {
    const sample = "supabase.from('review_helpful').select('review_id').in('review_id', ids);";
    const found = [...sample.matchAll(/\.from\(\s*['"]review_helpful['"]\s*\)[^;]*/g)].map((m) => m[0]);
    expect(found).toHaveLength(1);
    expect(found[0]).not.toMatch(/\.eq\(\s*'user_id',\s*user\.id\s*\)/);
    const qa = "supabase.from('facility_qa').select('*').eq('facility_id', id);";
    expect(qa.match(/\.select\(\s*(?:'([^']*)'|([A-Z_]+))\s*\)/)?.[1]).toBe('*');
  });
});

test('実 DB での検証（広告枠はブラウザから書けない・アカウント ID は読めない）が CI で実行される', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
  const step = '-d carelink_shadow -f supabase/shadow/featured-slots-account-ids-fixtures.sql';
  expect(workflow).toContain(step);
  expect(workflow.indexOf('bash scripts/gen-schema-fingerprint.sh --check')).toBeLessThan(workflow.indexOf(step));
  const fixture = readFileSync(join(ROOT, 'supabase/shadow/featured-slots-account-ids-fixtures.sql'), 'utf8');
  expect(fixture).toMatch(/^BEGIN;$/m);
  expect(fixture.trim().endsWith('ROLLBACK;')).toBe(true);
  for (const label of [
    'featured slots: browser roles read only, service_role writes',
    'a slot is inactive unless is_active is set',
    'direct sponsor INSERT accepted', 'direct sponsor activation accepted', 'direct sponsor extension accepted',
    'direct sponsor DELETE accepted', 'direct sponsor writes changed nothing',
    'anon reads only the active slot for the sponsor block', 'owner of B cannot read the unpaid slot of A',
    'Q&A: browser roles read the shown columns only, never account IDs',
    'anon read the asker account ID', 'anon read every Q&A column with select *',
    'owner reads both questions with the admin page columns', 'owner read the asker account ID',
    'helpful votes: anon has nothing, signed-in users manage only their own',
    'anon gets counts only, for public reviews only', 'anon read helpful voter account IDs',
    'a voter cannot see other voters', 'vote recorded under another account', 'a signed-in stranger reads no vote rows',
  ]) {
    expect(fixture).toContain(label);
  }
});
