/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SALON_INTENT_TTL_SECONDS } from '@/lib/salon-submission-proof';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const original = read('supabase/migrations/20260926000001_salon_submission_intents.sql');
const upgrade = read('supabase/migrations/20260926000002_salon_intent_capability_expiry.sql');
const fixture = read('supabase/shadow/salon-submission-fixtures.sql');

test('RPC independently rejects future and expired capabilities after lock, before receipt replay', () => {
  const lock = upgrade.indexOf('WHERE id = p_intent_id FOR UPDATE');
  const deadline = upgrade.indexOf('IF intent.created_at > clock_timestamp()');
  const replay = upgrade.indexOf('IF intent.salon_id IS NOT NULL');
  expect(lock).toBeGreaterThan(0);
  expect(deadline).toBeGreaterThan(lock);
  expect(replay).toBeGreaterThan(deadline);
  const lifetime = upgrade.slice(deadline, replay);
  expect(lifetime).toContain(`interval '${SALON_INTENT_TTL_SECONDS / 3600} hours' <= clock_timestamp()`);
  expect(lifetime).toContain("RETURN QUERY SELECT 'unverified'::text, NULL::uuid;");
});

test('upgrade changes only the capability gate, preserving atomic writes, replay and ACL', () => {
  // This is a static change-boundary assertion, not proof of SQL execution.
  const withoutGate = upgrade.replace(
    /  -- The capability lifetime[\s\S]*?  IF p_payload_hmac IS NULL/,
    '  IF p_payload_hmac IS NULL',
  ).replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION');
  expect(withoutGate.slice(withoutGate.indexOf('CREATE FUNCTION')).trim())
    .toBe(original.slice(original.indexOf('CREATE FUNCTION')).trim());
  expect(upgrade).not.toMatch(/DROP\s+(TABLE|COLUMN)|DELETE\s+FROM/i);
});

test('real database fixtures cover expired replay, extended preparation and future issuance', () => {
  for (const label of [
    'committed capability cannot replay at or beyond its three-day deadline',
    'long preparation window cannot extend capability lifetime',
    'future issue time is rejected',
    'capability rejection does not create receipts or outbox entries',
    'lost response retry preserves receipt even after preparation expiry',
  ]) expect(fixture).toContain(label);
  expect(fixture).toContain("current_database() <> 'carelink_shadow'");
  expect(fixture).toMatch(/BEGIN;[\s\S]*ROLLBACK;/);
  expect(fixture).not.toMatch(/\bCOMMIT;/);
  expect(read('.github/workflows/schema-fingerprint.yml'))
    .toContain('psql -v ON_ERROR_STOP=1 -d carelink_shadow -f supabase/shadow/salon-submission-fixtures.sql');
});
