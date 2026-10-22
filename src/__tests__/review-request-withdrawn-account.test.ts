/** @jest-environment node */
/**
 * 退会した会員・配信停止したアドレスへ口コミ依頼を送らない（2026年10月23日）。
 *
 * 回帰の中身: 退会すると bookings.user_id は ON DELETE SET NULL で NULL になり、profiles 行
 * （email_unsubscribed を含む）は CASCADE で消える。口コミ依頼の 3 つの判定（候補一覧・予約確保・
 * 送信直前のフェンス）はどれも「user_id が NULL＝ゲスト＝配信停止の確認なし」と扱うため、
 * 来店完了から 7 日以内に退会した会員（退会前に配信停止していた人を含む）へ口コミ依頼が届いていた。
 *
 * 振る舞いそのものは supabase/shadow/review-request-withdrawn-account-fixtures.sql が使い捨て DB で
 * 確かめる（CI の schema-fingerprint job）。ここは次を固定する:
 *   - 【最後に適用される定義】が 3 か所すべてで退会の印と宛先の配信停止を見ていること
 *     （後の migration が関数を書き直してどれか 1 か所から条件が落ちると、積まれたジョブや競合中のジョブが漏れる）
 *   - 退会の印は店舗が読める bookings の列ではなく、ブラウザのロールから読めない別表にあること
 *   - 宛先の配信停止は、本人が自由に書き換えられる profiles.email では照合しないこと
 *     （照合すると、誰でも他人のアドレスで予約したゲストへの口コミ依頼を止められる）
 *   - 配信停止リンクの停止行は種別を問わないこと（リンクは既存の購読行を種別のまま止める）
 *   - 期待スキーマ（schema-fingerprint.expected.json）が migration と一致していること
 *     （食い違うと CI の --check が落ち、後段の shadow fixture が一度も走らない）
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const MIGRATION = '20261023050000_review_request_withdrawn_accounts.sql';
const FIXTURE = 'supabase/shadow/review-request-withdrawn-account-fixtures.sql';
const MARKS = 'booking_member_withdrawals';
const NOT_WITHDRAWN = `NOT EXISTS(SELECT 1 FROM public.${MARKS} w WHERE w.booking_id=b.id)`;

/** 辞書順（＝適用順）で最後に現れる CREATE [OR REPLACE] FUNCTION public.<name>( の定義と $$ 本体を返す。 */
function latestDefinition(name: string): { file: string; body: string; prosrc: string } {
  let latest: { file: string; body: string; prosrc: string } | null = null;
  const head = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`, 'g');
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    for (const match of sql.matchAll(head)) {
      const open = sql.indexOf('$$', match.index);
      const close = sql.indexOf('$$', open + 2);
      latest = { file, body: sql.slice(match.index, close + 2), prosrc: sql.slice(open + 2, close) };
    }
  }
  if (!latest) throw new Error(`no definition for ${name}`);
  return latest;
}

describe('最後に適用される定義が退会者と配信停止アドレスを除外する', () => {
  test('退会と同じトランザクションで、その会員の予約を別表に記録する（bookings は書き換えない）', () => {
    const { file, body } = latestDefinition('cleanup_deleting_account_personal_data');
    expect(file).toBe(MIGRATION);
    expect(body).toContain('SECURITY DEFINER SET search_path');
    expect(body).toMatch(/INSERT INTO public\.booking_member_withdrawals\(booking_id\)\s+SELECT b\.id FROM public\.bookings b WHERE b\.user_id=OLD\.id ON CONFLICT \(booking_id\) DO NOTHING;/);
    expect(body).not.toMatch(/UPDATE public\.bookings/);
    // 既存の後始末（LINE 連携・ポイント等）は 1 つも落としていない
    for (const statement of ['DELETE FROM public.line_user_links l WHERE l.user_id=OLD.id', 'DELETE FROM public.user_points WHERE user_id=OLD.id',
      'UPDATE public.api_keys SET created_by=NULL WHERE created_by=OLD.id', 'PERFORM 1 FROM public.profiles p WHERE p.id=OLD.id FOR UPDATE']) {
      expect(body).toContain(statement);
    }
  });

  test.each([
    ['list_scheduled_review_recipients', `${NOT_WITHDRAWN} AND NOT public.email_address_opted_out(b.email)`],
    ['reserve_scheduled_email_atomic', `IF EXISTS(SELECT 1 FROM public.${MARKS} w WHERE w.booking_id=b.id) OR public.email_address_opted_out(b.email) THEN`],
    ['start_scheduled_email_delivery', `AND ${NOT_WITHDRAWN} AND NOT public.email_address_opted_out(b.email);`],
  ])('%s', (name, condition) => {
    const { file, body } = latestDefinition(name);
    expect(file >= MIGRATION).toBe(true);
    expect(body).toContain(condition);
    expect(body).toContain('SECURITY INVOKER SET search_path=\'\'');
    expect(body).not.toContain('account_deleted_at');
  });

  test('宛先の配信停止: 配信停止リンクの停止行は種別を問わず、プロフィールは確認済みログインメールの持ち主だけ', () => {
    const { body } = latestDefinition('email_address_opted_out');
    expect(body).toMatch(/LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''/);
    expect(body).toContain('EXISTS(SELECT 1 FROM public.newsletter_subscriptions n WHERE lower(btrim(n.email))=lower(btrim(p_email)) AND n.is_active IS FALSE)');
    // リンクは既存の owner_monthly / user_digest 行を種別のまま止める＝'all' に限ると見落とす
    expect(body).not.toContain('subscription_type');
    expect(body).toContain('FROM public.profiles p JOIN auth.users u ON u.id=p.id');
    expect(body).toContain('p.email_unsubscribed IS TRUE AND u.email_confirmed_at IS NOT NULL AND lower(btrim(u.email))=lower(btrim(p_email))');
    // profiles.email は本人が自由に書き換えられるので照合に使わない
    expect(body).not.toMatch(/p\.email\b(?!_)/);
  });
});

describe('migration の形', () => {
  let sql = '';
  let code = '';
  beforeAll(() => {
    sql = readFileSync(join(MIGRATIONS, MIGRATION), 'utf8');
    code = sql.split('\n').filter((line) => !line.startsWith('--')).join('\n');
  });

  test('CareLink の DB でなければ何もしない', () => {
    expect(code.trim().startsWith("DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;")).toBe(true);
  });

  test('追加と置き換えだけ（アプリより先に適用しても旧アプリが動く）', () => {
    expect(code).toContain(`CREATE TABLE IF NOT EXISTS public.${MARKS} (`);
    expect(code).not.toMatch(/DROP\s+(TABLE|COLUMN|FUNCTION)|ALTER\s+COLUMN|RENAME/i);
    expect(code.match(/^CREATE FUNCTION/gm)).toBeNull();
    // 店舗が全列を読める bookings には何も足さない（退会の事実・時刻を店舗へ開示しない）
    expect(code).not.toMatch(/ALTER TABLE public\.bookings/);
  });

  test('退会の印はブラウザのロールから読めず、service_role は読むだけ', () => {
    expect(code).toContain(`booking_id uuid PRIMARY KEY REFERENCES public.bookings(id) ON DELETE CASCADE`);
    expect(code).toContain(`ALTER TABLE public.${MARKS} ENABLE ROW LEVEL SECURITY;`);
    expect(code).toContain(`REVOKE ALL ON public.${MARKS} FROM PUBLIC,anon,authenticated,service_role;`);
    expect(code).toContain(`GRANT SELECT ON public.${MARKS} TO service_role;`);
    expect(code).not.toMatch(new RegExp(`GRANT [^;]*ON public\\.${MARKS}[^;]*TO [^;]*\\b(anon|authenticated|PUBLIC)\\b`, 'i'));
    expect(code).not.toMatch(new RegExp(`CREATE POLICY[^;]*${MARKS}`, 'i'));
  });

  test('置き換えた関数の REVOKE / GRANT を同じ内容で書き直している', () => {
    expect(code).toContain('REVOKE ALL ON FUNCTION public.cleanup_deleting_account_personal_data() FROM PUBLIC,anon,authenticated,service_role;');
    for (const signature of ['list_scheduled_review_recipients(timestamptz,uuid,integer)', 'reserve_scheduled_email_atomic(text,uuid,text)',
      'start_scheduled_email_delivery(uuid,timestamptz,boolean)', 'email_address_opted_out(text)']) {
      expect(code).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC,anon,authenticated;`);
      expect(code).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`);
    }
  });

  test('期待スキーマが migration と一致している（関数本体の md5・新しい表・権限）', () => {
    const expected: string[] = JSON.parse(readFileSync(join(ROOT, 'src/lib/schema-fingerprint.expected.json'), 'utf8'));
    // フィンガープリントの body_md5 は md5(prosrc)＝$$ と $$ の間の文字列そのもの
    const md5 = (name: string) => createHash('md5').update(latestDefinition(name).prosrc, 'utf8').digest('hex');
    expect(expected).toEqual(expect.arrayContaining([
      `function|cleanup_deleting_account_personal_data()|returns=trigger|volatile=v|secdef=t|body_md5=${md5('cleanup_deleting_account_personal_data')}`,
      `function|email_address_opted_out(p_email text)|returns=boolean|volatile=s|secdef=t|body_md5=${md5('email_address_opted_out')}`,
      `function|list_scheduled_review_recipients(p_after_updated_at timestamp with time zone, p_after_id uuid, p_limit integer)|returns=TABLE(id uuid, updated_at timestamp with time zone)|volatile=s|secdef=f|body_md5=${md5('list_scheduled_review_recipients')}`,
      `function|reserve_scheduled_email_atomic(p_kind text, p_source_id uuid, p_email text)|returns=TABLE(state text, operation_id uuid, snapshot jsonb)|volatile=v|secdef=f|body_md5=${md5('reserve_scheduled_email_atomic')}`,
      `function|start_scheduled_email_delivery(p_queue_id uuid, p_claimed_at timestamp with time zone, p_recipient_current boolean)|returns=TABLE(outcome text, started_at timestamp with time zone)|volatile=v|secdef=f|body_md5=${md5('start_scheduled_email_delivery')}`,
      'functiongrant|public.email_address_opted_out(text)|service_role|EXECUTE',
      `relation|${MARKS}|r|rls=t|force=f`,
      `column|${MARKS}.booking_id|uuid|notnull=t|default=|generated=`,
      `column|${MARKS}.withdrawn_at|timestamp with time zone|notnull=t|default=now()|generated=`,
      `constraint|${MARKS}|f|${MARKS}_booking_id_fkey|FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE`,
      `constraint|${MARKS}|p|${MARKS}_pkey|PRIMARY KEY (booking_id)`,
      `index|${MARKS}|${MARKS}_pkey|CREATE UNIQUE INDEX ${MARKS}_pkey ON public.${MARKS} USING btree (booking_id)`,
      `grant|${MARKS}|service_role|SELECT`,
    ]));
    // 置き換えた関数の旧い本体の行が残っていない（同名で 2 行あると --check が落ちる）
    for (const name of ['cleanup_deleting_account_personal_data', 'list_scheduled_review_recipients', 'reserve_scheduled_email_atomic', 'start_scheduled_email_delivery', 'email_address_opted_out']) {
      expect(expected.filter((line) => line.startsWith(`function|${name}(`))).toHaveLength(1);
    }
    // ブラウザのロールへの権限は期待値にも無い
    expect(expected.filter((line) => (line.startsWith(`grant|${MARKS}|`) || line.startsWith('functiongrant|public.email_address_opted_out('))
      && !line.includes('|service_role|'))).toEqual([]);
    expect(expected.some((line) => line.startsWith('column|bookings.account_deleted_at|'))).toBe(false);
  });

  test('型と snapshot に新しい表が載り、使い捨て DB の検証が CI から実行される', () => {
    const snapshot = JSON.parse(readFileSync(join(ROOT, 'src/lib/schema-snapshot.json'), 'utf8'));
    expect(snapshot[MARKS]).toEqual(['booking_id', 'withdrawn_at']);
    expect(snapshot.bookings).not.toContain('account_deleted_at');
    const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
    expect(workflow).toContain(`-f ${FIXTURE}`);
    const fixture = readFileSync(join(ROOT, FIXTURE), 'utf8');
    expect(fixture).toContain("current_database() NOT LIKE 'carelink_shadow%'");
    expect(fixture.trim().endsWith('ROLLBACK;')).toBe(true);
    for (const label of ['retired unsubscribed member A cannot be reserved as a guest',
      'shops and browsers cannot read or write the withdrawal marks',
      'reserve refuses an address whose digest subscription was stopped by the unsubscribe link',
      'a forged profiles.email does not suppress the guest',
      'reserve refuses the confirmed login address of a member who stopped mail, even for a guest booking']) {
      expect(fixture).toContain(`'${label}'`);
    }
  });
});
