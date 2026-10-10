/** @jest-environment node */
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260921000001_reminder_delivery_reconciliation.sql'), 'utf8');
const schema = JSON.parse(readFileSync(join(process.cwd(), 'src/lib/schema-snapshot.json'), 'utf8'));
const route = readFileSync(join(process.cwd(), 'src/app/api/cron/booking-reminder/route.ts'), 'utf8');
const proofMigration = readFileSync(join(process.cwd(), 'supabase/migrations/20261009023828_verified_liff_line_ownership.sql'), 'utf8');
const lineResolver = readFileSync(join(process.cwd(), 'src/lib/line-link.ts'), 'utf8');

test('追加migrationは旧claimを保持し、匿名/一般ユーザーにRPCを公開しない', () => {
  expect(sql).toContain("DEFAULT 'legacy'");
  expect(sql).toContain('SECURITY INVOKER SET search_path = public');
  expect(sql).toMatch(/REVOKE ALL ON FUNCTION public.pending_booking_reminders\(date\) FROM PUBLIC, anon, authenticated/);
  expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public.pending_booking_reminders\(date\) TO service_role/);
  expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)|DELETE\s+FROM/i);
  expect(schema.sent_reminders).toContain('delivery_state');
});

test('SQLは予約日・kind単位の既claimをDB側で排除してからrouteの上限を適用する', () => {
  expect(sql).toContain("b.status = 'confirmed'");
  expect(sql).toContain('r.booking_id = b.id AND r.reminder_date = b.booking_date AND r.kind = candidate.kind');
  expect(sql).toMatch(/AND NOT EXISTS\s*\(\s*SELECT 1 FROM public.sent_reminders/);
  for (const kind of ['email_1d', 'email_3d', 'email_7d', 'line_3d', 'line_7d']) expect(sql).toContain(`'${kind}'`);
  expect(route).toContain(".rpc('pending_booking_reminders'");
  expect(route).toContain(".eq('delivery_state', 'claimed').lt('sent_at', staleClaimBefore)");
});

test('候補選択で参照する全table/columnがsnapshotに実在する', () => {
  const aliases = { b: 'bookings', s: 'facility_reminder_settings', p: 'profiles', e: 'facility_entitlements', r: 'sent_reminders' };
  const refs = [...sql.matchAll(/\b([bsper])\.([a-z_]+)\b/g)];
  expect(refs.length).toBeGreaterThan(20);
  for (const [, alias, column] of refs) expect(schema[aliases[alias as keyof typeof aliases]]).toContain(column);
});

test('全通知種別で空文字宛先を上限適用前に除外し、送信プラン外の予約が後続を塞がない', () => {
  for (const kind of ['email_1d', 'email_3d', 'email_7d']) {
    const candidate = sql.split('\n').find((line) => line.includes(`('${kind}',`));
    expect(candidate).toContain("b.email IS NOT NULL AND b.email <> ''");
  }
  for (const kind of ['line_3d', 'line_7d']) {
    const candidate = sql.split('\n').find((line) => line.includes(`('${kind}',`));
    expect(candidate).toContain("p.line_user_id IS NOT NULL AND p.line_user_id <> ''");
  }
  expect(route).toContain('if (booking.email) plan.push');
  expect(route).toContain('await resolveLineUserIdsForUsers(supabase, lineCandidateUserIds.slice(i, i + IN_CHUNK))');
  expect(route).toContain('for (const [userId, lineId] of verified) lineMap.set(userId, lineId)');
  expect(lineResolver).toContain(".from('line_user_links')");
  expect(lineResolver).toContain('byUser.get(link.user_id) === link.line_user_id');
  expect(lineResolver).toContain('link.proof_version === 1');
  expect(lineResolver).toContain('Number.isFinite(Date.parse(link.verified_at))');
  expect(proofMigration).toContain('l.user_id=b.user_id AND l.line_user_id=p.line_user_id AND l.proof_version=1 AND l.verified_at IS NOT NULL');
  expect(proofMigration).toContain("replace(definition,old_candidate,'l.user_id IS NOT NULL')");
});

test('実DB fixtureは使い捨てshadowだけで全件rollbackし、fresh-apply後にCIから実行される', () => {
  const fixture = readFileSync(join(process.cwd(), 'supabase/shadow/reminder-delivery-fixtures.sql'), 'utf8');
  const workflow = readFileSync(join(process.cwd(), '.github/workflows/schema-fingerprint.yml'), 'utf8');
  expect(fixture).toContain("current_database() <> 'carelink_shadow'");
  expect(fixture).toContain('IF EXISTS (SELECT 1 FROM public.bookings)');
  expect(fixture).toMatch(/BEGIN;[\s\S]*ROLLBACK;/);
  expect(fixture).not.toMatch(/\bCOMMIT;/);
  for (const role of ['anon', 'authenticated', 'service_role']) expect(fixture).toContain(`SET LOCAL ROLE ${role};`);
  expect(fixture).toContain('public.bind_verified_liff_account_atomic(');
  expect(fixture).toContain('proof_version=1 AND verified_at IS NOT NULL');
  expect(fixture).toContain("ARRAY['01','08','09','10','12']");
  expect(fixture).toContain('generate_series(1, 5001)');
  expect(workflow).toContain('psql -v ON_ERROR_STOP=1 -d carelink_shadow -f supabase/shadow/reminder-delivery-fixtures.sql');
  expect(workflow.indexOf('bash scripts/gen-schema-fingerprint.sh --check')).toBeLessThan(workflow.indexOf('-f supabase/shadow/reminder-delivery-fixtures.sql'));
});
