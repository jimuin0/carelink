import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneVcrImages, selectImagesToDelete, KEEP_NEWEST } from './prune-vcr-images.mjs';

const NOW = Date.parse('2026-10-29T00:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
// 50 個（上限ちょうど）。i が大きいほど古い。タグは 12 桁の commit sha 形式。
const tag = (i) => i.toString(16).padStart(2, '0').repeat(6);
const images = Array.from({ length: 50 }, (_, i) => ({ id: `image_${i}`, tags: [tag(i)], createdAt: hoursAgo(2 + i * 3) }));
const LIVE = tag(30).slice(0, 7);

test('直近・24時間未満・稼働中の本番・直近の本番配信は消さず、残りの古いものだけを選ぶ', () => {
  const selected = selectImagesToDelete({ images, protectedTags: [tag(25), tag(45)], liveVersion: LIVE, now: NOW });
  const ids = selected.map((image) => image.id);
  assert.equal(ids.length, 50 - KEEP_NEWEST - 3);
  for (const kept of ['image_0', 'image_19', 'image_25', 'image_30', 'image_45']) assert.ok(!ids.includes(kept), kept);
  assert.ok(ids.includes('image_20') && ids.includes('image_49'));
});

test('作成から24時間未満のものは、件数が多くても消さない', () => {
  const fresh = images.map((image, i) => ({ ...image, createdAt: hoursAgo(i * 0.4) }));
  assert.deepEqual(selectImagesToDelete({ images: fresh, protectedTags: [tag(1)], liveVersion: tag(0).slice(0, 7), now: NOW }), []);
});

test('上限より十分少なければ何も消さない', () => {
  assert.deepEqual(selectImagesToDelete({ images: images.slice(0, KEEP_NEWEST), protectedTags: [tag(1)], liveVersion: tag(0).slice(0, 7), now: NOW }), []);
});

test('本番の版を確認できないときは何も選ばずに止まる', () => {
  assert.throws(() => selectImagesToDelete({ images, protectedTags: [], liveVersion: LIVE, now: NOW }), /本番配信の版/);
  assert.throws(() => selectImagesToDelete({ images, protectedTags: [tag(1)], liveVersion: undefined, now: NOW }), /稼働中の本番/);
  assert.throws(() => selectImagesToDelete({ images, protectedTags: [tag(1)], liveVersion: 'fffffff', now: NOW }), /一覧に無い/);
});

function fakeApi({ failDeleteOf } = {}) {
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? 'GET', path: u.pathname, search: u.search });
    if (u.hostname === 'oidc.example') return json({ value: 'github-id-token' });
    if (u.hostname === 'api.github.com') return json([{ sha: `${tag(25)}0000` }, { sha: `${tag(45)}0000` }]);
    if (u.hostname === 'carelink.example') return json({ version: LIVE });
    if (u.pathname === '/login/oauth/token') {
      assert.equal(init.body.get('team_id_or_slug'), 'team_test');
      assert.equal(init.body.get('subject_token'), 'github-id-token');
      return json({ access_token: 'vercel-short-token' });
    }
    if (u.pathname === '/login/oauth/token/revoke') return json({});
    assert.equal(init.headers.Authorization, 'Bearer vercel-short-token');
    if (init.method === 'DELETE') return json({}, u.pathname.endsWith(`/${failDeleteOf}`) ? 500 : 202);
    const cursor = u.searchParams.get('cursor');
    return json(cursor ? { images: images.slice(30) } : { images: images.slice(0, 30), nextCursor: 'p2' });
  };
  return { calls, fetchImpl };
}

const env = {
  VERCEL_TEAM_ID: 'team_test', VERCEL_PROJECT: 'carelink', VCR_REPOSITORY: 'dockerfile', PRODUCTION_URL: 'https://carelink.example',
  GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'gh', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'req',
};

test('全ページを読み、選んだものだけを削除し、最後にトークンを失効させる', async () => {
  const { calls, fetchImpl } = fakeApi();
  const logs = [];
  const result = await pruneVcrImages({ env, fetchImpl, now: NOW, log: (line) => logs.push(line) });
  assert.deepEqual(result, { total: 50, deleted: 27, planned: 27 });
  const deleted = calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('/').pop());
  assert.ok(!deleted.includes('image_25') && !deleted.includes('image_30') && !deleted.includes('image_45'));
  assert.ok(calls.every((c) => c.method !== 'DELETE' || c.search.includes('projectId=carelink') && c.search.includes('teamId=team_test')));
  assert.equal(calls.at(-1).path, '/login/oauth/token/revoke');
  assert.ok(logs.includes('::add-mask::vercel-short-token'));
});

test('確認のみでは何も削除しない', async () => {
  const { calls, fetchImpl } = fakeApi();
  const result = await pruneVcrImages({ env: { ...env, DRY_RUN: 'true' }, fetchImpl, now: NOW, log: () => {} });
  assert.deepEqual(result, { total: 50, deleted: 0, planned: 27 });
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0);
});

test('削除が失敗したら失敗として止まり、それでもトークンは失効させる', async () => {
  const { calls, fetchImpl } = fakeApi({ failDeleteOf: 'image_20' });
  await assert.rejects(pruneVcrImages({ env, fetchImpl, now: NOW, log: () => {} }), /image_20 の削除が失敗/);
  assert.equal(calls.at(-1).path, '/login/oauth/token/revoke');
});

test('設定や OIDC 権限が無ければ、Vercel へ何も送らずに止まる', async () => {
  const { calls, fetchImpl } = fakeApi();
  await assert.rejects(pruneVcrImages({ env: { ...env, VERCEL_TEAM_ID: 'jimuin' }, fetchImpl, now: NOW }), /VERCEL_TEAM_ID/);
  await assert.rejects(pruneVcrImages({ env: { ...env, ACTIONS_ID_TOKEN_REQUEST_URL: '' }, fetchImpl, now: NOW }), /id-token: write/);
  assert.ok(calls.every((c) => !c.path.startsWith('/v1/vcr') && c.path !== '/login/oauth/token'));
});
