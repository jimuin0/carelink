/** @jest-environment node */
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260921000001_reminder_delivery_reconciliation.sql'), 'utf8');
const schema = JSON.parse(readFileSync(join(process.cwd(), 'src/lib/schema-snapshot.json'), 'utf8'));
const route = readFileSync(join(process.cwd(), 'src/app/api/cron/booking-reminder/route.ts'), 'utf8');

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
