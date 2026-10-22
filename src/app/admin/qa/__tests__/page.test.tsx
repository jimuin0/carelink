/**
 * @jest-environment jsdom
 *
 * Q&A 管理画面の店舗選択（2026年10月22日）。
 * 以前は facility_members を .limit(1).single() で 1 行だけ読んでいたため、複数店舗のオーナーには
 * 行の並び次第でどれか 1 店舗の Q&A が出ていた。新着質問の通知メールは ?facility_id= 付きの
 * リンクで開くので、その店舗の Q&A を出し、回答もその店舗に対して送る。
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminQAPage from '../page';

const A = '76000000-0000-4000-8000-000000000001';
const B = '76000000-0000-4000-8000-000000000002';
const QA = '76000000-0000-4000-8000-000000000003';
let mockParams = new URLSearchParams();
const mockSelection = jest.fn();
const mockFrom = jest.fn();
const queries: { table: string; eq: jest.Mock }[] = [];
let mockQaError: unknown = null;
const fetchMock = jest.fn();

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

const choices = [{ id: A, name: '合成店舗A' }, { id: B, name: '合成店舗B' }];

beforeEach(() => {
  jest.clearAllMocks();
  queries.length = 0;
  mockQaError = null;
  mockParams = new URLSearchParams();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  mockFrom.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    const eq = jest.fn(() => chain);
    queries.push({ table, eq });
    chain.eq = eq;
    for (const m of ['select', 'order']) chain[m] = () => chain;
    chain.limit = () => Promise.resolve(mockQaError
      ? { data: null, error: mockQaError }
      : { data: [{ id: QA, facility_id: B, user_id: 'u', question: '店舗B宛の質問', answer: null, answered_by: null,
        answered_at: null, status: 'pending', is_public: true, created_at: '2026-10-01T00:00:00Z' }], error: null });
    return chain;
  });
});

test('複数店舗で店舗未指定なら選択を求め、Q&A を読まない', async () => {
  mockSelection.mockResolvedValue({ choices, selectedId: null });
  render(<AdminQAPage />);
  expect(await screen.findByText('編集する店舗を選択してください')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '合成店舗B' })).toHaveAttribute('href', `/admin/qa?facility_id=${B}`);
  expect(queries.some((q) => q.table === 'facility_qa')).toBe(false);
  expect(queries.some((q) => q.table === 'facility_members')).toBe(false);
  expect(screen.queryByText('Q&Aはまだありません')).not.toBeInTheDocument();
});

test('?facility_id= で指定した店舗の Q&A を読み、回答もその店舗に送る', async () => {
  mockParams = new URLSearchParams({ facility_id: B });
  mockSelection.mockResolvedValue({ choices, selectedId: B });
  const user = userEvent.setup();
  render(<AdminQAPage />);
  expect(await screen.findByText('店舗B宛の質問')).toBeInTheDocument();
  expect(mockSelection).toHaveBeenCalledWith(expect.anything(), 'owner-1', B);
  expect(queries.find((q) => q.table === 'facility_qa')?.eq).toHaveBeenCalledWith('facility_id', B);
  expect(screen.getByText('未回答 1件')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: '回答する' }));
  fireEvent.change(screen.getByRole('textbox', { name: /^回答/ }), { target: { value: 'ございます。' } });
  await user.click(screen.getByRole('button', { name: '回答を送信' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/admin/qa?facility_id=${B}`, expect.objectContaining({ method: 'POST' })));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ qa_id: QA, answer: 'ございます。' });
});

test('Q&A の取得失敗は「0件」と区別して表示する（店舗選択は残す）', async () => {
  mockParams = new URLSearchParams({ facility_id: B });
  mockSelection.mockResolvedValue({ choices, selectedId: B });
  mockQaError = { code: '08006' };
  render(<AdminQAPage />);
  expect(await screen.findByText('Q&Aの読み込みに失敗しました')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '合成店舗B（選択中）' })).toBeInTheDocument();
  expect(screen.queryByText('Q&Aはまだありません')).not.toBeInTheDocument();
});

test('自分の店舗でない facility_id は失敗として表示し、Q&A を読まない', async () => {
  mockParams = new URLSearchParams({ facility_id: B });
  mockSelection.mockRejectedValue(new Error('unauthorized_facility_selection'));
  render(<AdminQAPage />);
  expect(await screen.findByText('管理する店舗の確認に失敗しました')).toBeInTheDocument();
  await waitFor(() => expect(queries.some((q) => q.table === 'facility_qa')).toBe(false));
});
