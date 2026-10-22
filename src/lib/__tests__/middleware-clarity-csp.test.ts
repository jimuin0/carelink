/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Microsoft Clarity の送信先が CSP の connect-src で許可されていることを固定する（2026年10月22日 新設）。
 *
 * 【なぜ必要か】clarity.js は録画・ヒートマップを XMLHttpRequest / sendBeacon で
 * https://<英字1文字>.clarity.ms/collect（u.clarity.ms・g.clarity.ms・j.clarity.ms 等）へ送る。
 * connect-src に Clarity は https://www.clarity.ms しか無く、送信がすべて CSP で拒否されていた。
 * Microsoft は負荷分散で [a-z].clarity.ms を使い分けると明記しているため、個別ホストではなく
 * https://*.clarity.ms を許可する。
 *
 * ここでは CSP のホスト照合（ワイルドカードはサブドメインにだけ一致し、上位ドメインや
 * 似た名前の別ドメインには一致しない）を実装し、実際に返る CSP に対して確かめる。
 *
 * 負の対照: middleware.ts から `https://*.clarity.ms` を外して実行し、
 * 「送信先がすべて許可される」検査が赤くなることを確認した（報告参照）。
 */
jest.mock('next/server', () => ({
  NextResponse: {
    next: () => ({ cookies: { set: () => undefined, getAll: () => [] }, headers: new Headers() }),
    redirect: () => ({ cookies: { set: () => undefined, getAll: () => [] }, headers: new Headers() }),
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200, headers: new Headers() }),
  },
}));
jest.mock('@supabase/ssr', () => ({ createServerClient: () => { throw new Error('public pages must not create an auth client'); } }));

import { middleware } from '../../middleware';

function publicRequest(path: string) {
  const url = new URL('https://carelink-jp.com' + path) as URL & { clone: () => URL };
  url.clone = () => new URL(url.toString());
  return { nextUrl: url, headers: new Headers(), cookies: { get: () => undefined, getAll: () => [], set: () => undefined } } as never;
}

async function directive(name: string): Promise<string[]> {
  const res = (await middleware(publicRequest('/search'))) as unknown as { headers: Headers };
  const csp = res.headers.get('content-security-policy')!;
  const found = csp.split(';').map((d) => d.trim()).find((d) => d.split(/\s+/)[0] === name);
  expect(found).toBeTruthy();
  return found!.split(/\s+/).slice(1);
}

/** CSP3 の host-source 照合（https のみ・ポート/パス無しの形だけを扱う）。 */
function allowedBy(sources: string[], url: string): boolean {
  const target = new URL(url);
  return sources.some((source) => {
    const m = /^https:\/\/(\*\.)?([a-z0-9.-]+)$/.exec(source);
    if (!m || target.protocol !== 'https:') return false;
    const [, wildcard, host] = m;
    return wildcard ? target.hostname.endsWith('.' + host) : target.hostname === host;
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});

test('Clarity の送信先（[a-z].clarity.ms/collect と www.clarity.ms）はすべて connect-src で許可される', async () => {
  const connect = await directive('connect-src');
  for (const url of [
    'https://u.clarity.ms/collect',
    'https://g.clarity.ms/collect',
    'https://j.clarity.ms/collect',
    'https://a.clarity.ms/collect',
    'https://z.clarity.ms/collect',
    'https://www.clarity.ms/tag/abc123',
  ]) {
    expect({ url, allowed: allowedBy(connect, url) }).toEqual({ url, allowed: true });
  }
});

test('許可は clarity.ms のサブドメインに限る（似た名前の別ドメイン・http は許可しない）', async () => {
  const connect = await directive('connect-src');
  for (const url of ['https://clarity.ms.evil.example/collect', 'https://evilclarity.ms/collect', 'http://u.clarity.ms/collect']) {
    expect({ url, allowed: allowedBy(connect, url) }).toEqual({ url, allowed: false });
  }
  // Clarity 関連で connect-src に載せているのはこの 2 つだけ。
  expect(connect.filter((s) => s.includes('clarity'))).toEqual(['https://www.clarity.ms', 'https://*.clarity.ms']);
});

test('script-src は変えていない（nonce＋strict-dynamic のまま）', async () => {
  const script = await directive('script-src');
  expect(script.filter((v) => !v.startsWith("'nonce-"))).toEqual([
    "'self'", "'strict-dynamic'", 'https://www.googletagmanager.com', 'https://www.google-analytics.com', 'https://www.clarity.ms', 'https://va.vercel-scripts.com',
  ]);
  expect(script.some((v) => /^'nonce-[0-9a-f]{32}'$/.test(v))).toBe(true);
  expect(script).not.toContain("'unsafe-inline'");
});
