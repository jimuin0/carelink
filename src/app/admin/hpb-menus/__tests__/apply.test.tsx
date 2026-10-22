import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import Page from '../page';

// HPB 一括反映のメニューは非公開で作られる。以前は「メニュー編集で公開ON」と案内していたが、
// メニュー管理には公開の手段が無かった。反映後に公開の手順と行き先を示すことを固定する。
//
// 2026年10月23日:
//   - 複数店舗のオーナーは ?facility_id= で店舗を選ぶ（以前は所属の 1 行目の店舗を黙って扱っていた）
//   - 一括反映は「まだ無いメニューを作るだけ」。クーポン・HPB に無くなったもの・別の店舗IDのものは作らず、
//     既にあるメニューは変えない。そのことを反映前の説明と反映後の結果の両方で伝える。
const facility = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
let mockQuery = '';
const mockAuth = jest.fn();
const mockFrom = jest.fn();
const mockSelection = jest.fn();
const profileEq = jest.fn();
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockQuery),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/lib/admin-facility-selection', () => ({
  loadAdminFacilitySelection: (...args: unknown[]) => mockSelection(...args),
}));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => ({ auth: { getUser: mockAuth }, from: mockFrom }) }));

type Menu = Record<string, unknown>;
const menu = (over: Menu = {}): Menu => ({
  facility_id: facility, ref_id: 'r1', kind: 'menu', store_id: 'H000000001', name: '合成カット', target: null,
  duration_min: 60, price: 4000, description: null, name_override: null, duration_min_override: null,
  price_override: null, description_override: null, is_hidden: false, missing_since: null, applied_at: null,
  ...over,
});

let applyResult: { ok: boolean; body: unknown };
let scrapeResult: { ok: boolean; body: unknown };
let menus: Menu[];
const counts = (over: Record<string, number> = {}) => ({
  inserted: 3, existing: 0, hidden: 0, skipped: 0, coupons: 0, coupons_in_menus: 0, ended: 0, other_store: 0, deleted: 0, ...over,
});
const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery = `facility_id=${facility}`;
  mockAuth.mockResolvedValue({ data: { user: { id: 'synthetic-user' } }, error: null });
  mockSelection.mockImplementation(async (_db: unknown, _user: string, requested: string | null) => ({
    choices: [{ id: facility, name: '合成店舗A' }, { id: other, name: '合成店舗B' }],
    selectedId: requested,
  }));
  mockFrom.mockImplementation(() => {
    const q: Record<string, unknown> = {};
    q.select = jest.fn(() => q);
    q.eq = jest.fn((...args: unknown[]) => { profileEq(...args); return q; });
    q.single = jest.fn(() => Promise.resolve({ data: { hpb_sln_id: 'H000000001' }, error: null }));
    return q;
  });
  menus = [menu()];
  applyResult = { ok: true, body: counts() };
  scrapeResult = { ok: true, body: { fetched: 2, saved: 2, skipped: 0, failed: 0, missing: 0 } };
  fetchMock.mockImplementation((url: string, options?: RequestInit) => {
    if (options?.method === 'POST' && url.includes('/apply')) {
      return Promise.resolve({ ok: applyResult.ok, json: async () => applyResult.body });
    }
    if (options?.method === 'POST') {
      return Promise.resolve({ ok: scrapeResult.ok, json: async () => scrapeResult.body });
    }
    return Promise.resolve({ ok: true, json: async () => ({ menus }) });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

test('反映前から、公開はメニュー管理で行うことを選択中の店舗へのリンクつきで示す', async () => {
  render(<Page />);
  await screen.findByText('合成カット');
  const link = screen.getByRole('link', { name: 'メニュー管理' });
  expect(link.getAttribute('href')).toBe(`/admin/menus?facility_id=${facility}`);
  expect(link.parentElement?.textContent).toContain('「公開する」を押すまでお客様には表示されません');
});

test('反映前に、まだ無いメニューだけを作ること・既にあるメニューは変えないこと・クーポンは反映しないことを示す', async () => {
  render(<Page />);
  await screen.findByText('合成カット');
  const note = screen.getByRole('link', { name: 'メニュー管理' }).parentElement?.textContent ?? '';
  expect(note).toContain('まだお客様メニューに無いもの');
  expect(note).toContain('既にあるメニューは変更しません');
  expect(note).toContain('クーポンは、新規・再来などの対象条件や割引価格を引き継げないため反映しません');
});

test('新規メニューを反映したら、非公開であることと公開の手順を画面に残す', async () => {
  render(<Page />);
  await screen.findByText('合成カット');
  fireEvent.click(screen.getByRole('button', { name: 'お客様メニューへ一括反映' }));
  const toast = await screen.findByText(/メニューへ反映: 新規3件/);
  expect(toast.textContent).toContain('公開したメニューが、お客様向けメニューとネット予約の対象になります（店舗ページの公開と予約受付の準備も必要です）');
  // 「公開すればネット予約できる」とは約束しない（店舗ページが非公開・予約受付の準備前は表示も予約もされない）。
  expect(toast.textContent).not.toContain('ネット予約できるようになります');
  const next = screen.getByText(/新しく反映したメニュー3件は非公開です/);
  expect(next.textContent).toContain('非公開のメニューをすべて公開する');
  expect(next.textContent).toContain('店舗ページの公開と予約受付の準備も必要です');
  expect(within(next).getByRole('link', { name: 'メニュー管理' }).getAttribute('href')).toBe(`/admin/menus?facility_id=${facility}`);
  expect(fetchMock).toHaveBeenCalledWith(`/api/admin/hpb-menus/apply?facility_id=${facility}`, { method: 'POST' });
});

test('新規が無い反映では公開の手順を出さない', async () => {
  applyResult = { ok: true, body: counts({ inserted: 0, existing: 2 }) };
  render(<Page />);
  await screen.findByText('合成カット');
  fireEvent.click(screen.getByRole('button', { name: 'お客様メニューへ一括反映' }));
  const toast = await screen.findByText(/メニューへ反映: 新規0件/);
  expect(toast.textContent).not.toContain('公開する');
  expect(screen.queryByText(/新しく反映したメニュー/)).toBeNull();
});

test('作らなかったものは理由ごとに件数を伝える（既にある・クーポン・HPBに無くなった・削除済み）', async () => {
  applyResult = { ok: true, body: counts({ inserted: 1, existing: 2, hidden: 1, coupons: 5, ended: 1, other_store: 2, deleted: 1, skipped: 1 }) };
  render(<Page />);
  await screen.findByText('合成カット');
  fireEvent.click(screen.getByRole('button', { name: 'お客様メニューへ一括反映' }));
  const toast = await screen.findByText(/メニューへ反映: 新規1件/);
  expect(toast.textContent).toContain('既にあるメニュー2件は変更していません');
  expect(toast.textContent).toContain('非表示にした1件を非公開にしました');
  expect(toast.textContent).toContain('クーポン5件は反映していません');
  expect(toast.textContent).toContain('HPBに無くなった3件は反映していません');
  expect(toast.textContent).toContain('メニュー管理で削除した1件は作り直していません');
  expect(toast.textContent).toContain('名前が空の1件は反映していません');
  // 反映後は一覧を読み直して「反映済み」を最新にする
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url, options]) => url === `/api/admin/hpb-menus?facility_id=${facility}` && !options)).toHaveLength(2));
});

