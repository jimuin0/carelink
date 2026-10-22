/** @jest-environment jsdom */
// 複数店舗のオーナー（2026年10月22日）。Q&A・回数券・月額プラン・カタログ／ブログの新規作成・求人の新規作成・
// 会計連携・QRコードは、以前 facility_members を .limit(1).single() で 1 行だけ読み（または店舗を送らず）、
// 2 店舗目を扱えなかった。口コミ・問い合わせと同じく ?facility_id= で店舗を選び、選んだ店舗だけを読み書きする。
// 店舗の選択（所属の確認）は本物の loadAdminFacilitySelection を通し、Supabase とネットワークだけを差し替える。
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import QaPage from '../qa/page';
import PackagesPage from '../packages/page';
import SubscriptionPlansPage from '../subscription-plans/page';
import NewCatalogPage from '../catalog/new/page';
import NewBlogPage from '../blog/new/page';
import NewJobPage from '../jobs/new/page';
import AccountingPage from '../accounting/page';
import QrCodePage from '../qrcode/page';

const A = 'aa820000-0000-4000-8000-000000000001';
const B = 'aa820000-0000-4000-8000-000000000002';
const FOREIGN = 'aa820000-0000-4000-8000-000000000099';
let mockQuery = '';
const mockRouter = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn() };
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(mockQuery), useRouter: () => mockRouter }));
jest.mock('qrcode', () => ({ __esModule: true, default: { toDataURL: async (url: string) => `data:image/png;base64,${encodeURIComponent(url)}` } }));
// 求人フォームの入力検証は JobForm 側の責務。ここでは送信時に店舗が付くことだけを見る。
jest.mock('@/components/admin/JobForm', () => ({
  __esModule: true,
  default: ({ onSubmit }: { onSubmit: (values: Record<string, unknown>) => void }) => (
    <button type="button" onClick={() => onSubmit({ title: '合成求人', job_type: 'ネイリスト', employment_type: '正社員' })}>求人を作成</button>
  ),
}));

type Read = { table: string; eq: [string, unknown][] };
const reads: Read[] = [];
let membershipError: unknown = null;
const twoStores = [{ facility_id: A, facility_profiles: { name: '合成店舗A' } }, { facility_id: B, facility_profiles: { name: '合成店舗B' } }];
let memberships = twoStores;
const auth = jest.fn();
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: () => auth() },
    from: (table: string) => {
      const read: Read = { table, eq: [] };
      reads.push(read);
      const id = () => read.eq.find(([key]) => key === 'id' || key === 'facility_id')?.[1];
      const result = () => {
        if (table === 'facility_members') {
          return { data: memberships, error: membershipError };
        }
        if (table === 'facility_qa') {
          return { data: [{ id: 'aa820000-0000-4000-8000-0000000000a1', facility_id: id(), question: `質問-${id()}`, answer: null, status: 'pending', is_public: false, created_at: '2026-10-20T00:00:00Z' }], error: null };
        }
        if (table === 'facility_profiles') return { data: { slug: id() === B ? 'store-b' : 'store-a', name: id() === B ? '合成店舗B' : '合成店舗A' }, error: null };
        return { data: [], error: null };
      };
      const chain: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
        single: () => Promise.resolve(result()),
        maybeSingle: () => Promise.resolve(result()),
      };
      for (const method of ['select', 'in', 'order', 'limit']) chain[method] = () => chain;
      chain.eq = (key: string, value: unknown) => { read.eq.push([key, value]); return chain; };
      return chain;
    },
  }),
}));

const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), 'https://carelink.example.invalid');
  const body = init?.method ? { ok: true } : url.pathname.endsWith('packages') ? { packages: [], user_packages: [] }
    : { plans: [], subscriptions: [] };
  return { ok: true, status: init?.method ? 201 : 200, json: async () => body } as Response;
});
const dataReads = () => reads.filter(read => read.table !== 'facility_members');

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery = '';
  membershipError = null;
  memberships = twoStores;
  reads.length = 0;
  auth.mockResolvedValue({ data: { user: { id: 'synthetic-owner' } }, error: null });
  global.fetch = fetchMock as unknown as typeof fetch;
});

