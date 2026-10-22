/**
 * @jest-environment jsdom
 *
 * 店舗への問い合わせ一覧の店舗選択（2026年10月22日）。
 * 以前は facility_members を .limit(1).single() で 1 行だけ読んでいたため、複数店舗のオーナーには
 * 行の並び次第でどれか 1 店舗の問い合わせが出ていた（通知メールから開いても別の店舗が出得た）。
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import AdminFacilityInquiriesPage from '../page';

const A = '71000000-0000-4000-8000-000000000001';
const B = '71000000-0000-4000-8000-000000000002';
let mockParams = new URLSearchParams();
const mockSelection = jest.fn();
const mockFrom = jest.fn();
const queries: { table: string; eq: jest.Mock }[] = [];
let mockInquiryError: unknown = null;

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
  mockInquiryError = null;
  mockParams = new URLSearchParams();
  mockFrom.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    const eq = jest.fn(() => chain);
    queries.push({ table, eq });
    chain.eq = eq;
    for (const m of ['select', 'order']) chain[m] = () => chain;
    chain.limit = () => Promise.resolve(mockInquiryError
      ? { data: null, error: mockInquiryError }
      : { data: [{ id: 'q1', created_at: '2026-10-01T00:00:00Z', name: '店舗B宛の問い合わせ者', email: 'q@example.invalid', phone: null, message: '合成メッセージ' }], error: null });
    return chain;
  });
});

test('複数店舗で店舗未指定なら選択を求め、問い合わせを読まない', async () => {
  mockSelection.mockResolvedValue({ choices, selectedId: null });
  render(<AdminFacilityInquiriesPage />);
  expect(await screen.findByText('編集する店舗を選択してください')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '合成店舗B' })).toHaveAttribute('href', `/admin/facility-inquiries?facility_id=${B}`);
  expect(queries.some((q) => q.table === 'facility_inquiries')).toBe(false);
  expect(queries.some((q) => q.table === 'facility_members')).toBe(false);
});

test('?facility_id= で指定した店舗の問い合わせを読む', async () => {
  mockParams = new URLSearchParams({ facility_id: B });
  mockSelection.mockResolvedValue({ choices, selectedId: B });
  render(<AdminFacilityInquiriesPage />);
  expect(await screen.findByText('店舗B宛の問い合わせ者')).toBeInTheDocument();
  expect(mockSelection).toHaveBeenCalledWith(expect.anything(), 'owner-1', B);
  expect(queries.find((q) => q.table === 'facility_inquiries')?.eq).toHaveBeenCalledWith('facility_id', B);
});

test('問い合わせの取得失敗は「0件」と区別して表示する（店舗選択は残す）', async () => {
  mockParams = new URLSearchParams({ facility_id: B });
  mockSelection.mockResolvedValue({ choices, selectedId: B });
  mockInquiryError = { code: '08006' };
  render(<AdminFacilityInquiriesPage />);
  expect(await screen.findByText('問い合わせの読み込みに失敗しました')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '合成店舗B（選択中）' })).toBeInTheDocument();
  expect(screen.queryByText('お問い合わせはまだありません')).not.toBeInTheDocument();
});

test('自分の店舗でない facility_id は失敗として表示し、問い合わせを読まない', async () => {
  mockParams = new URLSearchParams({ facility_id: B });
  mockSelection.mockRejectedValue(new Error('unauthorized_facility_selection'));
  render(<AdminFacilityInquiriesPage />);
  expect(await screen.findByText('管理する店舗の確認に失敗しました')).toBeInTheDocument();
  await waitFor(() => expect(queries.some((q) => q.table === 'facility_inquiries')).toBe(false));
});
