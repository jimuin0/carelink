// After a deploy, confirm production really serves the new commit and working pages.
//
// The health status code is deliberately ignored: /api/health answers 503 when a
// dependency is down and 429 when rate limited, and neither means the deploy failed.
// Only the version in the body is compared. A matching version is not enough either
// (an error page also answers 200), so the main pages are fetched and their content
// is checked. Exits 1 on failure; the workflow then rolls the Worker back.
const BASE = 'https://carelink-jp.com';
// The repository's own error boundaries (src/app/error.tsx etc.) show 「エラーが発生しました」.
const ERROR_MARKERS = ['エラーが発生しました', 'Application error', 'Internal Server Error', 'This page could not be found'];

export const PAGES = [
  // Each marker is rendered by the page body itself, never by the shared layout or metadata.
  { path: '/', expect: '業種から探す' },
  { path: '/search', expect: 'href="/facility/' },
  { path: '/register', expect: '予約も、集客も、ひとつに。' },
];

export function pageProblem(page, status, html) {
  if (status !== 200) return `${page.path} が ${status}`;
  const marker = ERROR_MARKERS.find((m) => html.includes(m));
  if (marker) return `${page.path} にエラー表示（${marker}）`;
  if (!html.includes(page.expect)) return `${page.path} に期待する中身（${page.expect}）が無い`;
  return '';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readVersion() {
  try {
    const body = await (await fetch(`${BASE}/api/health`, { headers: { 'cache-control': 'no-cache' } })).json();
    return body.version ?? '';
  } catch {
    return '';
  }
}

async function main() {
  const want = (process.env.SHA ?? '').slice(0, 7);
  if (!/^[0-9a-f]{7}$/.test(want)) throw new Error('SHA is not a commit');
  let got = '';
  for (let i = 1; i <= 18 && got !== want; i++) {
    got = await readVersion();
    console.log(`attempt ${i}: ${got || '(読めない)'}`);
    if (got !== want) await sleep(10_000);
  }
  if (got !== want) throw new Error(`本番の version が ${want} にならない（${got || '読めない'}）`);
  const problems = [];
  for (const page of PAGES) {
    const res = await fetch(`${BASE}${page.path}`, { headers: { 'cache-control': 'no-cache' } });
    const problem = pageProblem(page, res.status, await res.text());
    if (problem) problems.push(problem);
  }
  if (problems.length) throw new Error(problems.join(' / '));
  console.log('本番の version と主要ページを確認した');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
