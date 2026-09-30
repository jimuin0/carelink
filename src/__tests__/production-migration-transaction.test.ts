/** @jest-environment node */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Official apply_migration owns the transaction containing SQL and history.
// An embedded top-level COMMIT must not commit DDL before that history write.
const migratedNames = [
  'salon_submission_intents', 'salon_intent_capability_expiry',
  'salon_photo_manifest', 'published_facility_location',
  'atomic_facility_setup', 'registration_review_revision',
  'profile_insert_privilege_guard', 'contact_reply_idempotency',
  'webhook_retry_delivery_start_reconciliation',
  'validate_published_facility_location',
];

// Inspect statement starts, not line starts. Quoted function bodies are not
// top-level SQL; comments and identifiers must not manufacture control tokens.
function transactionStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i + 2);
      i = end < 0 ? sql.length : end + 1;
      current += ' ';
    } else if (sql.startsWith('/*', i)) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.startsWith('/*', i)) { depth++; i += 2; }
        else if (sql.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      if (depth !== 0) throw new Error('Unterminated SQL comment');
      current += ' ';
    } else if (sql[i] === "'" || sql[i] === '"') {
      const escapeString = sql[i] === "'" && /(?:^|[^a-z_0-9$])e$/i.test(sql.slice(0, i));
      const quote = sql[i++];
      let closed = false;
      while (i < sql.length) {
        if (quote === "'" && !escapeString && sql[i] === '\\' && (sql[i + 1] === "'" || sql[i + 1] === '\\')) {
          throw new Error('Unsupported SQL ordinary-string backslash');
        }
        if (sql[i] === quote && sql[i + 1] === quote) i += 2;
        else if (sql[i] === quote) { i++; closed = true; break; }
        else if (escapeString && sql[i] === '\\') i += 2;
        else i++;
      }
      if (!closed) throw new Error('Unterminated SQL quote');
      current += ' quoted ';
    } else if (sql[i] === '$' && /^\$(?:[a-z_][a-z_0-9]*)?\$/i.test(sql.slice(i))) {
      const delimiter = sql.slice(i).match(/^\$(?:[a-z_][a-z_0-9]*)?\$/i)![0];
      const end = sql.indexOf(delimiter, i + delimiter.length);
      if (end < 0) throw new Error('Unterminated SQL function body');
      i = end + delimiter.length;
      current += ' quoted ';
    } else if (sql[i] === ';') {
      statements.push(current.trim());
      current = '';
      i++;
    } else current += sql[i++];
  }
  if (current.trim()) statements.push(current.trim());
  if (statements.some(statement => /^set\b/i.test(statement))) {
    throw new Error('Unsupported SQL session setting');
  }
  return statements.filter(statement => /^(?:begin\b|start\s+transaction\b|commit\b|end\b|rollback\b|abort\b|savepoint\b|release\s+savepoint\b|prepare\s+transaction\b|set\s+transaction\b)/i.test(statement));
}

test.each([
  'commit;', 'SELECT 1; COMMIT;', 'COMMIT WORK;', 'COMMIT AND CHAIN;',
  'END;', 'ROLLBACK TRANSACTION;', 'START TRANSACTION;', 'begin;',
  '/* nested /* comment */ here */ CoMmIt;', '-- header\nCOMMIT;',
  'PREPARE TRANSACTION \'x\';', 'ABORT;', 'SAVEPOINT x;',
])('rejects top-level transaction control: %s', sql => {
  expect(transactionStatements(sql)).toHaveLength(1);
});

test('does not confuse strings, identifiers, comments or function bodies with transaction controls', () => {
  expect(transactionStatements(`-- COMMIT;
    SELECT 'COMMIT; it''s text', "COMMIT";
    /* END; */ DO $$ BEGIN PERFORM 1; END; $$;
    CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $body$ BEGIN RETURN; END; $body$;
  `)).toEqual([]);
});

test('ordinary strings do not let a backslash hide the following COMMIT', () => {
  expect(() => transactionStatements(String.raw`SELECT 'a\'; COMMIT; -- '`)).toThrow('Unsupported SQL ordinary-string backslash');
});

test('E strings support escaped quotes without manufacturing statement starts', () => {
  expect(transactionStatements(String.raw`SELECT E'a\'; COMMIT;';`)).toEqual([]);
});

test('Unicode escape literals without ambiguous quote/backslash pairs remain supported', () => {
  expect(transactionStatements(String.raw`SELECT U&'\0020\3000';`)).toEqual([]);
});

test.each(['SET standard_conforming_strings=on;', 'SET LOCAL standard_conforming_strings=off;', 'SET "standard_conforming_strings"=off;'])('rejects unsupported session changes: %s', sql => {
  expect(() => transactionStatements(sql)).toThrow('Unsupported SQL session setting');
});

test.each(["SELECT 'unterminated", 'DO $$ BEGIN;', '/* unterminated'])('fails closed for malformed quoting: %s', sql => {
  expect(() => transactionStatements(sql)).toThrow(/Unterminated SQL/);
});

test.each(migratedNames)('%s keeps transaction completion under the official migration runner', name => {
  const directory = join(process.cwd(), 'supabase/migrations');
  const matches = readdirSync(directory).filter(file => file.replace(/^\d{14}_/, '') === `${name}.sql`);
  expect(matches).toHaveLength(1);
  const sql = readFileSync(join(directory, matches[0]), 'utf8');
  expect(transactionStatements(sql)).toEqual([]);
});

test('location validation is a separate forward migration without invented business data', () => {
  const directory = join(process.cwd(), 'supabase/migrations');
  const file = readdirSync(directory).find(name => name.endsWith('_validate_published_facility_location.sql'));
  expect(file).toBeDefined();
  const sql = readFileSync(join(directory, file!), 'utf8');
  expect(sql).toMatch(/ALTER TABLE public\.facility_profiles\s+VALIDATE CONSTRAINT published_facility_location_present;/);
  expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/i);
});
