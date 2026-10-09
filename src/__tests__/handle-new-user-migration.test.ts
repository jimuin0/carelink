/** @jest-environment node */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const directory = join(process.cwd(), 'supabase/migrations');
const definition = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?handle_new_user\(\)/i;
const candidates = readdirSync(directory).filter(name => /^\d{14}_.*\.sql$/.test(name))
  .sort().map(name => ({ name, sql: readFileSync(join(directory, name), 'utf8') }))
  .filter(file => definition.test(file.sql));

test('the effective forward signup trigger propagates profile errors without changing its existing fields or privileges', () => {
  expect(candidates.length).toBeGreaterThan(0);
  const latest = candidates[candidates.length - 1];
  expect(latest.name).toBe('20261009002705_handle_new_user_profile_transaction.sql');
  const former = readFileSync(join(directory, '20260805000001_handle_new_user_merge.sql'), 'utf8');
  const body = (sql: string) => sql.split('AS $function$\n')[1].split('\n$function$;')[0];
  const removedCatch = '\nEXCEPTION WHEN OTHERS THEN\n  RETURN NEW;  -- プロフィール作成失敗でもサインアップを止めない';
  expect(body(former)).toContain(removedCatch);
  expect(body(latest.sql)).toBe(body(former).replace(removedCatch, ''));
  expect(latest.sql).toContain('SECURITY DEFINER');
  expect(latest.sql).toContain("SET search_path TO 'public', 'extensions', 'pg_temp'");
  expect(latest.sql).not.toMatch(/\b(?:GRANT|REVOKE|DROP\s+(?:FUNCTION|TRIGGER))\b/i);
  expect(latest.sql).not.toMatch(/\b(?:UPDATE|DELETE\s+FROM)\s+(?:public\.)?(?:profiles|auth\.users)\b/i);
});
