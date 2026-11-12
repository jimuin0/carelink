// Decide which commit the production Worker should be deployed from.
//
// The target is the newest commit on main whose CI (push) succeeded. It does not have
// to be the head of main: when the newest commit's CI is red or still running, the
// latest green commit is still deployed, so one flaky test does not freeze production
// on an older version. A manual run goes through the same rule and can never deploy a
// commit whose CI has not passed. Nothing older than what is live is ever deployed.
//
// A commit that already failed live verification and was rolled back is never picked
// again automatically (the workflow records it as an artifact named
// bad-deploy-<sha>); otherwise every later red CI run would redeploy the same broken
// version. A manual run can retry one explicitly with RETRY_SHA.
//
// Writes sha / skip / reason to GITHUB_OUTPUT.
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const SHA = /^[0-9a-f]{40}$/;

export function chooseTarget({ greenShas, head, liveSha, isAncestor, badShas = [], retrySha = '' }) {
  const bad = new Set(badShas.filter((sha) => sha !== retrySha));
  const candidates = greenShas.filter((sha) => SHA.test(sha) && !bad.has(sha) && isAncestor(sha, head));
  const target = candidates[0];
  if (!target) return { skip: true, reason: 'main に CI が成功したコミットが無い' };
  if (liveSha && target === liveSha) return { skip: true, sha: target, reason: '本番は既にこのコミット' };
  if (liveSha && isAncestor(target, liveSha)) return { skip: true, sha: target, reason: '本番の方が新しい' };
  return { skip: false, sha: target, reason: target === head ? 'main の先頭' : `main の先頭 ${head.slice(0, 7)} は CI 未成功のため、最新の成功コミットを配信` };
}

function git(args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

function gh(path) {
  const result = spawnSync('gh', ['api', path], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`gh api ${path} failed`);
  return JSON.parse(result.stdout);
}

async function liveVersion(url) {
  try {
    const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
    const body = await res.json();
    return typeof body.version === 'string' ? body.version : '';
  } catch {
    return '';
  }
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const head = gh(`repos/${repo}/commits/main`).sha;
  const runs = gh(`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=30`).workflow_runs;
  const greenShas = runs.map((run) => run.head_sha);
  const artifacts = gh(`repos/${repo}/actions/artifacts?name_prefix=bad-deploy-&per_page=100`).artifacts ?? [];
  const badShas = artifacts.filter((a) => !a.expired && a.name.startsWith('bad-deploy-')).map((a) => a.name.slice('bad-deploy-'.length));
  const short = await liveVersion('https://carelink-jp.com/api/health');
  const resolved = short ? git(['rev-parse', '--verify', '--quiet', `${short}^{commit}`]).stdout.trim() : '';
  const isAncestor = (a, b) => git(['merge-base', '--is-ancestor', a, b]).status === 0;
  const decision = chooseTarget({ greenShas, head, liveSha: SHA.test(resolved) ? resolved : '', isAncestor, badShas, retrySha: process.env.RETRY_SHA ?? '' });
  console.log(`本番 ${short || '不明'} / main ${head.slice(0, 7)} / 判定: ${decision.reason}`);
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `skip=${decision.skip}\nsha=${decision.sha ?? ''}\nhead=${head}\nlive=${short}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