test('お客様メニューに残っているHPBクーポンの件数を、確認先とあわせて伝える', async () => {
  applyResult = { ok: true, body: counts({ inserted: 0, coupons_in_menus: 2 }) };
  render(<Page />);
  await screen.findByText('合成カット');
  fireEvent.click(screen.getByRole('button', { name: 'お客様メニューへ一括反映' }));
  const toast = await screen.findByText(/メニューへ反映: 新規0件/);
  expect(toast.textContent).toContain('お客様メニューに残っているHPBクーポンが2件あります（割引価格のままです。メニュー管理で確認してください）');
});

// この修正より前の反映でクーポンから作られたお客様メニューは、行に「反映対象外」と出て見逃されていた。
test('お客様メニューに反映済みのクーポンは「反映対象外」と出さず、割引価格のまま残っていることを示す', async () => {
  menus = [
    menu(),
    menu({ ref_id: 'CP-IN', kind: 'coupon', target: '新規', name: '合成反映済みクーポン', applied_at: '2026-10-01T00:00:00Z' }),
    menu({ ref_id: 'CP-HIDDEN', kind: 'coupon', name: '合成非表示クーポン', applied_at: '2026-10-01T00:00:00Z', is_hidden: true }),
    menu({ ref_id: 'CP-NEW', kind: 'coupon', name: '合成未反映クーポン' }),
  ];
  render(<Page />);
  await screen.findByText('合成カット');
  const inRow = screen.getByText('合成反映済みクーポン').closest('div.flex.items-start') as HTMLElement;
  expect(within(inRow).getByText('反映済み（割引価格のまま）')).toBeTruthy();
  expect(within(inRow).queryByText('反映対象外')).toBeNull();
  const newRow = screen.getByText('合成未反映クーポン').closest('div.flex.items-start') as HTMLElement;
  expect(within(newRow).getByText('反映対象外')).toBeTruthy();
  // 非表示にしたもの（次の一括反映で非公開にする）は数えない
  const notice = screen.getByText(/お客様メニューに残っているHPBクーポンが1件あります/);
  expect(notice.textContent).toContain('公開中だと条件なしにこの価格で予約されるおそれがあります');
  expect(within(notice).getByRole('link', { name: 'メニュー管理' }).getAttribute('href')).toBe(`/admin/menus?facility_id=${facility}`);
});

test('お客様メニューに残っているクーポンが無ければ注意を出さない', async () => {
  menus = [menu(), menu({ ref_id: 'CP-NEW', kind: 'coupon', name: '合成未反映クーポン' })];
  render(<Page />);
  await screen.findByText('合成カット');
  expect(screen.queryByText(/お客様メニューに残っているHPBクーポン/)).toBeNull();
});

