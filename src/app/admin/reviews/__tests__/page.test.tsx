/**
 * @jest-environment jsdom
 *
 * 口コミ管理の店舗選択（2026年10月22日）。
 * 以前は facility_members を .limit(1).single() で 1 行だけ読んでいたため、複数店舗のオーナーには
 * 行の並び次第でどれか 1 店舗の口コミが出ていた（通知から開いても別の店舗が出得た）。
 * 他の管理画面と同じ loadAdminFacilitySelection + FacilitySelector で ?facility_id= を尊重する。
 *
 * 2026年10月23日:
 * - 一覧は /api/admin/reviews から読む。以前はブラウザから facility_reviews を select('*') で読み、
 *   投稿者の IP アドレスとアカウント ID が店舗のブラウザに届いていた。
 * - 運営の審査で止められた口コミを『公開中』と出さない。以前は status だけを見ており、審査待ち・
 *   運営が却下した口コミにも『公開中』を出し、『公開する』を押すと成功と出るのに公開されなかった。
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AdminReviewsPage from '../page';

const A = '71000000-0000-4000-8000-000000000001';
const B = '71000000-0000-4000-8000-000000000002';
const R1 = '71000000-0000-4000-8000-000000000011';
const R2 = '71000000-0000-4000-8000-000000000012';
const R3 = '71000000-0000-4000-8000-000000000013';
const R4 = '71000000-0000-4000-8000-000000000014';
const R5 = '71000000-0000-4000-8000-000000000015';
let mockParams = new URLSearchParams();
const mockSelection = jest.fn();
const mockFrom = jest.fn();
const mockFetch = jest.fn();
const queries: { table: string; calls: unknown[][] }[] = [];
let reviews: Record<string, unknown>[] = [];
let updateError: unknown = null;

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockParams,
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/lib/admin-facility-selection', () => ({
  loadAdminFacilitySelection: (...args: unknown[]) => mockSelection(...args),
}));
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'owner-1' } } }) },
    from: (table: string) => mockFrom(table),
  }),
}));
jest.mock('@/components/Toast', () => ({ __esModule: true, default: ({ message }: { message: string }) => <p role="status">{message}</p> }));

const choices = [{ id: A, name: '合成店舗A' }, { id: B, name: '合成店舗B' }];
const review = (id: string, name: string, status: string, moderation: string) =>
  ({ id, reviewer_name: name, rating: 4, comment: null, status, created_at: '2026-10-01T00:00:00Z', moderation });

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  jest.clearAllMocks();
  queries.length = 0;
  updateError = null;
  mockParams = new URLSearchParams();
  reviews = [review(R1, '店舗Bのお客様', 'published', 'none')];
  mockFrom.mockImplementation((table: string) => {
    const calls: unknown[][] = [];
    queries.push({ table, calls });
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'update']) chain[m] = (...args: unknown[]) => { calls.push([m, ...args]); return chain; };
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: table === 'facility_reviews' ? null : [], error: table === 'facility_reviews' ? updateError : null });
    return chain;
  });
  mockFetch.mockImplementation(() => json(200, { reviews }));
  global.fetch = mockFetch as unknown as typeof fetch;
});

const listCalls = () => mockFetch.mock.calls.filter(([url]) => String(url).startsWith('/api/admin/reviews?'));

test('複数店舗で店舗未指定なら選択を求め、どの店舗の口コミも読まない（勝手に1店舗を選ばない）', async () => {
  mockSelection.mockResolvedValue({ choices, selectedId: null });
  render(<AdminReviewsPage />);
  expect(await screen.findByText('編集する店舗を選択してください')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '合成店舗A' })).toHaveAttribute('href', `/admin/reviews?facility_id=${A}`);
  expect(screen.getByRole('link', { name: '合成店舗B' })).toHaveAttribute('href', `/admin/reviews?facility_id=${B}`);
  expect(mockSelection).toHaveBeenCalledWith(expect.anything(), 'owner-1', null);
  expect(listCalls()).toHaveLength(0);
  expect(queries.some((q) => q.table === 'facility_reviews')).toBe(false);
});

test('?facility_id= で指定した店舗の口コミを API から読む（ブラウザから facility_reviews を読まない）', async () => {
  mockParams = new URLSearchParams({ facility_id: B });
  mockSelection.mockResolvedValue({ choices, selectedId: B });
  render(<AdminReviewsPage />);
  expect(await screen.findByText('店舗Bのお客様')).toBeInTheDocument();
  expect(mockSelection).toHaveBeenCalledWith(expect.anything(), 'owner-1', B);
  expect(listCalls()[0][0]).toBe(`/api/admin/reviews?facility_id=${B}&filter=all`);
  expect(queries.some((q) => q.table === 'facility_reviews')).toBe(false);
  expect(screen.getByRole('link', { name: '合成店舗B（選択中）' })).toHaveAttribute('aria-current', 'page');
});

test('自分の店舗でない facility_id は失敗として表示し、口コミを読まない', async () => {
  mockParams = new URLSearchParams({ facility_id: B });
  mockSelection.mockRejectedValue(new Error('unauthorized_facility_selection'));
  render(<AdminReviewsPage />);
  expect(await screen.findByText('管理する店舗の確認に失敗しました')).toBeInTheDocument();
  await waitFor(() => expect(listCalls()).toHaveLength(0));
});

test.each([
  ['API の失敗', () => json(500, { error: 'x' })],
  ['形の違う応答', () => json(200, { list: [] })],
  ['通信の失敗', () => Promise.reject(new Error('offline'))],
])('%s は読み込み失敗として出す', async (_label, reply) => {
  mockSelection.mockResolvedValue({ choices: [choices[0]], selectedId: A });
  mockFetch.mockImplementation(reply);
  render(<AdminReviewsPage />);
  expect(await screen.findByText('口コミの読み込みに失敗しました')).toBeInTheDocument();
});

describe('運営の審査状態', () => {
  beforeEach(() => {
    mockSelection.mockResolvedValue({ choices: [choices[0]], selectedId: A });
    reviews = [
      review(R1, '公開中のお客様', 'published', 'none'),
      review(R2, '確認中のお客様', 'published', 'pending'),
      review(R3, '却下のお客様', 'hidden', 'rejected'),
      review(R4, '非表示で確認中のお客様', 'hidden', 'pending'),
      review(R5, '手続き停止のお客様', 'hidden', 'stalled'),
    ];
  });
  const card = async (name: string) => within(await screen.findByRole('article', { name: `${name}さんの口コミ` }));

  test('審査待ちは『公開中』ではなく『運営の確認中』と出し、店舗ページに出ないことを説明する', async () => {
    render(<AdminReviewsPage />);
    const pending = await card('確認中のお客様');
    expect(pending.getByText('運営の確認中')).toBeInTheDocument();
    expect(pending.queryByText('公開中')).not.toBeInTheDocument();
    expect(pending.getByText(/確認が終わるまで店舗ページと評価には反映されません/)).toBeInTheDocument();
    expect(pending.getByRole('button', { name: '非表示にする' })).toBeEnabled();
    expect((await card('公開中のお客様')).getByText('公開中')).toBeInTheDocument();
  });

  test('運営が却下した口コミは『運営判断で非公開』と出し、『公開する』を押させない', async () => {
    render(<AdminReviewsPage />);
    const rejected = await card('却下のお客様');
    expect(rejected.getByText('運営判断で非公開')).toBeInTheDocument();
    expect(rejected.queryByText('非表示')).not.toBeInTheDocument();
    const publish = rejected.getByRole('button', { name: '公開する' });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription('運営の判断で非公開になっています。店舗から公開することはできません。');
    fireEvent.click(publish);
    expect(queries.some((q) => q.table === 'facility_reviews')).toBe(false);
  });

  test('店舗が非表示にした審査待ちの口コミは両方の状態を出し、『公開する』を押させない', async () => {
    render(<AdminReviewsPage />);
    const both = await card('非表示で確認中のお客様');
    expect(both.getByText('運営の確認中')).toBeInTheDocument();
    expect(both.getByText('非表示')).toBeInTheDocument();
    expect(both.getByRole('button', { name: '公開する' })).toBeDisabled();
  });

  // 2026年10月23日レビュー指摘: 承認済みなのに旗が戻ったまま（審査待ちの行が無い）口コミを『運営の確認中』と
  // 案内していたが、運営の審査画面にも出ず確認は終わらない。事実どおり問い合わせを案内する。
  test('公開手続きが止まった口コミは『確認中』と言わず問い合わせを案内し、『公開する』を押させない', async () => {
    render(<AdminReviewsPage />);
    const stalled = await card('手続き停止のお客様');
    expect(stalled.getByText('公開手続きの停止')).toBeInTheDocument();
    expect(stalled.queryByText('運営の確認中')).not.toBeInTheDocument();
    expect(stalled.getByText('非表示')).toBeInTheDocument();
    const publish = stalled.getByRole('button', { name: '公開する' });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription('運営の確認は済んでいますが、公開の手続きが止まっています。お手数ですが、運営までお問い合わせください。');
  });

  test('『運営の確認』の絞り込みがあり、選ぶと API に moderation を渡す', async () => {
    render(<AdminReviewsPage />);
    await card('公開中のお客様');
    fireEvent.click(screen.getByRole('button', { name: '運営の確認' }));
    await waitFor(() => expect(listCalls().at(-1)?.[0]).toBe(`/api/admin/reviews?facility_id=${A}&filter=moderation`));
  });
});

describe('公開・非表示の切り替え', () => {
  beforeEach(() => {
    mockSelection.mockResolvedValue({ choices: [choices[0]], selectedId: A });
  });

  test('非表示にすると status だけを更新し、一覧を読み直さない', async () => {
    reviews = [review(R1, '公開中のお客様', 'published', 'none')];
    render(<AdminReviewsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '非表示にする' }));
    expect(await screen.findByText('非表示にしました')).toBeInTheDocument();
    const update = queries.find((q) => q.table === 'facility_reviews')!.calls;
    expect(update).toEqual([['update', { status: 'hidden' }], ['eq', 'id', R1], ['eq', 'facility_id', A]]);
    expect(listCalls()).toHaveLength(1);
    expect(screen.getByRole('button', { name: '公開する' })).toBeEnabled();
  });

  test('公開すると読み直し、運営の審査が始まっていなければ『公開しました』', async () => {
    reviews = [review(R1, '非表示のお客様', 'hidden', 'none')];
    render(<AdminReviewsPage />);
    const publish = await screen.findByRole('button', { name: '公開する' });
    reviews = [review(R1, '非表示のお客様', 'published', 'none')];
    fireEvent.click(publish);
    expect(await screen.findByText('公開しました')).toBeInTheDocument();
    expect(listCalls()).toHaveLength(2);
    expect(within(screen.getByRole('article', { name: '非表示のお客様さんの口コミ' })).getByText('公開中')).toBeInTheDocument();
  });

  test('読み直したら運営の審査が始まっていた場合は、店舗ページに出ないことを伝える（成功だけを出さない）', async () => {
    reviews = [review(R1, '非表示のお客様', 'hidden', 'none')];
    render(<AdminReviewsPage />);
    const publish = await screen.findByRole('button', { name: '公開する' });
    reviews = [review(R1, '非表示のお客様', 'published', 'pending')];
    fireEvent.click(publish);
    expect(await screen.findByText('公開に切り替えましたが、運営の確認が終わるまで店舗ページには表示されません')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: '非表示のお客様さんの口コミ' })).getByText('運営の確認中')).toBeInTheDocument();
  });

  test('読み直せなかったときは切り替えた結果だけを反映し、一覧は残す', async () => {
    reviews = [review(R1, '非表示のお客様', 'hidden', 'none')];
    render(<AdminReviewsPage />);
    const publish = await screen.findByRole('button', { name: '公開する' });
    mockFetch.mockImplementation(() => json(500, {}));
    fireEvent.click(publish);
    expect(await screen.findByText('公開しました')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: '非表示のお客様さんの口コミ' })).getByText('公開中')).toBeInTheDocument();
  });

  test('更新に失敗したら『更新に失敗しました』', async () => {
    reviews = [review(R1, '公開中のお客様', 'published', 'none')];
    updateError = { message: 'denied' };
    render(<AdminReviewsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '非表示にする' }));
    expect(await screen.findByText('更新に失敗しました')).toBeInTheDocument();
  });
});
