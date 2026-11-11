// Build and deploy the production Worker.
//
// NEXT_PUBLIC_* values are inlined into the browser and server bundles at build
// time. On the operator's machine they are read from Vercel's Production
// environment; in GitHub Actions (CARELINK_PUBLIC_ENV_SOURCE=environment) they
// come from repository variables already in the process environment. Either way
// they are trimmed (the Vercel values carry a trailing newline that a shell
// `source` turns into a literal "\n" and breaks the Supabase key) and only
// NEXT_PUBLIC_* names are passed to the build.
// Server secrets are not read here: they stay registered on the Worker.
// The temporary env file is private (0600) and removed even on failure.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REQUIRED_PUBLIC = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];

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

// Unset repository variables reach the job as empty strings; drop them so the
// build sees the same "not configured" state as on Vercel.
export function publicEnvFromProcess(env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (!/^NEXT_PUBLIC_[A-Z0-9_]+$/.test(key) || typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

export function missingPublicEnv(env) {
  return REQUIRED_PUBLIC.filter((key) => !env[key]);
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed`);
}

function readVercelPublicEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'carelink-public-env-'));
  const file = join(dir, 'production.env');
  try {
    run('npx', ['-y', 'vercel@latest', 'env', 'pull', file, '--environment=production', '--yes']);
    return parsePublicEnv(readFileSync(file, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  if (existsSync('.dev.vars')) throw new Error('Remove .dev.vars before a production build');
  const env = process.env.CARELINK_PUBLIC_ENV_SOURCE === 'environment'
    ? publicEnvFromProcess(process.env)
    : readVercelPublicEnv();
  const missing = missingPublicEnv(env);
  if (missing.length) throw new Error(`${missing.join(', ')} missing from the public build settings`);
  const buildEnv = { ...process.env };
  for (const key of Object.keys(buildEnv)) if (key.startsWith('NEXT_PUBLIC_')) delete buildEnv[key];
  rmSync('dist', { recursive: true, force: true });
  run('npm', ['run', 'build:vinext'], { ...buildEnv, ...env });
  rmSync('dist/server/.dev.vars', { force: true });
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  run('npx', ['wrangler', 'deploy', '--var', `VERCEL_GIT_COMMIT_SHA:${sha}`]);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
