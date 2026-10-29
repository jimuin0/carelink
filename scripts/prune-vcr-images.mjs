// Vercel Container Registry の古い配信イメージを整理する。
//
// 背景（2026年10月28日 実測）: Hobby は 1 リポジトリあたり 50 イメージが上限で、
// 配信のたびに `dockerfile` リポジトリへ 1 個ずつ積まれる（1日 約10個）。上限に達すると
// ビルドは通るのに push が `repository has reached the maximum allowed number of images`
// で拒否され、本番へ何も出せなくなった（課金ではなく上限）。
//
// 残すもの: 直近 KEEP_NEWEST 個・作成から MIN_AGE_HOURS 未満・稼働中の本番の版・
// 直近 PROTECT_PRODUCTION_DEPLOYMENTS 回分の本番配信。どれか 1 つでも確認できなければ
// 何も消さずに失敗する（本番やロールバック先を誤って消さないため）。
import { pathToFileURL } from 'node:url';

export const KEEP_NEWEST = 20;
export const MIN_AGE_HOURS = 24;
export const PROTECT_PRODUCTION_DEPLOYMENTS = 10;

const VERCEL_API = 'https://api.vercel.com';
// vercel/vcr-action/login と同じ OIDC 交換用のクライアント（src/lib.ts の VCR_APP_ID）。
const VCR_APP_ID = 'cl_inrfNy8noLlhRrGbPEm0z47woXNcJVZ0';

export function selectImagesToDelete({ images, protectedTags, liveVersion, now, keepNewest = KEEP_NEWEST, minAgeHours = MIN_AGE_HOURS }) {
  if (!protectedTags.length) throw new Error('本番配信の版を取得できないため、整理を中止します');
  if (!/^[0-9a-f]{7,40}$/.test(liveVersion || '')) throw new Error('稼働中の本番の版を確認できないため、整理を中止します');
  const isProtected = (tags) => tags.some((tag) => tag.startsWith(liveVersion)
    || protectedTags.some((sha) => sha.startsWith(tag) || tag.startsWith(sha)));
  if (!images.some((image) => image.tags.some((tag) => tag.startsWith(liveVersion)))) {
    throw new Error(`稼働中の本番 ${liveVersion} のイメージが一覧に無いため、整理を中止します`);
  }
  const newestFirst = [...images].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const cutoff = now - minAgeHours * 3_600_000;
  return newestFirst.slice(keepNewest).filter((image) =>
    Date.parse(image.createdAt) < cutoff && !isProtected(image.tags));
}

async function request(fetchImpl, url, init, label) {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${label}が失敗しました（HTTP ${response.status}）`);
  return response;
}

async function exchangeToken(fetchImpl, env, team) {
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error('GitHub の OIDC トークンを取得できません（id-token: write が必要です）');
  }
  const id = await (await request(fetchImpl, env.ACTIONS_ID_TOKEN_REQUEST_URL,
    { headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } }, 'GitHub OIDC トークンの取得')).json();
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id: VCR_APP_ID,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    team_id_or_slug: team,
    subject_token: id.value,
  });
  const { access_token: token } = await (await request(fetchImpl, `${VERCEL_API}/login/oauth/token`,
    { method: 'POST', body }, 'Vercel トークンの交換（チームの VCR 用 OIDC ポリシーを確認）')).json();
  if (!token) throw new Error('Vercel トークンの交換結果にトークンがありません');
  return token;
}

async function revokeToken(fetchImpl, token, log) {
  try {
    const body = new URLSearchParams({ client_id: VCR_APP_ID, token, token_type_hint: 'access_token' });
    await request(fetchImpl, `${VERCEL_API}/login/oauth/token/revoke`, { method: 'POST', body }, 'トークンの失効');
  } catch (error) {
    log(`::warning::${error.message}（有効期限で失効します）`);
  }
}

async function listImages(fetchImpl, token, scope) {
  const images = [];
  let cursor;
  do {
    const url = new URL(`${VERCEL_API}/v1/vcr/repository/${scope.repository}/images`);
    url.search = new URLSearchParams({ projectId: scope.project, teamId: scope.team, limit: '100', ...(cursor ? { cursor } : {}) });
    const page = await (await request(fetchImpl, url, { headers: { Authorization: `Bearer ${token}` } }, 'イメージ一覧の取得')).json();
    images.push(...page.images.map((image) => ({ id: image.id, tags: image.tags, createdAt: image.createdAt })));
    cursor = page.pagination?.next;
  } while (cursor);
  return images;
}

async function productionShas(fetchImpl, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/deployments?environment=Production&per_page=${PROTECT_PRODUCTION_DEPLOYMENTS}`;
  const deployments = await (await request(fetchImpl, url,
    { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } }, '本番配信の履歴の取得')).json();
  return deployments.map((deployment) => deployment.sha.slice(0, 12));
}

async function liveProductionVersion(fetchImpl, env) {
  const health = await (await request(fetchImpl, `${env.PRODUCTION_URL}/api/health`, {}, '本番の版の確認')).json();
  return health.version;
}

export async function pruneVcrImages({ env = process.env, fetchImpl = fetch, now = Date.now(), log = console.log } = {}) {
  const scope = { team: env.VERCEL_TEAM_ID, project: env.VERCEL_PROJECT, repository: env.VCR_REPOSITORY };
  if (!scope.team?.startsWith('team_') || !scope.project || !scope.repository || !env.PRODUCTION_URL) {
    throw new Error('VERCEL_TEAM_ID・VERCEL_PROJECT・VCR_REPOSITORY・PRODUCTION_URL を設定してください');
  }
  const dryRun = env.DRY_RUN === 'true';
  const [protectedTags, liveVersion] = await Promise.all([productionShas(fetchImpl, env), liveProductionVersion(fetchImpl, env)]);
  const token = await exchangeToken(fetchImpl, env, scope.team);
  log(`::add-mask::${token}`);
  try {
    const images = await listImages(fetchImpl, token, scope);
    const targets = selectImagesToDelete({ images, protectedTags, liveVersion, now });
    log(`イメージ ${images.length} 個・本番 ${liveVersion}・削除対象 ${targets.length} 個${dryRun ? '（確認のみ）' : ''}`);
    for (const image of targets) {
      log(`${dryRun ? '削除予定' : '削除'}: ${image.id} ${image.tags.join(',') || '<タグなし>'} ${image.createdAt}`);
      if (dryRun) continue;
      const url = new URL(`${VERCEL_API}/v1/vcr/repository/${scope.repository}/images/${image.id}`);
      url.search = new URLSearchParams({ projectId: scope.project, teamId: scope.team });
      await request(fetchImpl, url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }, `${image.id} の削除`);
    }
    return { total: images.length, deleted: dryRun ? 0 : targets.length, planned: targets.length };
  } finally {
    await revokeToken(fetchImpl, token, log);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  pruneVcrImages().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
