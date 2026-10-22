/** @jest-environment node */
// 複数店舗のオーナー（2026年10月22日）。ブログ一覧・カタログ一覧・ファネル・利用状況は、以前 facility_members を
// .limit(1) で 1 行だけ読み、ヘッダーは「店舗未選択」なのに任意の 1 店舗のデータを出していた。
// ?facility_id= で店舗を選び、所属（owner/admin）を確かめた店舗だけを読む。選択の判定は本物の
// loadAdminFacilitySelection を通し、Supabase だけを差し替える。
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import Blog from '../blog/page';
import Catalog from '../catalog/page';
import Funnel from '../funnel/page';
import Usage from '../usage-stats/page';

const A = 'aa840000-0000-4000-8000-000000000001';
const B = 'aa840000-0000-4000-8000-000000000002';
const FOREIGN = 'aa840000-0000-4000-8000-000000000099';
const ROW = 'aa840000-0000-4000-8000-0000000000c1';
type Read = { client: 'auth' | 'service'; table: string; eq: [string, unknown][] };
const reads: Read[] = [];
let memberships = [{ facility_id: A, facility_profiles: { name: '合成店舗A' } }, { facility_id: B, facility_profiles: { name: '合成店舗B' } }];
function client(kind: Read['client']) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'synthetic-owner' } }, error: null }) },
    from: (table: string) => {
      const read: Read = { client: kind, table, eq: [] };
      reads.push(read);
      const facility = () => read.eq.find(([key]) => key === 'facility_id')?.[1];
      const data = () => {
        if (table === 'facility_members') return memberships;
        if (table === 'blog_posts') return [{ id: ROW, facility_id: facility(), title: `記事-${facility()}`, content: '', is_published: true, created_at: '2026-10-20T00:00:00Z' }];
        if (table === 'treatment_catalogs') return [{ id: ROW, facility_id: facility(), title: `カタログ-${facility()}`, description: null, tags: [], created_at: '2026-10-20T00:00:00Z' }];
        return [];
      };
      const chain: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: data(), count: 0, error: null }).then(resolve, reject),
      };
      for (const method of ['select', 'in', 'order', 'limit', 'gte']) chain[method] = () => chain;
      chain.eq = (key: string, value: unknown) => { read.eq.push([key, value]); return chain; };
      return chain;
    },
  };
}
const mockService = jest.fn(() => client('service'));
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: async () => client('auth') }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => mockService() }));
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn(), safeJsonLd: JSON.stringify }));

beforeEach(() => {
  jest.clearAllMocks();
  reads.length = 0;
  memberships = [{ facility_id: A, facility_profiles: { name: '合成店舗A' } }, { facility_id: B, facility_profiles: { name: '合成店舗B' } }];
});
const props = (facility_id?: string) => ({ searchParams: Promise.resolve(facility_id === undefined ? {} : { facility_id }) });
const dataReads = () => reads.filter(read => read.table !== 'facility_members');
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1].replace(/&amp;/g, '&'));

const pages: [string, (p: ReturnType<typeof props>) => Promise<ReactElement>, string][] = [
  ['blog', Blog, '/admin/blog'],
  ['catalog', Catalog, '/admin/catalog'],
  ['funnel', Funnel, '/admin/funnel'],
  ['usage-stats', Usage, '/admin/usage-stats'],
];

test.each(pages)('%s: two stores and no selection ask for a store and read no store data', async (_name, Page, path) => {
  const html = renderToStaticMarkup(await Page(props()));
  expect(html).toContain('編集する店舗を選択してください');
  expect(hrefs(html)).toEqual(expect.arrayContaining([`${path}?facility_id=${A}`, `${path}?facility_id=${B}`]));
  expect(dataReads()).toEqual([]);
  expect(mockService).not.toHaveBeenCalled();
});

test.each(pages)('%s: the selected second store is the only store read', async (_name, Page) => {
  const html = renderToStaticMarkup(await Page(props(B)));
  expect(html).toContain('合成店舗B（選択中）');
  expect(dataReads().length).toBeGreaterThan(0);
  for (const read of dataReads()) expect(read.eq).toContainEqual(['facility_id', B]);
  expect(dataReads().some(read => read.eq.some(([, value]) => value === A))).toBe(false);
});

test.each(pages)('%s: a store the owner does not manage is refused without reading data', async (_name, Page) => {
  await expect(Page(props(FOREIGN))).rejects.toThrow('unauthorized_facility_selection');
  expect(dataReads()).toEqual([]);
  expect(mockService).not.toHaveBeenCalled();
});

test.each(pages)('%s: a single store is used without a query, as before', async (_name, Page) => {
  memberships = [memberships[0]];
  const html = renderToStaticMarkup(await Page(props()));
  expect(html).not.toContain('編集する店舗を選択してください');
  for (const read of dataReads()) expect(read.eq).toContainEqual(['facility_id', A]);
});

test.each([['blog', Blog, '/admin/blog', '記事'], ['catalog', Catalog, '/admin/catalog', 'カタログ']] as const)(
  '%s list links keep the selected store for creating and editing', async (_name, Page, path, label) => {
    const html = renderToStaticMarkup(await Page(props(B)));
    expect(html).toContain(`${label}-${B}`);
    expect(hrefs(html)).toEqual(expect.arrayContaining([`${path}/new?facility_id=${B}`, `${path}/${ROW}/edit?facility_id=${B}`]));
  });

test('usage-stats link to the analytics dashboard keeps the selected store', async () => {
  const html = renderToStaticMarkup(await Usage(props(B)));
  expect(hrefs(html)).toContain(`/admin/analytics?facility_id=${B}`);
});
