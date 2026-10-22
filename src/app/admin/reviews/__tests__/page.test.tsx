/**
 * @jest-environment jsdom
 *
 * 口コミ管理の店舗選択（2026年10月22日）。
 * 以前は facility_members を .limit(1).single() で 1 行だけ読んでいたため、複数店舗のオーナーには
 * 行の並び次第でどれか 1 店舗の口コミが出ていた（通知から開いても別の店舗が出得た）。
 * 他の管理画面と同じ loadAdminFacilitySelection + FacilitySelector で ?facility_id= を尊重する。
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import AdminReviewsPage from '../page';

const A = '71000000-0000-4000-8000-000000000001';
const B = '71000000-0000-4000-8000-000000000002';
let mockParams = new URLSearchParams();
const mockSelection = jest.fn();
const mockFrom = jest.fn();
const queries: { table: string; eq: jest.Mock }[] = [];

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
  mockParams = new URLSearchParams();
  mockFrom.mockImplementation((table: string) => {
    const result = {
      data: table === 'facility_reviews'
        ? [{ id: 'r1', facility_id: B, reviewer_name: '店舗Bのお客様', rating: 5, comment: null, status: 'published', created_at: '2026-10-01T00:00:00Z' }]
        : [],
      error: null,
    };
    const chain: Record<string, unknown> = {};
    const eq = jest.fn(() => chain);
    queries.push({ table, eq });
    chain.eq = eq;
    for (const m of ['select', 'in', 'order', 'limit']) chain[m] = () => chain;
    chain.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return chain;
  });
});

test('複数店舗で店舗未指定なら選択を求め、どの店舗の口コミも読まない（勝手に1店舗を選ばない）', async () => {
  mockSelection.mockResolvedValue({ choices, selectedId: null });
  render(<AdminReviewsPage />);
  expect(await screen.findByText('編集する店舗を選択してください')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '合成店舗A' })).toHaveAttribute('href', `/admin/reviews?facility_id=${A}`);
  expect(screen.getByRole('link', { name: '合成店舗B' })).toHaveAttribute('href', `/admin/reviews?facility_id=${B}`);
  expect(mockSelection).toHaveBeenCalledWith(expect.anything(), 'owner-1', null);
  expect(queries.some((q) => q.table === 'facility_reviews')).toBe(false);
  expect(queries.some((q) => q.table === 'facility_members')).toBe(false);
});

test('?facility_id= で指定した店舗の口コミを読む（通知リンクから開いたとき）', async () => {
  mockParams = new URLSearchParams({ facility_id: B });
  mockSelection.mockResolvedValue({ choices, selectedId: B });
  render(<AdminReviewsPage />);
  expect(await screen.findByText('店舗Bのお客様')).toBeInTheDocument();
  expect(mockSelection).toHaveBeenCalledWith(expect.anything(), 'owner-1', B);
  expect(queries.find((q) => q.table === 'facility_reviews')?.eq).toHaveBeenCalledWith('facility_id', B);
  expect(screen.getByRole('link', { name: '合成店舗B（選択中）' })).toHaveAttribute('aria-current', 'page');
});

test('自分の店舗でない facility_id は失敗として表示し、口コミを読まない', async () => {
  mockParams = new URLSearchParams({ facility_id: B });
  mockSelection.mockRejectedValue(new Error('unauthorized_facility_selection'));
  render(<AdminReviewsPage />);
  expect(await screen.findByText('管理する店舗の確認に失敗しました')).toBeInTheDocument();
  await waitFor(() => expect(queries.some((q) => q.table === 'facility_reviews')).toBe(false));
});
