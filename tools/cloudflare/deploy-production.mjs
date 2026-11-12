// Build and deploy the production Worker.
//
// NEXT_PUBLIC_* values are inlined into the browser and server bundles at build
// time. Their single source is the GitHub repository variables: GitHub Actions
// (CARELINK_PUBLIC_ENV_SOURCE=environment) receives them in the process
// environment, and the operator's machine reads the same variables with `gh`.
// Either way they are trimmed (a trailing newline once turned into a literal "\n"
// and broke the Supabase key) and only NEXT_PUBLIC_* names are passed to the build.
// Server secrets are not read here: they stay registered on the Worker.
// The temporary env file is private (0600) and removed even on failure.
import { spawnSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';

const REQUIRED_PUBLIC = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const REPO = process.env.CARELINK_GITHUB_REPO ?? 'jimuin0/carelink';

export function parseGithubVariables(json) {
  return publicEnvFromProcess(Object.fromEntries(JSON.parse(json).map(({ name, value }) => [name, value])));
}

// The deployed version is reported by /api/health and checked after the deploy, so
// an empty or malformed commit id must stop the deploy instead of shipping silently.
export function assertCommitSha(sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`Not a commit id: "${sha}"`);
  return sha;
}

// Unset repository variables reach the job as empty strings; drop them so the
// build sees the same "not configured" state as a variable that was never set.
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

function readGithubPublicEnv() {
  const result = spawnSync('gh', ['variable', 'list', '--repo', REPO, '--json', 'name,value'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('gh variable list failed');
  return parseGithubVariables(result.stdout);
}

function main() {
  if (existsSync('.dev.vars')) throw new Error('Remove .dev.vars before a production build');
  const env = process.env.CARELINK_PUBLIC_ENV_SOURCE === 'environment'
    ? publicEnvFromProcess(process.env)
    : readGithubPublicEnv();
  const missing = missingPublicEnv(env);
  if (missing.length) throw new Error(`${missing.join(', ')} missing from the public build settings`);
  const buildEnv = { ...process.env };
  for (const key of Object.keys(buildEnv)) if (key.startsWith('NEXT_PUBLIC_')) delete buildEnv[key];
  rmSync('dist', { recursive: true, force: true });
  run('npm', ['run', 'build:vinext'], { ...buildEnv, ...env });
  rmSync('dist/server/.dev.vars', { force: true });
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  const sha = assertCommitSha(head.status === 0 ? head.stdout.trim() : '');
  run('npx', ['wrangler', 'deploy', '--var', `VERCEL_GIT_COMMIT_SHA:${sha}`]);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