const pages: [string, ComponentType, string][] = [
  ['Q&A', QaPage, '/admin/qa'],
  ['回数券', PackagesPage, '/admin/packages'],
  ['月額プラン', SubscriptionPlansPage, '/admin/subscription-plans'],
  ['カタログ新規', NewCatalogPage, '/admin/catalog/new'],
  ['ブログ新規', NewBlogPage, '/admin/blog/new'],
  ['求人新規', NewJobPage, '/admin/jobs/new'],
  ['会計連携', AccountingPage, '/admin/accounting'],
  ['QRコード', QrCodePage, '/admin/qrcode'],
];

test.each(pages)('%s: two stores and no selection ask for a store before reading or writing anything', async (_name, Page, path) => {
  render(<Page />);
  await screen.findByText('編集する店舗を選択してください');
  expect(screen.getByRole('link', { name: '合成店舗A' }).getAttribute('href')).toBe(`${path}?facility_id=${A}`);
  expect(screen.getByRole('link', { name: '合成店舗B' }).getAttribute('href')).toBe(`${path}?facility_id=${B}`);
  expect(dataReads()).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox')).toBeNull();
});

test.each(pages)('%s: a store the owner does not manage is refused, never replaced by another store', async (_name, Page) => {
  mockQuery = `facility_id=${FOREIGN}`;
  render(<Page />);
  await screen.findByRole('alert');
  expect(dataReads()).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox')).toBeNull();
});

test.each(pages)('%s: an unconfirmed membership read shows an error instead of a store', async (_name, Page) => {
  membershipError = { code: '08006' };
  mockQuery = `facility_id=${B}`;
  render(<Page />);
  await screen.findByRole('alert');
  expect(dataReads()).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each(pages)('%s: a session that cannot be confirmed shows an error and reads nothing', async (_name, Page) => {
  auth.mockResolvedValue({ data: { user: { id: 'synthetic-owner' } }, error: { status: 503 } });
  mockQuery = `facility_id=${B}`;
  render(<Page />);
  await screen.findByRole('alert');
  expect(reads).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each(pages)('%s: the selected store is shown as selected', async (_name, Page) => {
  mockQuery = `facility_id=${B}`;
  render(<Page />);
  const current = await screen.findByRole('link', { name: '合成店舗B（選択中）' });
  expect(current.getAttribute('aria-current')).toBe('page');
});

const urls = () => fetchMock.mock.calls.map(([input]) => String(input));

test('Q&A reads and answers the selected second store', async () => {
  mockQuery = `facility_id=${B}`;
  render(<QaPage />);
  await screen.findByText(`質問-${B}`);
  expect(reads.find(read => read.table === 'facility_qa')?.eq).toEqual([['facility_id', B]]);
  fireEvent.click(screen.getByRole('button', { name: '回答する' }));
  fireEvent.change(screen.getByLabelText(/回答/, { selector: 'textarea' }), { target: { value: '合成の回答です' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '回答を送信' })); });
  expect(urls()).toContain(`/api/admin/qa?facility_id=${B}`);
  expect(urls().every(url => url.includes(`facility_id=${B}`))).toBe(true);
});

test('回数券 lists and creates for the selected second store', async () => {
  mockQuery = `facility_id=${B}`;
  render(<PackagesPage />);
  await screen.findByRole('heading', { name: '回数券・パッケージ管理' });
  expect(urls()).toEqual(expect.arrayContaining([`/api/admin/packages?facility_id=${B}`, `/api/admin/user-packages?facility_id=${B}`]));
  expect(reads.find(read => read.table === 'facility_menus')?.eq).toEqual([['facility_id', B]]);
  fireEvent.click(screen.getByRole('button', { name: '+ 新規作成' }));
  fireEvent.change(screen.getByLabelText(/名前/), { target: { value: '合成5回券' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '作成' })); });
  expect(fetchMock).toHaveBeenCalledWith(`/api/admin/packages?facility_id=${B}`, expect.objectContaining({ method: 'POST' }));
  expect(urls().every(url => url.includes(`facility_id=${B}`))).toBe(true);
});

test('月額プラン lists and creates for the selected second store', async () => {
  mockQuery = `facility_id=${B}`;
  render(<SubscriptionPlansPage />);
  await screen.findByRole('heading', { name: '月額プラン' });
  expect(urls()).toEqual(expect.arrayContaining([`/api/admin/subscription-plans?facility_id=${B}`, `/api/admin/user-subscriptions?facility_id=${B}`]));
  fireEvent.click(screen.getByRole('button', { name: '+ 新規プラン' }));
  fireEvent.change(screen.getByLabelText(/プラン名/), { target: { value: '合成月額プラン' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '作成' })); });
  expect(fetchMock).toHaveBeenCalledWith(`/api/admin/subscription-plans?facility_id=${B}`, expect.objectContaining({ method: 'POST' }));
  expect(urls().every(url => url.includes(`facility_id=${B}`))).toBe(true);
});

