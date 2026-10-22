/** @jest-environment node */
/**
 * GBP の Place ID の一意化（20261023150000）と、運営ニュースレターの宛先・配信停止を確認済みの
 * ログインメールにそろえる変更（20261023150100）の形を固定する（2026年10月23日）。
 *
 * 振る舞いは supabase/shadow/gbp-place-id-unique-fixtures.sql と
 * supabase/shadow/newsletter-confirmed-audience-fixtures.sql が使い捨て DB で確かめる（CI の schema-fingerprint job）。
 * ここは次を固定する:
 *   - どちらの migration も接続先ガードが最初の文で、データを消したり書き換えたりしない
 *   - Place ID の重複が既にあれば、索引を作る前に理由つきで止まる（何も変えない）
 *   - 【最後に適用される定義】の宛先・送信直前のフェンス・配信停止が、本人が書き換えられる profiles.email を
 *     宛先や照合に使っていない（後の migration が書き直して条件が落ちると、また他人の配信を止められる）
 *   - アプリは宛先を自前で計算しない（DB の関数だけが定義）
 *   - shadow fixture が CI に配線されている
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const GBP = '20261023150000_gbp_place_id_unique.sql';
const AUDIENCE = '20261023150100_newsletter_confirmed_login_email.sql';
const GUARD = "DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;";
const code = (sql: string) => sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
const read = (file: string) => readFileSync(join(MIGRATIONS, file), 'utf8');

/** 辞書順（＝適用順）で最後に現れる CREATE [OR REPLACE] FUNCTION public.<name>( の定義。 */
function latestDefinition(name: string): { file: string; body: string } {
  let latest: { file: string; body: string } | null = null;
  const head = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`, 'g');
  for (const file of files) {
    const sql = read(file);
    for (const match of sql.matchAll(head)) {
      const open = sql.indexOf('$$', match.index);
      const close = sql.indexOf('$$', open + 2);
      latest = { file, body: sql.slice(match.index, close + 2) };
    }
  }
  if (!latest) throw new Error(`no definition for ${name}`);
  return latest;
}

describe('20261023150000: one Google Place ID per facility', () => {
  const sql = code(read(GBP));
  test('the connection guard is the first statement', () => {
    expect(sql.trim().startsWith(GUARD)).toBe(true);
  });
  test('existing duplicates stop the migration before the index, and nothing is deleted or rewritten', () => {
    const check = sql.indexOf('GBP_PLACE_ID_DUPLICATED');
    const index = sql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uq_facility_profiles_gbp_place_id');
    expect(check).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(check);
    expect(sql).toMatch(/GROUP BY gbp_place_id HAVING count\(\*\)>1/);
    expect(sql).not.toMatch(/\b(DELETE|UPDATE|TRUNCATE|DROP)\b/i);
  });
  test('the index covers every real Place ID and leaves blank (unset) values out', () => {
    expect(sql).toContain("ON public.facility_profiles (gbp_place_id) WHERE btrim(gbp_place_id)<>'';");
    // 重複の数え方と索引の対象をそろえる（数え方だけ緩いと、検査を通って索引の作成で落ちる）
    expect(sql).toContain("WHERE btrim(gbp_place_id)<>'' GROUP BY gbp_place_id");
  });
  test('the deploy order is stated', () => {
    expect(read(GBP)).toContain('【デプロイ順】');
  });
});

describe('20261023150100: newsletter audience and unsubscribe follow the confirmed login email', () => {
  const sql = code(read(AUDIENCE));
  test('the connection guard is the first statement and only functions are replaced', () => {
    expect(sql.trim().startsWith(GUARD)).toBe(true);
    expect(sql.match(/^CREATE FUNCTION/gm)).toBeNull();
    // 関数本体（$$ … $$）の外＝migration として実行される文に、表の変更・データの書き換えが無い
    const topLevel = sql.replace(/\$\$[\s\S]*?\$\$/g, '$$ $$');
    expect(topLevel.match(/^CREATE OR REPLACE FUNCTION/gm)).toHaveLength(3);
    expect(topLevel).not.toMatch(/DROP\s+(TABLE|COLUMN|FUNCTION)|ALTER\s+TABLE|^\s*(DELETE|UPDATE|INSERT)\s/im);
  });

  test('audience: owners by confirmed login email, opt-outs only through email_address_opted_out', () => {
    const { file, body } = latestDefinition('newsletter_current_recipients');
    expect(file).toBe(AUDIENCE);
    expect(body).toMatch(/LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''/);
    expect(body).toContain('JOIN auth.users u ON u.id=m.user_id');
    expect(body).toContain('u.email_confirmed_at IS NOT NULL');
    expect(body).toContain('AND NOT public.email_address_opted_out(c.email)');
    // 本人が書き換えられる profiles.email を宛先にも抑止の照合にも使わない
    expect(body).not.toMatch(/public\.profiles/);
  });

  test('fence: also locks the accounts owning the address by login email', () => {
    const { file, body } = latestDefinition('start_newsletter_delivery');
    expect(file).toBe(AUDIENCE);
    expect(body).toMatch(/SECURITY DEFINER SET search_path=''/);
    expect(body).toContain('OR p.id IN (SELECT u.id FROM auth.users u WHERE lower(btrim(u.email))=r.email) ORDER BY p.id LOOP');
    expect(body).toContain('FOR SHARE OF p;');
    expect(body).toContain('OR m.user_id IN (SELECT u.id FROM auth.users u WHERE lower(btrim(u.email))=r.email) ORDER BY m.id FOR SHARE OF m;');
    // 判定は宛先の関数そのもの（同じ定義）
    expect(body).toContain("public.newsletter_current_recipients(op.campaign_snapshot->>'campaign_type')");
  });

  test('unsubscribe: a token stops its own confirmed login email, never profiles.email', () => {
    const { file, body } = latestDefinition('unsubscribe_newsletter_atomic');
    expect(file).toBe(AUDIENCE);
    expect(body).toMatch(/SECURITY DEFINER SET search_path=''/);
    expect(body).toContain('SELECT lower(btrim(u.email)) INTO address FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.id=uid AND u.email_confirmed_at IS NOT NULL;');
    expect(body).not.toContain('coalesce(p.email,u.email)');
    expect(body).toContain('UPDATE public.profiles p SET email_unsubscribed=true WHERE lower(btrim(p.email))=address OR p.id=uid');
  });

  test('REVOKE / GRANT are restated for every replaced function', () => {
    for (const signature of ['newsletter_current_recipients(text)', 'start_newsletter_delivery(uuid,timestamptz)', 'unsubscribe_newsletter_atomic(text,text)']) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC,anon,authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`);
      expect(sql).not.toMatch(new RegExp(`GRANT [^;]*${signature.split('(')[0]}[^;]*TO [^;]*\\b(anon|authenticated|PUBLIC)\\b`, 'i'));
    }
  });

  test('the deploy order is stated', () => {
    expect(read(AUDIENCE)).toContain('【デプロイ順】');
  });
});

describe('the app does not compute the newsletter audience itself', () => {
  test('collectNewsletterRecipients reads only the database function', () => {
    const source = readFileSync(join(ROOT, 'src/lib/newsletter-send.ts'), 'utf8');
    expect(source).toContain("client.rpc('newsletter_current_recipients', { p_kind: kind })");
    expect(source).not.toMatch(/\.from\(\s*['"`](profiles|newsletter_subscriptions|facility_members)['"`]/);
  });
});

describe('shadow fixtures are wired into CI', () => {
  test.each([
    ['supabase/shadow/gbp-place-id-unique-fixtures.sql', 'save_admin_facility_integration_atomic'],
    ['supabase/shadow/newsletter-confirmed-audience-fixtures.sql', 'start_newsletter_delivery'],
  ])('%s', (fixture, exercised) => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
    expect(workflow).toContain(`-f ${fixture}`);
    const sql = readFileSync(join(ROOT, fixture), 'utf8');
    expect(sql).toContain(exercised);
    expect(sql).toContain("current_database() NOT LIKE 'carelink_shadow%'");
    expect(sql.trim().endsWith('ROLLBACK;')).toBe(true);
  });
});
