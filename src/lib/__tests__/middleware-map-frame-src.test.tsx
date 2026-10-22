/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 施設ページ「アクセス」タブの Google マップ埋め込みが、middleware の CSP `frame-src` で
 * 許可されていることを固定する（2026年10月22日 新設）。
 *
 * 【なぜ必要か】AccessInfo.tsx は https://maps.google.com/maps?…&output=embed を iframe で
 * 出していたが、CSP の frame-src は 'self' と YouTube の 2 ホストだけだった。ブラウザは
 * 地図の iframe を拒否し、本番の全施設で地図枠が空白のままだった（どのテストも frame-src を
 * 見ていなかった）。ここでは「実際に描画される iframe の URL」と「実際に返る CSP」を
 * 突き合わせるので、どちらか片方だけ変わっても落ちる。
 *
 * 負の対照: middleware.ts の frame-src を修正前の文字列に戻して実行し、
 * 「iframe のオリジンが frame-src に含まれる」検査が実際に赤くなることを確認した（報告参照）。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import AccessInfo from '@/components/facility/AccessInfo';
import type { Facility } from '@/types';
import { GOOGLE_MAPS_EMBED_ORIGIN, GOOGLE_MAPS_EMBED_REFERRER_POLICY, googleMapsEmbedUrl } from '../map-embed';
import { readFileSync } from 'fs';
import { join } from 'path';

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

function directives(csp: string): Map<string, string[]> {
  return new Map(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...values] = d.split(/\s+/);
    return [name!, values];
  }));
}

async function facilityPageCsp(): Promise<Map<string, string[]>> {
  const res = (await middleware(publicRequest('/facility/synthetic-facility'))) as unknown as { headers: Headers };
  const csp = res.headers.get('content-security-policy');
  expect(csp).toBeTruthy();
  return directives(csp!);
}

const FACILITY = {
  id: 'f1', name: '検証サロン', slug: 'synthetic-facility', prefecture: '大阪府', city: '豊中市', address: '1-2-3',
  building: null, latitude: 34.7832, longitude: 135.4688, features: [], business_hours: null, phone: null,
} as unknown as Facility;

function iframeSrcs(markup: string): string[] {
  return [...markup.matchAll(/<iframe[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});

test('施設ページの CSP は地図埋め込みのオリジンだけを frame-src に足している', async () => {
  const csp = await facilityPageCsp();
  expect(csp.get('frame-src')).toEqual(["'self'", 'https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://www.google.com']);
  expect(GOOGLE_MAPS_EMBED_ORIGIN).toBe('https://www.google.com');
});

test('アクセスタブの地図 iframe（緯度経度あり・住所のみ）は frame-src で許可されたオリジンを指す', async () => {
  const allowed = (await facilityPageCsp()).get('frame-src')!;
  const withCoords = iframeSrcs(renderToStaticMarkup(<AccessInfo facility={FACILITY} />));
  const addressOnly = iframeSrcs(renderToStaticMarkup(<AccessInfo facility={{ ...FACILITY, latitude: null, longitude: null } as unknown as Facility} />));
  // 空振り防止: 地図の iframe が実際に 1 つずつ描画されていること。
  expect(withCoords).toHaveLength(1);
  expect(addressOnly).toHaveLength(1);
  for (const src of [...withCoords, ...addressOnly]) {
    const origin = new URL(src).origin;
    expect(allowed).toContain(origin);
    expect(new URL(src).searchParams.get('output')).toBe('embed');
  }
  expect(withCoords[0]).toBe(googleMapsEmbedUrl('34.7832,135.4688'));
  expect(withCoords[0]).toBe('https://www.google.com/maps?q=34.7832,135.4688&z=16&output=embed');
});

test('地図以外のディレクティブは変えていない（自サイトの被埋め込み禁止を含む）', async () => {
  const csp = await facilityPageCsp();
  expect([...csp.keys()]).toEqual([
    'default-src', 'script-src', 'style-src', 'font-src', 'img-src', 'connect-src', 'worker-src',
    'manifest-src', 'frame-src', 'frame-ancestors', 'object-src', 'base-uri', 'form-action',
  ]);
  expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
  expect(csp.get('default-src')).toEqual(["'self'"]);
  expect(csp.get('object-src')).toEqual(["'none'"]);
  expect(csp.get('script-src')!.filter((v) => !v.startsWith("'nonce-"))).toEqual([
    "'self'", "'strict-dynamic'", 'https://www.googletagmanager.com', 'https://www.google-analytics.com', 'https://www.clarity.ms', 'https://va.vercel-scripts.com',
  ]);
  expect(csp.get('connect-src')).toEqual([
    "'self'", 'https://test.supabase.co', 'wss://test.supabase.co', 'https://*.google-analytics.com', 'https://www.clarity.ms',
    'https://va.vercel-scripts.com', 'https://vitals.vercel-insights.com', 'https://access.line.me', 'https://api.line.me', 'https://zipcloud.ibsnet.co.jp',
  ]);
});

// 地図が表示されるようになると、閲覧者の情報が Google へ送られる。Referer はオリジンまでに絞り
// （旧設定 no-referrer-when-downgrade はページの完全な URL を送っていた）、プライバシーポリシーに明記する。
test('地図 iframe は Referer をオリジンまでに絞り、外部送信をプライバシーポリシーに書いている', () => {
  const markup = renderToStaticMarkup(<AccessInfo facility={FACILITY} />);
  const policies = [...markup.matchAll(/<iframe[^>]*\sreferrerPolicy="([^"]+)"/gi)].map((m) => m[1]);
  expect(GOOGLE_MAPS_EMBED_REFERRER_POLICY).toBe('strict-origin-when-cross-origin');
  expect(policies).toEqual(['strict-origin-when-cross-origin']);
  const privacy = readFileSync(join(process.cwd(), 'src/app/privacy/page.tsx'), 'utf8');
  expect(privacy).toContain('<li>Google マップ（Google LLC）：施設ページの地図表示');
});

// 負の対照（判定ロジック自体の確認）: 修正前の iframe URL は修正後の frame-src でも許可されない
// ＝「どのホストでも通る」緩い判定になっていないこと。
test('旧 URL（maps.google.com）は許可対象に含まれない', async () => {
  const allowed = (await facilityPageCsp()).get('frame-src')!;
  expect(allowed).not.toContain(new URL('https://maps.google.com/maps?q=1,2&z=16&output=embed').origin);
});