test('反映に失敗したら公開の手順を出さない', async () => {
  applyResult = { ok: false, body: { error: '反映に失敗しました' } };
  render(<Page />);
  await screen.findByText('合成カット');
  fireEvent.click(screen.getByRole('button', { name: 'お客様メニューへ一括反映' }));
  await screen.findByText('反映に失敗しました');
  expect(screen.queryByText(/新しく反映したメニュー/)).toBeNull();
});

test('HPBに無くなったもの・別の店舗IDのものは、反映しないことと理由を別の欄に出す', async () => {
  menus = [
    menu(),
    menu({ ref_id: 'CP1', kind: 'coupon', target: '新規', name: '合成新規クーポン' }),
    menu({ ref_id: 'MN-ENDED', name: '合成終了メニュー', missing_since: '2026-10-20T00:00:00Z', applied_at: '2026-10-01T00:00:00Z' }),
    menu({ ref_id: 'MN-OTHER', name: '合成他店メニュー', store_id: 'H999' }),
  ];
  render(<Page />);
  await screen.findByText('合成カット');
  const gone = screen.getByRole('region', { name: 'HPBに無くなったメニュー（2件）' });
  expect(within(gone).getByText('合成終了メニュー')).toBeTruthy();
  expect(within(gone).getByText('HPBで掲載終了')).toBeTruthy();
  expect(within(gone).getByText('反映済み')).toBeTruthy();
  expect(within(gone).getByText('合成他店メニュー')).toBeTruthy();
  expect(within(gone).getByText('別の店舗ID（H999）')).toBeTruthy();
  expect(within(gone).getByRole('link', { name: 'メニュー管理' }).getAttribute('href')).toBe(`/admin/menus?facility_id=${facility}`);
  expect(within(gone).queryByText('合成カット')).toBeNull();
  // クーポンは一覧に残すが、お客様メニューへ反映しないことを行ごとに示す
  const couponRow = screen.getByText('合成新規クーポン').closest('div.flex.items-start') as HTMLElement;
  expect(within(couponRow).getByText('反映対象外')).toBeTruthy();
  expect(within(couponRow).getByText('新規')).toBeTruthy();
});

test('取得で HPB に無くなった件数を伝える', async () => {
  scrapeResult = { ok: true, body: { fetched: 2, saved: 2, skipped: 0, failed: 0, missing: 4 } };
  render(<Page />);
  await screen.findByText('合成カット');
  fireEvent.click(screen.getByRole('button', { name: 'HPBから取得' }));
  const toast = await screen.findByText(/取得 2件中 2件を保存/);
  expect(toast.textContent).toContain('HPBに無くなった4件はお客様メニューへの反映の対象から外しました');
  expect(fetchMock).toHaveBeenCalledWith(`/api/admin/hpb-menus?facility_id=${facility}`, { method: 'POST' });
});

test('複数店舗で店舗未指定なら選択だけを出し、どの店舗の店舗ID・メニューも読まない', async () => {
  mockQuery = '';
  render(<Page />);
  expect(await screen.findByText('編集する店舗を選択してください')).toBeTruthy();
  expect(screen.getByRole('link', { name: '合成店舗B' }).getAttribute('href')).toBe(`/admin/hpb-menus?facility_id=${other}`);
  expect(mockFrom).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'HPBから取得' })).toBeNull();
});

test('選んだ店舗の店舗ID・メニューを読み、取得・反映もその店舗に対して行う', async () => {
  mockQuery = `facility_id=${other}`;
  menus = [menu({ facility_id: other, name: '合成店舗Bのカット' })];
  render(<Page />);
  await screen.findByText('合成店舗Bのカット');
  expect(mockSelection).toHaveBeenCalledWith(expect.anything(), 'synthetic-user', other);
  expect(mockFrom).toHaveBeenCalledWith('facility_profiles');
  expect(profileEq).toHaveBeenCalledWith('id', other);
  expect(fetchMock).toHaveBeenCalledWith(`/api/admin/hpb-menus?facility_id=${other}`);
  expect(screen.getByText('合成店舗B（選択中）')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'お客様メニューへ一括反映' }));
  await screen.findByText(/メニューへ反映: 新規3件/);
  expect(fetchMock).toHaveBeenCalledWith(`/api/admin/hpb-menus/apply?facility_id=${other}`, { method: 'POST' });
  expect(screen.getAllByRole('link', { name: 'メニュー管理' })[0].getAttribute('href')).toBe(`/admin/menus?facility_id=${other}`);
});

test('自分の店舗でない facility_id は読み込み失敗として扱い、何も読まない', async () => {
  mockSelection.mockRejectedValue(new Error('unauthorized_facility_selection'));
  render(<Page />);
  expect(await screen.findByText('管理する店舗の確認に失敗しました')).toBeTruthy();
  expect(mockFrom).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});
