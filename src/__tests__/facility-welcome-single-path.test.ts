/** @jest-environment node */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 新規オーナーへのウェルカムメールは「店舗を作った同じトランザクションで outbox に積み、
 * webhook-retry が送る」1 本だけにする（facility-welcome-delivery.ts）。
 *
 * 以前は email.ts に呼び出し元の無い sendWelcomeEmail が残っており、本文も
 * 「メニュー・スタッフ・写真の 3 ステップで公開」と、実際の無料掲載の公開条件
 * （LISTING_PUBLISH_REQUIREMENT）と食い違っていた。呼べば誤った案内が二重に届くので撤去した。
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

test('email.ts no longer carries a second, contradictory welcome email', () => {
  expect(read('src/lib/email.ts')).not.toMatch(/sendWelcomeEmail|3ステップ/);
});

test('the only welcome text is built from the single-source publish requirement and links to /admin', () => {
  const source = read('src/lib/facility-welcome-delivery.ts');
  expect(source).toContain("import { LISTING_PUBLISH_REQUIREMENT } from './register-photo-policy'");
  expect(source).toContain('${LISTING_PUBLISH_REQUIREMENT}');
  expect(source).toContain('${SITE_URL}/admin');
  expect(source).toContain('from: fromEnv()');
  // 同じ店舗には何度処理されても 1 通（Resend の冪等キーを店舗 ID で固定）。
  expect(source).toContain('idempotencyKey: `facility-welcome-v1-${job.target_id}`');
});

test('the newest setup RPC enqueues the welcome only on the created path (not on replay/already_member)', () => {
  const dir = join(process.cwd(), 'supabase/migrations');
  const latest = readdirSync(dir).filter(name => /^\d+_.*\.sql$/.test(name)).sort()
    .filter(name => read(`supabase/migrations/${name}`).includes('FUNCTION public.setup_facility_from_registration')).pop()!;
  const sql = read(`supabase/migrations/${latest}`);
  const enqueue = sql.lastIndexOf("VALUES('facility_welcome'");
  expect(enqueue).toBeGreaterThan(0);
  // 積んだ直後に返すのは created だけ。replay / linked / already_member はこれより前で返る。
  expect(sql.slice(enqueue, sql.indexOf('RETURN QUERY', enqueue) + 40)).toContain("RETURN QUERY SELECT 'created'");
  expect(sql.match(/VALUES\('facility_welcome'/g)).toHaveLength(1);
});
