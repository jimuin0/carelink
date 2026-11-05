// Build and deploy the production Worker from the operator's machine.
//
// NEXT_PUBLIC_* values are inlined into the browser and server bundles at build
// time, so they are read from Vercel's Production environment, trimmed (the
// Vercel values carry a trailing newline that a shell `source` turns into a
// literal "\n" and breaks the Supabase key) and passed to the build directly.
// Server secrets are not read here: they stay registered on the Worker.
// The temporary env file is private (0600) and removed even on failure.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function parsePublicEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^(NEXT_PUBLIC_[A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const value = match[2].startsWith('"') ? JSON.parse(match[2]) : match[2];
    out[match[1]] = value.trim();
  }
  return out;
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed`);
}

function main() {
  if (existsSync('.dev.vars')) throw new Error('Remove .dev.vars before a production build');
  const dir = mkdtempSync(join(tmpdir(), 'carelink-public-env-'));
  const file = join(dir, 'production.env');
  try {
    run('npx', ['-y', 'vercel@latest', 'env', 'pull', file, '--environment=production', '--yes']);
    const env = parsePublicEnv(readFileSync(file, 'utf8'));
    rmSync(dir, { recursive: true, force: true });
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
      if (!env[key]) throw new Error(`${key} is missing from Vercel Production`);
    }
    rmSync('dist', { recursive: true, force: true });
    run('npm', ['run', 'build:vinext'], { ...process.env, ...env });
    rmSync('dist/server/.dev.vars', { force: true });
    const sha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    run('npx', ['wrangler', 'deploy', '--var', `VERCEL_GIT_COMMIT_SHA:${sha}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
