// Refuse to deploy when a server secret the app needs is not registered on the Worker.
// Only names are compared; values are never read. The list of names lives in
// required-worker-secrets.json so adding a secret to the app means adding it there.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function missingSecrets(required, registered) {
  const have = new Set(registered);
  return required.filter((name) => !have.has(name));
}

function main() {
  const required = JSON.parse(readFileSync(new URL('./required-worker-secrets.json', import.meta.url), 'utf8')).names;
  const result = spawnSync('npx', ['wrangler', 'secret', 'list', '--format', 'json'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('wrangler secret list failed');
  const missing = missingSecrets(required, JSON.parse(result.stdout).map((s) => s.name));
  if (missing.length) throw new Error(`Worker に未登録の秘密値: ${missing.join(', ')}`);
  console.log(`Worker の秘密値 ${required.length} 個を名前で確認した`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
