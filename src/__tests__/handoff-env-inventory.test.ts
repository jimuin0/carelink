/** @jest-environment node */
// docs/handoff/environment-names.json is the list a new operator uses to
// reconfigure Vercel/Render after a handoff. A name read by code but missing
// here is silently left unset there (e.g. SLACK_ADMIN_CHANNEL_ID for the
// Render monitor would bring back "Slack 未設定のため通報スキップ").
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
// Provided by the runtime or OS, never configured by an operator.
const RUNTIME = new Set(['NODE_ENV', 'TZ', 'USER']);

function referencedNames(dirs: string[]): string[] {
  const out = execFileSync('grep', ['-rhoE', 'process\\.env\\.[A-Z0-9_]+', ...dirs], { cwd: ROOT, encoding: 'utf8' });
  return [...new Set(out.split(/\s+/).filter(Boolean).map((x) => x.split('.').pop() as string))].sort();
}
function missingFrom(names: Set<string>, refs: string[]): string[] {
  return refs.filter((k) => !RUNTIME.has(k) && !k.startsWith('VERCEL') && !names.has(k));
}

test('every environment variable read by src/ or scripts/ is in the handoff inventory', () => {
  const names = new Set<string>(JSON.parse(readFileSync(join(ROOT, 'docs/handoff/environment-names.json'), 'utf8')).names);
  const refs = referencedNames(['src', 'scripts']);
  expect(refs.length).toBeGreaterThan(30);
  expect(missingFrom(names, refs)).toEqual([]);
});

test('the check reports a name the inventory lacks (negative control)', () => {
  expect(missingFrom(new Set(['A_NAME']), ['A_NAME', 'SLACK_ADMIN_CHANNEL_ID', 'NODE_ENV', 'VERCEL_ENV'])).toEqual(['SLACK_ADMIN_CHANNEL_ID']);
});