test('カタログ新規 creates in the selected store and returns to that store’s list', async () => {
  mockQuery = `facility_id=${B}`;
  render(<NewCatalogPage />);
  fireEvent.change(await screen.findByLabelText(/タイトル/), { target: { value: '合成カタログ' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'カタログを追加' })); });
  expect(fetchMock).toHaveBeenCalledWith(`/api/admin/catalog?facility_id=${B}`, expect.objectContaining({ method: 'POST' }));
  expect(mockRouter.push).toHaveBeenCalledWith(`/admin/catalog?facility_id=${B}`);
  // 作成時に所属を読み直して別の店舗へ送ることはない（以前は押下時に role を絞らず 1 行だけ読んでいた）
  expect(reads.filter(read => read.table === 'facility_members')).toHaveLength(1);
});

test('ブログ新規 publishes to the selected store, not the first membership', async () => {
  mockQuery = `facility_id=${B}`;
  render(<NewBlogPage />);
  fireEvent.change(await screen.findByLabelText(/タイトル/), { target: { value: '合成記事' } });
  fireEvent.change(screen.getByLabelText(/本文/), { target: { value: '合成の本文です' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '記事を作成' })); });
  expect(fetchMock).toHaveBeenCalledWith(`/api/admin/blog?facility_id=${B}`, expect.objectContaining({ method: 'POST' }));
  expect(mockRouter.push).toHaveBeenCalledWith(`/admin/blog?facility_id=${B}`);
  expect(reads.filter(read => read.table === 'facility_members')).toHaveLength(1);
});

test('ブログ新規 network failure is reported and the button is usable again', async () => {
  mockQuery = `facility_id=${B}`;
  fetchMock.mockRejectedValueOnce(new Error('synthetic network failure'));
  render(<NewBlogPage />);
  fireEvent.change(await screen.findByLabelText(/タイトル/), { target: { value: '合成記事' } });
  fireEvent.change(screen.getByLabelText(/本文/), { target: { value: '合成の本文です' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '記事を作成' })); });
  await screen.findByText('通信エラーが発生しました');
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: '記事を作成' }) as HTMLButtonElement).disabled).toBe(false);
});

test('求人新規 sends the selected store so a multi-store owner can create a vacancy', async () => {
  mockQuery = `facility_id=${B}`;
  render(<NewJobPage />);
  const submit = await screen.findByRole('button', { name: '求人を作成' });
  await act(async () => { fireEvent.click(submit); });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/admin/jobs');
  expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({ title: '合成求人', facility_id: B }));
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/admin/jobs'));
});

test('会計連携 exports the selected store', async () => {
  mockQuery = `facility_id=${B}`;
  const clicked: string[] = [];
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.getAttribute('href') ?? ''); });
  try {
    render(<AccountingPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'CSVをダウンロード' }));
    expect(clicked).toHaveLength(1);
    expect(new URL(clicked[0], 'https://carelink.example.invalid').searchParams.get('facility_id')).toBe(B);
  } finally {
    click.mockRestore();
  }
});

test('QRコード encodes the selected store’s public page', async () => {
  mockQuery = `facility_id=${B}`;
  render(<QrCodePage />);
  expect((await screen.findAllByText('https://carelink-jp.com/facility/store-b')).length).toBeGreaterThan(0);
  expect(reads.find(read => read.table === 'facility_profiles')?.eq).toEqual([['id', B]]);
  expect(screen.queryByText(/facility\/store-a/)).toBeNull();
});

test('a single store is selected automatically without a query', async () => {
  // 1 店舗だけのオーナーは従来どおり選択なしで使える（読み込みは自分の店舗に限られる）。
  memberships = [{ facility_id: A, facility_profiles: { name: '合成店舗A' } }];
  render(<QaPage />);
  await screen.findByText(`質問-${A}`);
  expect(reads.find(read => read.table === 'facility_qa')?.eq).toEqual([['facility_id', A]]);
  expect(screen.getByRole('link', { name: '合成店舗A（選択中）' })).toBeTruthy();
});
