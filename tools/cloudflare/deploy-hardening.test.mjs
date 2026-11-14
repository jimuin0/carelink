import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseTarget } from './deploy-target.mjs';
import { pageProblem, PAGES } from './verify-live.mjs';
import { missingSecrets } from './check-worker-secrets.mjs';

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
// History A <- B <- C (C is the head of main).
const order = [A, B, C];
const isAncestor = (x, y) => order.indexOf(x) !== -1 && order.indexOf(x) <= order.indexOf(y);

test('the head is deployed when its CI succeeded', () => {
  assert.deepEqual(chooseTarget({ greenShas: [C, B], head: C, liveSha: A, isAncestor }).sha, C);
});

test('a red or running head does not freeze production: the newest green commit is deployed', () => {
  const d = chooseTarget({ greenShas: [B, A], head: C, liveSha: A, isAncestor });
  assert.equal(d.skip, false);
  assert.equal(d.sha, B);
});

test('a commit whose CI never passed is never chosen, even on a manual run', () => {
  assert.equal(chooseTarget({ greenShas: [], head: C, liveSha: A, isAncestor }).skip, true);
});

test('green commits that are not on main are ignored', () => {
  const X = 'd'.repeat(40);
  assert.equal(chooseTarget({ greenShas: [X], head: C, liveSha: A, isAncestor }).skip, true);
});

test('nothing older than the live version is deployed', () => {
  assert.equal(chooseTarget({ greenShas: [B], head: C, liveSha: C, isAncestor }).skip, true);
  assert.equal(chooseTarget({ greenShas: [C], head: C, liveSha: C, isAncestor }).skip, true);
});

test('an unknown live version still deploys the newest green commit', () => {
  assert.equal(chooseTarget({ greenShas: [C], head: C, liveSha: '', isAncestor }).sha, C);
});

test('a commit that was rolled back is not picked again unless retried explicitly', () => {
  assert.equal(chooseTarget({ greenShas: [B, A], head: C, liveSha: A, isAncestor, badShas: [B] }).skip, true);
  assert.equal(chooseTarget({ greenShas: [B, A], head: C, liveSha: A, isAncestor, badShas: [B], retrySha: B }).sha, B);
});

test('the shared layout alone does not pass, and the app error screen fails', () => {
  const home = PAGES.find((p) => p.path === '/');
  assert.match(pageProblem(home, 200, '<title>CareLink</title>'), /期待する中身/);
  assert.match(pageProblem(home, 200, '業種から探す エラーが発生しました'), /エラー表示/);
});

test('a heading split by <br/> still matches its marker (2026-11-12 false rollback)', () => {
  const register = PAGES.find((p) => p.path === '/register');
  assert.equal(pageProblem(register, 200, '<h1>予約も、集客も、<br/>ひとつに。</h1>'), '');
});

test('pages fail on a non-200, an error screen, or missing content', () => {
  const search = PAGES.find((p) => p.path === '/search');
  assert.equal(pageProblem(search, 200, '<a href="/facility/x">'), '');
  assert.match(pageProblem(search, 503, ''), /503/);
  assert.match(pageProblem(search, 200, 'Application error href="/facility/x"'), /エラー表示/);
  assert.match(pageProblem(search, 200, '<p>0件</p>'), /期待する中身/);
});

test('missing Worker secrets are reported by name', () => {
  assert.deepEqual(missingSecrets(['A', 'B', 'C'], ['B']), ['A', 'C']);
  assert.deepEqual(missingSecrets(['A'], ['A', 'Z']), []);
});
