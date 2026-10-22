/**
 * @jest-environment node
 *
 * 回数券・月額プランの付与先、施設 Q&A の書き込み経路、監査ログの読み取りを固定する（2026年10月22日）。
 *
 * 【直したもの】
 *   1. 付与 API が任意の user_id を受け付け、一覧 API がその人のメールと表示名を返していた
 *      → 付与先はその店舗の予約者だけ（service_role の RPC が INSERT と同じトランザクションで確認）。
 *   2. ログインした人なら誰でも PostgREST から facility_qa に「施設の回答」を書いて公開できた
 *      → ブラウザのロールから facility_qa へは一切書けない。質問は /api/facility/qa が保存する。
 *   3. 質問が店舗に通知されなかった → /api/facility/qa が保存後に店舗へメールする。
 *   4. 店舗メンバーが audit_logs から来院者の IP・UA を読めた → service_role 専用。
 *
 * migration は 4 本:
 *   20261022150000_customer_grant_scope.sql            … 付与・一覧 RPC、2 表のブラウザ書き込み撤回
 *   20261022150100_facility_qa_question_only.sql       … 質問の INSERT を「回答待ち・回答なし」に限る（旧コードは動く）
 *   20261022150200_audit_logs_service_role_only.sql    … audit_logs の読み取りポリシーと権限を撤回
 *   20261022150300_facility_qa_close_browser_insert.sql … コードのデプロイ後に、ブラウザの INSERT 自体を撤回
 * 実 DB での検証は supabase/shadow/customer-grant-qa-audit-fixtures.sql（CI の schema-fingerprint で実行）。
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { FACILITY_QA_QUESTION_MAX_LENGTH } from '@/lib/facility-qa-limits';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const GRANT = '20261022150000_customer_grant_scope.sql';
const QA_FIRST = '20261022150100_facility_qa_question_only.sql';
const AUDIT = '20261022150200_audit_logs_service_role_only.sql';
const QA_CLOSE = '20261022150300_facility_qa_close_browser_insert.sql';
/** コメントを除いた SQL（説明文の中の語に反応しない）。 */
const code = (text: string) => text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const sql = (file: string) => code(readFileSync(join(MIGRATIONS, file), 'utf8'));
const GUARD_FIRST = /^DO \$guard\$ BEGIN IF to_regclass\('public\.facility_profiles'\) IS NULL THEN RAISE EXCEPTION/;

const BROWSER = '(anon|authenticated|PUBLIC)';
/** 指定の表への書き込み権をブラウザのロールへ（戻して）渡す GRANT。全テーブル一括も含む。 */
const reopenWrite = (table: string) => new RegExp(
  `GRANT [^;]*\\b(INSERT|UPDATE|DELETE|ALL)\\b[^;]*\\bON (TABLE )?((public\\.)?"?${table}"?(?!\\w)|ALL TABLES IN SCHEMA public\\b)[^;]*\\bTO [^;]*\\b${BROWSER}\\b`, 'i');
/** audit_logs をブラウザのロールへ読ませる GRANT。 */
const REOPEN_AUDIT_READ = new RegExp(
  `GRANT [^;]*\\b(SELECT|ALL)\\b[^;]*\\bON (TABLE )?((public\\.)?"?audit_logs"?(?!\\w)|ALL TABLES IN SCHEMA public\\b)[^;]*\\bTO [^;]*\\b${BROWSER}\\b`, 'i');
/** FOR SELECT と明記したもの以外のポリシー（FOR 句なし＝ALL も書き込みを含む）。 */
const writePolicy = (table: string) => new RegExp(`CREATE POLICY [^;]*?\\bON (public\\.)?"?${table}"?(?!\\w)(?![^;]*\\bFOR SELECT\\b)`, 'i');
const anyPolicy = (table: string) => new RegExp(`CREATE POLICY [^;]*?\\bON (public\\.)?"?${table}"?(?!\\w)`, 'i');

