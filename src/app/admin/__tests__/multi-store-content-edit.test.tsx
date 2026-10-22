/** @jest-environment jsdom */
// 既存のブログ記事・カタログを編集するときは、その行自身の店舗を使う（2026年10月22日）。
// 以前のブログ編集は facility_members を role も絞らず .limit(1).single() で 1 行だけ読み、その店舗の記事として
// しか開けなかった（2 店舗目の記事は「読み込みに失敗」）。カタログ編集は所属を確かめずにフォームを出していた。
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import EditBlogPage from '../blog/[id]/edit/page';
import EditCatalogPage from '../catalog/[id]/edit/page';

const A = 'aa830000-0000-4000-8000-000000000001';
const B = 'aa830000-0000-4000-8000-000000000002';
const FOREIGN = 'aa830000-0000-4000-8000-000000000099';
const ROW = 'aa830000-0000-4000-8000-0000000000b1';
let mockQuery = '';
const mockRouter = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn() };
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockQuery),
  useRouter: () => mockRouter,
  useParams: () => ({ id: 'aa830000-0000-4000-8000-0000000000b1' }),
}));

const twoStores = [{ facility_id: A, facility_profiles: { name: '合成店舗A' } }, { facility_id: B, facility_profiles: { name: '合成店舗B' } }];
let memberships = twoStores;
let rowFacility = B;
const tables: string[] = [];
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'synthetic-owner' } }, error: null }) },
    from: (table: string) => {
      tables.push(table);
      const result = () => {
        if (table === 'facility_members') return { data: memberships, error: null };
        if (table === 'blog_posts') return { data: { id: ROW, facility_id: rowFacility, title: '合成記事', content: '合成の本文', is_published: false }, error: null };
        return { data: { facility_id: rowFacility, title: '合成カタログ', description: null, tags: ['合成'] }, error: null };
      };
      const chain: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
        maybeSingle: () => Promise.resolve(result()),
      };
      for (const method of ['select', 'eq', 'in', 'order', 'limit']) chain[method] = () => chain;
      return chain;
    },
  }),
}));

const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as unknown as Response);
beforeEach(() => {
  jest.clearAllMocks();
  mockQuery = '';
  memberships = twoStores;
  rowFacility = B;
  tables.length = 0;
  global.fetch = fetchMock as unknown as typeof fetch;
});

const pages: [string, ComponentType, string, string][] = [
  ['blog', EditBlogPage, '合成記事', '/admin/blog'],
  ['catalog', EditCatalogPage, '合成カタログ', '/admin/catalog'],
];

test.each(pages)('%s: a row of the second store opens for that store', async (_name, Page, title) => {
  mockQuery = `facility_id=${B}`;
  render(<Page />);
  expect(await screen.findByDisplayValue(title)).toBeTruthy();
  expect(screen.getByRole('link', { name: '合成店舗B（選択中）' }).getAttribute('aria-current')).toBe('page');
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test.each(pages)('%s: without a store in the URL, a multi-store owner is moved to the row’s own store', async (_name, Page, title, list) => {
  render(<Page />);
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith(`${list}/${ROW}/edit?facility_id=${B}`));
  expect(screen.queryByDisplayValue(title)).toBeNull();
});

test.each(pages)('%s: a single-store owner opens the row without a store in the URL', async (_name, Page, title) => {
  memberships = [twoStores[1]];
  render(<Page />);
  expect(await screen.findByDisplayValue(title)).toBeTruthy();
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test.each(pages)('%s: a URL naming a different store than the row is refused (no form to save into the wrong store)', async (_name, Page, title) => {
  mockQuery = `facility_id=${A}`;
  render(<Page />);
  await screen.findByRole('alert');
  expect(screen.queryByDisplayValue(title)).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each(pages)('%s: a row of a store the user does not manage is refused', async (_name, Page, title) => {
  rowFacility = FOREIGN;
  render(<Page />);
  await screen.findByRole('alert');
  expect(screen.queryByDisplayValue(title)).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('blog: saving and deleting use the row’s store and return to that store’s list', async () => {
  jest.useFakeTimers();
  try {
    mockQuery = `facility_id=${B}`;
    render(<EditBlogPage />);
    await screen.findByDisplayValue('合成記事');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存する' })); });
    expect(fetchMock).toHaveBeenCalledWith(`/api/admin/blog/${ROW}?facility_id=${B}`, expect.objectContaining({ method: 'PATCH' }));
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(mockRouter.push).toHaveBeenCalledWith(`/admin/blog?facility_id=${B}`);
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '削除する' })); });
    expect(fetchMock).toHaveBeenCalledWith(`/api/admin/blog/${ROW}?facility_id=${B}`, { method: 'DELETE' });
  } finally {
    jest.useRealTimers();
  }
});

test('catalog: saving returns to the row’s store list; the API resolves the store from the row', async () => {
  mockQuery = `facility_id=${B}`;
  render(<EditCatalogPage />);
  await screen.findByDisplayValue('合成カタログ');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '更新する' })); });
  expect(fetchMock).toHaveBeenCalledWith(`/api/admin/catalog/${ROW}`, expect.objectContaining({ method: 'PATCH' }));
  expect(mockRouter.push).toHaveBeenCalledWith(`/admin/catalog?facility_id=${B}`);
});

test('catalog: a network failure while saving is reported and nothing navigates', async () => {
  mockQuery = `facility_id=${B}`;
  fetchMock.mockRejectedValueOnce(new Error('synthetic network failure'));
  render(<EditCatalogPage />);
  await screen.findByDisplayValue('合成カタログ');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '更新する' })); });
  await screen.findByText('通信エラーが発生しました');
  expect(mockRouter.push).not.toHaveBeenCalled();
});
