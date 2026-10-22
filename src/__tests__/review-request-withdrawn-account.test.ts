/** @jest-environment node */
/**
 * 退会した会員・全メール停止のアドレスへ口コミ依頼を送らない（2026年10月23日）。
 *
 * 回帰の中身: 退会すると bookings.user_id は ON DELETE SET NULL で NULL になり、profiles 行
 * （email_unsubscribed を含む）は CASCADE で消える。口コミ依頼の 3 つの判定（候補一覧・予約確保・
 * 送信直前のフェンス）はどれも「user_id が NULL＝ゲスト＝配信停止の確認なし」と扱うため、
 * 来店完了から 7 日以内に退会した会員（退会前に配信停止していた人を含む）へ口コミ依頼が届いていた。
 *
 * 振る舞いそのものは supabase/shadow/review-request-withdrawn-account-fixtures.sql が使い捨て DB で
 * 確かめる（CI の schema-fingerprint job）。ここは【最後に適用される定義】が 3 か所すべてで
 * 退会の印と宛先の配信停止を見ていることを固定する。後の migration が関数を書き直して
 * どれか 1 か所から条件が落ちると、積まれたジョブや競合中のジョブが漏れるため。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(process.cwd(), 'supabase/migrations');
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const MIGRATION = '20261023050000_review_request_withdrawn_accounts.sql';

/** 辞書順（＝適用順）で最後に現れる CREATE [OR REPLACE] FUNCTION public.<name>( の本体を返す。 */
function latestDefinition(name: string): { file: string; body: string } {
  let latest: { file: string; body: string } | null = null;
  const head = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`, 'g');
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    for (const match of sql.matchAll(head)) {
      const open = sql.indexOf('$$', match.index);
      const close = sql.indexOf('$$', open + 2);
      latest = { file, body: sql.slice(match.index, close + 2) };
    }
  }
  if (!latest) throw new Error(`no definition for ${name}`);
  return latest;
}

describe('最後に適用される定義が退会者と配信停止アドレスを除外する', () => {
  test('退会と同じトランザクションで、その会員の予約に退会時刻を記録する', () => {
    const { body } = latestDefinition('cleanup_deleting_account_personal_data');
    expect(body).toContain('SECURITY DEFINER SET search_path');
    expect(body).toMatch(/UPDATE public\.bookings SET account_deleted_at=clock_timestamp\(\) WHERE user_id=OLD\.id/);
    // 既存の後始末（LINE 連携・ポイント等）は 1 つも落としていない
    for (const statement of ['DELETE FROM public.line_user_links l WHERE l.user_id=OLD.id', 'DELETE FROM public.user_points WHERE user_id=OLD.id',
      'UPDATE public.api_keys SET created_by=NULL WHERE created_by=OLD.id', 'PERFORM 1 FROM public.profiles p WHERE p.id=OLD.id FOR UPDATE']) {
      expect(body).toContain(statement);
    }
  });

  test.each([
    ['list_scheduled_review_recipients', 'b.account_deleted_at IS NULL AND NOT public.email_address_opted_out(b.email)'],
    ['reserve_scheduled_email_atomic', 'IF b.account_deleted_at IS NOT NULL OR public.email_address_opted_out(b.email) THEN'],
    ['start_scheduled_email_delivery', 'AND b.account_deleted_at IS NULL AND NOT public.email_address_opted_out(b.email);'],
  ])('%s', (name, condition) => {
    const { file, body } = latestDefinition(name);
    expect(file >= MIGRATION).toBe(true);
    expect(body).toContain(condition);
    expect(body).toContain('SECURITY INVOKER SET search_path=\'\'');
  });

  test('宛先の配信停止は profiles と全メール停止行の両方を、大文字小文字・前後空白を無視して見る', () => {
    const { body } = latestDefinition('email_address_opted_out');
    expect(body).toContain("lower(btrim(p.email))=lower(btrim(p_email)) AND p.email_unsubscribed IS TRUE");
    expect(body).toContain("lower(btrim(n.email))=lower(btrim(p_email))");
    expect(body).toContain("n.subscription_type='all' AND n.is_active IS FALSE");
  });
});

describe('migration の形', () => {
  let sql = '';
  beforeAll(() => { sql = readFileSync(join(MIGRATIONS, MIGRATION), 'utf8'); });

  test('CareLink の DB でなければ何もしない', () => {
    const code = sql.split('\n').filter((line) => !line.startsWith('--')).join('\n').trim();
    expect(code.startsWith("DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;")).toBe(true);
  });

  test('追加と置き換えだけ（アプリより先に適用しても旧アプリが動く）', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS account_deleted_at timestamptz');
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|FUNCTION)|ALTER\s+COLUMN|RENAME/i);
    expect(sql.match(/^CREATE FUNCTION/gm)).toBeNull();
  });

  test('置き換えた関数の REVOKE / GRANT を同じ内容で書き直している', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.cleanup_deleting_account_personal_data() FROM PUBLIC,anon,authenticated,service_role;');
    for (const signature of ['list_scheduled_review_recipients(timestamptz,uuid,integer)', 'reserve_scheduled_email_atomic(text,uuid,text)',
      'start_scheduled_email_delivery(uuid,timestamptz,boolean)', 'email_address_opted_out(text)']) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC,anon,authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`);
    }
  });

  test('型と snapshot に新しい列が載り、使い捨て DB の検証が CI から実行される', () => {
    const snapshot = JSON.parse(readFileSync(join(process.cwd(), 'src/lib/schema-snapshot.json'), 'utf8'));
    expect(snapshot.bookings).toContain('account_deleted_at');
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/schema-fingerprint.yml'), 'utf8');
    expect(workflow).toContain('-f supabase/shadow/review-request-withdrawn-account-fixtures.sql');
    const fixture = readFileSync(join(process.cwd(), 'supabase/shadow/review-request-withdrawn-account-fixtures.sql'), 'utf8');
    expect(fixture).toContain("current_database() NOT LIKE 'carelink_shadow%'");
    expect(fixture.trim().endsWith('ROLLBACK;')).toBe(true);
    expect(fixture).toContain("'retired unsubscribed member A cannot be reserved as a guest'");
  });
});