describe('migration', () => {
  test('どれも接続先ガードが最初の文で、ブラウザの INSERT 撤回は旧コードを壊さない 1 本目の後に適用される', () => {
    for (const file of [GRANT, QA_FIRST, AUDIT, QA_CLOSE]) expect([file, GUARD_FIRST.test(sql(file))]).toEqual([file, true]);
    expect(QA_CLOSE > QA_FIRST).toBe(true);
    const between = readdirSync(MIGRATIONS).filter((f) => f > QA_FIRST && f < QA_CLOSE);
    expect(between).toEqual([AUDIT]);
    expect(sql(AUDIT)).not.toMatch(/facility_qa/);
  });

  test.each([
    'grant_user_subscription_atomic(uuid, uuid, uuid, uuid, text)',
    'grant_user_package_atomic(uuid, uuid, uuid, uuid, text)',
    'list_facility_customer_profiles(uuid, uuid, uuid[])',
  ])('%s は SECURITY INVOKER・search_path 固定・service_role 専用', (signature) => {
    const body = sql(GRANT);
    const name = signature.slice(0, signature.indexOf('('));
    expect(body).toMatch(new RegExp(`CREATE FUNCTION public\\.${name}\\([^)]*\\) RETURNS [^$]*? SECURITY INVOKER SET search_path = ''`));
    expect(body).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`);
    expect(body).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`);
    expect(body).not.toMatch(new RegExp(`GRANT [^;]*ON FUNCTION public\\.${name}[^;]*TO [^;]*${BROWSER}`));
  });

  test('付与 RPC は今も owner / admin か・その店舗のプラン／回数券か・付与先がその店舗の予約者かを確かめてから書く', () => {
    const body = sql(GRANT);
    expect(body.match(/m\.role IN \('owner', 'admin'\) FOR SHARE; IF NOT FOUND THEN RETURN jsonb_build_object\('ok', false, 'code', 'forbidden'\)/g)).toHaveLength(2);
    expect(body.match(/SELECT 1 FROM public\.bookings b WHERE b\.facility_id = p_facility_id AND b\.user_id = p_user_id \) THEN RETURN jsonb_build_object\('ok', false, 'code', 'not_customer'\)/g)).toHaveLength(2);
    expect(body).toMatch(/WHERE sp\.id = p_plan_id AND sp\.facility_id = p_facility_id/);
    expect(body).toMatch(/WHERE sp\.id = p_package_id AND sp\.facility_id = p_facility_id/);
    // 一覧も予約者だけ・owner / admin にだけ
    expect(body).toMatch(/FROM public\.profiles p WHERE p\.id = ANY \(p_user_ids\) AND EXISTS \( SELECT 1 FROM public\.facility_members m WHERE m\.user_id = p_actor_id AND m\.facility_id = p_facility_id AND m\.role IN \('owner', 'admin'\) \) AND EXISTS \( SELECT 1 FROM public\.bookings b WHERE b\.facility_id = p_facility_id AND b\.user_id = p\.id \)/);
  });

  test('付与の 2 表はブラウザから書けない（権限と書き込みポリシーの両方を外す）', () => {
    const body = sql(GRANT);
    for (const table of ['user_subscriptions', 'user_packages']) {
      expect(body).toContain(`REVOKE ALL ON public.${table} FROM anon, authenticated;`);
      expect(body).toContain(`GRANT SELECT ON public.${table} TO anon, authenticated;`);
      expect(reopenWrite(table).test(body)).toBe(false);
      expect(writePolicy(table).test(body)).toBe(false);
    }
    expect(body).toContain('DROP POLICY IF EXISTS user_subscriptions_admin ON public.user_subscriptions;');
    expect(body).toContain('DROP POLICY IF EXISTS user_packages_facility_insert ON public.user_packages;');
    expect(body).toContain('DROP POLICY IF EXISTS user_packages_facility_update ON public.user_packages;');
  });

  test('Q&A 1 本目: デプロイ済みの QASection が送る 5 列だけ INSERT でき、回答待ち・回答なしに限る', () => {
    const body = sql(QA_FIRST);
    // 旧 QASection.tsx（このコードのデプロイまで本番で動く）が送っていた列そのもの。
    expect(body).toContain('GRANT INSERT (facility_id, user_id, question, status, is_public) ON public.facility_qa TO authenticated;');
    expect(body).toMatch(/CREATE POLICY facility_qa_user_insert ON public\.facility_qa FOR INSERT TO authenticated WITH CHECK \( \(SELECT auth\.uid\(\)\) IS NOT NULL AND user_id = \(SELECT auth\.uid\(\)\) AND status = 'pending' AND answer IS NULL AND answered_by IS NULL AND answered_at IS NULL \);/);
    expect(body).toContain('REVOKE ALL ON public.facility_qa FROM anon, authenticated;');
    expect(body).toContain('DROP POLICY IF EXISTS facility_qa_member_all ON public.facility_qa;');
    expect(body).not.toMatch(/GRANT [^;]*\b(UPDATE|DELETE|ALL)\b[^;]*ON (public\.)?facility_qa/i);
    expect(body.match(/CREATE POLICY/g)).toHaveLength(2);
    expect(body).toMatch(/CREATE POLICY facility_qa_member_read ON public\.facility_qa FOR SELECT TO authenticated/);
  });

  test('Q&A 2 本目: ブラウザの INSERT 権と INSERT ポリシーを外し、新しい権限・ポリシーを作らない', () => {
    const body = sql(QA_CLOSE);
    expect(body).toContain('REVOKE INSERT ON public.facility_qa FROM anon, authenticated;');
    expect(body).toContain('DROP POLICY IF EXISTS facility_qa_user_insert ON public.facility_qa;');
    expect(body).not.toMatch(/CREATE POLICY/i);
    expect(body).not.toMatch(/\bGRANT\b/i);
  });

  test('監査ログ: 読み取りポリシーを 2 本とも外し、ブラウザのロールの権限を全て撤回する', () => {
    const body = sql(AUDIT);
    expect(body).toContain('DROP POLICY IF EXISTS audit_logs_facility_member_read ON public.audit_logs;');
    expect(body).toContain('DROP POLICY IF EXISTS audit_logs_admin_read ON public.audit_logs;');
    expect(body).toContain('REVOKE ALL ON public.audit_logs FROM anon, authenticated;');
    expect(body).not.toMatch(/CREATE POLICY/i);
    expect(body).not.toMatch(/\bGRANT\b/i);
  });

  test('後に適用される migration が書き込み権・書き込みポリシー・監査ログの読み取りを戻していない', () => {
    // 辞書順で後に走るもの＋タイムスタンプ接頭辞の無いもの（combined_phase2_to_6.sql は必ず最後に走る）
    const later = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && (f > QA_CLOSE || !/^\d{14}_/.test(f)));
    expect(later).toContain('combined_phase2_to_6.sql'); // 空振りしていない
    for (const file of later) {
      const text = code(readFileSync(join(MIGRATIONS, file), 'utf8'));
      for (const table of ['facility_qa', 'user_subscriptions', 'user_packages']) {
        expect([file, table, reopenWrite(table).test(text)]).toEqual([file, table, false]);
        expect([file, table, writePolicy(table).test(text)]).toEqual([file, table, false]);
      }
      expect([file, REOPEN_AUDIT_READ.test(text)]).toEqual([file, false]);
      expect([file, anyPolicy('audit_logs').test(text)]).toEqual([file, false]);
    }
  });

  test.each([
    ['GRANT INSERT ON public.facility_qa TO authenticated', 'facility_qa', true],
    ['GRANT UPDATE (answer) ON facility_qa TO authenticated', 'facility_qa', true],
    ['GRANT ALL ON TABLE public."user_packages" TO anon', 'user_packages', true],
    ['GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO authenticated', 'user_subscriptions', true],
    ['GRANT SELECT ON public.facility_qa TO anon, authenticated', 'facility_qa', false],
    ['GRANT INSERT ON public.facility_qa TO service_role', 'facility_qa', false],
    ['GRANT INSERT ON public.facility_qa_archive TO authenticated', 'facility_qa', false],
  ])('書き込み権の検出（負の対照つき）: %s', (statement, table, reopened) => {
    expect(reopenWrite(table).test(`${statement};`)).toBe(reopened);
  });

  test.each([
    ['GRANT SELECT ON public.audit_logs TO authenticated', true],
    ['GRANT SELECT (action) ON audit_logs TO anon', true],
    ['GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated', true],
    ['GRANT SELECT ON public.audit_logs TO service_role', false],
    ['GRANT SELECT ON public.audit_logs_archive TO authenticated', false],
  ])('監査ログの読み取り権の検出（負の対照つき）: %s', (statement, reopened) => {
    expect(REOPEN_AUDIT_READ.test(`${statement};`)).toBe(reopened);
  });

  test.each([
    ['CREATE POLICY p ON public.facility_qa USING (true)', true],
    ['CREATE POLICY p ON facility_qa FOR INSERT TO authenticated WITH CHECK (true)', true],
    ['CREATE POLICY "p" ON "user_packages" AS PERMISSIVE FOR UPDATE USING (true)', true],
    ['CREATE POLICY facility_qa_public_read ON facility_qa FOR SELECT USING (true)', false],
    ['CREATE POLICY p ON public.facility_qa_archive USING (true)', false],
  ])('書き込みポリシーの検出（FOR 句なし＝ALL も拾う・負の対照つき）: %s', (statement, found) => {
    const table = statement.includes('user_packages') ? 'user_packages' : 'facility_qa';
    expect(writePolicy(table).test(`${statement};`)).toBe(found);
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
  const sources = walk(join(ROOT, 'src'));
  const statementsOn = (table: string) => sources.flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return [...text.matchAll(new RegExp(`\\.from\\(\\s*['"]${table}['"]\\s*\\)[^;]*`, 'g'))]
      .map((m) => ({ file: relative(ROOT, file), statement: m[0] }));
  });
  const WRITE = /\.(insert|update|upsert|delete)\s*\(/;

  test('facility_qa へ書くのは質問の API だけ（回答・公開・削除は /api/admin/qa の RPC）', () => {
    expect(sources.length).toBeGreaterThan(500);
    const statements = statementsOn('facility_qa');
    expect(statements.map((s) => s.file).sort()).toEqual([
      'src/app/admin/qa/page.tsx',
      'src/app/api/facility/qa/route.ts',
      'src/components/facility/QASection.tsx',
    ]);
    expect(statements.filter((s) => WRITE.test(s.statement)).map((s) => s.file)).toEqual(['src/app/api/facility/qa/route.ts']);
  });

  test('質問の API は service_role で保存し、回答待ち・回答なしの値をサーバーが決める', () => {
    const route = readFileSync(join(ROOT, 'src/app/api/facility/qa/route.ts'), 'utf8');
    expect(route).toContain("createServiceRoleClient");
    expect(route).toMatch(/user_id: userId,\s*question: d\.question,\s*status: 'pending',/);
    expect(route).not.toMatch(/\banswer:|answered_by:|answered_at:/);
    expect(route).toMatch(/requireAuth: true/);
    expect(route).toMatch(/csrf: true/);
    expect(route).toMatch(/runAfterResponse\(\(\) => notifyFacilityOfNewQuestion/);
  });

  test('付与の 2 表へブラウザ（クライアントコンポーネント）から書かない', () => {
    const clientFiles = new Set(sources.filter((f) => /^\s*['"]use client['"]/.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f)));
    expect(clientFiles.size).toBeGreaterThan(50);
    for (const table of ['user_subscriptions', 'user_packages']) {
      const writes = statementsOn(table).filter((s) => clientFiles.has(s.file) && WRITE.test(s.statement));
      expect([table, writes]).toEqual([table, []]);
    }
  });

  test('付与・一覧の API は profiles を直接読まない（予約者以外のメールを返さない）', () => {
    for (const route of ['src/app/api/admin/user-subscriptions/route.ts', 'src/app/api/admin/user-packages/route.ts']) {
      const text = readFileSync(join(ROOT, route), 'utf8');
      expect([route, /\.from\(\s*['"]profiles['"]\s*\)/.test(text)]).toEqual([route, false]);
      expect(text).toContain('loadFacilityCustomerProfiles');
      expect(text).toContain('grantToFacilityCustomer');
      expect([route, /\.from\(\s*['"]user_(subscriptions|packages)['"]\s*\)\s*\.insert/.test(text)]).toEqual([route, false]);
    }
  });

  test('audit_logs を読むコードは無い（書くのは audit-logger.ts の service_role だけ）', () => {
    const statements = statementsOn('audit_logs');
    expect(statements.map((s) => s.file)).toEqual(['src/lib/audit-logger.ts']);
    expect(statements[0].statement).toMatch(/^\.from\('audit_logs'\)\.insert\(/);
  });

  test('検出が働いている（負の対照）', () => {
    const sample = "supabase.from('facility_qa').insert({ facility_id, question })";
    const found = [...sample.matchAll(/\.from\(\s*['"]facility_qa['"]\s*\)[^;]*/g)].map((m) => m[0]);
    expect(found.filter((s) => WRITE.test(s))).toHaveLength(1);
  });
});

test('質問の上限は画面・API・DB で同じ値', () => {
  const fingerprint = JSON.parse(readFileSync(join(ROOT, 'src/lib/schema-fingerprint.expected.json'), 'utf8')) as string[];
  const check = fingerprint.find((l) => l.startsWith('constraint|facility_qa|c|facility_qa_question_check|'));
  expect(check).toBe(`constraint|facility_qa|c|facility_qa_question_check|CHECK ((length(question) <= ${FACILITY_QA_QUESTION_MAX_LENGTH}))`);
  const section = readFileSync(join(ROOT, 'src/components/facility/QASection.tsx'), 'utf8');
  expect(section).toContain('maxLength={FACILITY_QA_QUESTION_MAX_LENGTH}');
  expect(section).not.toMatch(/maxLength=\{\d+\}/);
});

test('実 DB での検証（付与先・Q&A の書き込み・監査ログの読み取り）が CI で実行される', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
  expect(workflow).toContain('-d carelink_shadow -f supabase/shadow/customer-grant-qa-audit-fixtures.sql');
  const fixture = readFileSync(join(ROOT, 'supabase/shadow/customer-grant-qa-audit-fixtures.sql'), 'utf8');
  expect(fixture).toMatch(/^BEGIN;$/m);
  expect(fixture.trim().endsWith('ROLLBACK;')).toBe(true);
  for (const label of ['stranger plan grant refused', 'stranger package grant refused', 'list returns the customer and not the stranger',
    'direct subscription INSERT accepted', 'forged answered Q&A accepted', 'direct question INSERT accepted', 'direct answer UPDATE accepted',
    'anon does not see a pending question', 'facility member read the audit log', 'no audit log policy remains']) {
    expect(fixture).toContain(label);
  }
});
