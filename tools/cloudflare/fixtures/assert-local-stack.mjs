import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { URL } from 'node:url';

// Never seed a merely "local-looking" database: prove that the running stack
// belongs to this dedicated disposable directory before any writes.
export function isolatedStack() {
  const path = process.env.CARELINK_LOCAL_STACK_STATUS;
  if (!path) throw new Error('Explicit local stack status file is required');
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  const root = realpathSync(saved.identity.project_root);
  if (root !== '/private/tmp/carelink-cf-20261029-db' || saved.runtime !== 'native') {
    throw new Error('Unexpected local stack identity');
  }
  const fresh = JSON.parse(execFileSync('npm', ['exec', '--yes', '--package=supabase@2.122.0', '--', 'supabase', 'stack', 'status', '--output-format', 'json'], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, SUPABASE_EXPERIMENTAL_STACK: '1' },
    encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  const host = new URL(fresh.env.API_URL).hostname;
  if (fresh.identity.id !== saved.identity.id || fresh.readiness !== 'ready' || fresh.env.API_URL !== saved.env.API_URL ||
      !['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('Isolated stack is not ready or changed');
  return fresh.env;
}
