import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PointsPage from '../page';
const mockClient = { auth: { getUser: jest.fn() }, from: jest.fn(), rpc: jest.fn() };
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: async () => mockClient }));
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
const mockHistory = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  mockClient.auth.getUser.mockResolvedValue({ data: { user: { id: 'owner' } } });
  mockClient.rpc.mockResolvedValue({ data: 2001, error: null });
  mockHistory.mockResolvedValue({ data: [{ id: 'history', points: 1, reason: 'recent reward', created_at: '2026-10-11T00:00:00Z' }], error: null });
  mockClient.from.mockReturnValue({ select: () => ({ eq: () => ({ order: () => ({ limit: mockHistory }) }) }) });
});
test('complete balance remains independent of the bounded recent history', async () => {
  render(await PointsPage());
  expect(screen.getByText('2,001 pt')).toBeInTheDocument();
  expect(screen.getByText('recent reward')).toBeInTheDocument();
  expect(mockHistory).toHaveBeenCalledWith(50);
  expect(mockClient.rpc).toHaveBeenCalledWith('get_user_points_balance', { p_user_id: 'owner' });
});
test.each(['history', 'balance'])('%s failure offers retry without a fabricated zero', async kind => {
  if (kind === 'history') mockHistory.mockResolvedValue({ data: null, error: { message: 'fixture unavailable' } });
  else mockClient.rpc.mockResolvedValue({ data: 500, error: { message: 'fixture unavailable' } });
  render(await PointsPage());
  expect(screen.getByRole('alert')).toHaveTextContent('ポイントを取得できませんでした');
  expect(screen.getByRole('button', { name: '再読み込み' }).closest('form')).toHaveAttribute('action', '/mypage/points');
  expect(screen.queryByText('0 pt')).not.toBeInTheDocument();
});
test('empty ledger is a real zero with a distinct empty history', async () => {
  mockHistory.mockResolvedValue({ data: [], error: null }); mockClient.rpc.mockResolvedValue({ data: 0, error: null });
  render(await PointsPage());
  expect(screen.getByText('0 pt')).toBeInTheDocument();
  expect(screen.getByText('ポイント履歴がありません')).toBeInTheDocument();
});
test('no account cannot read a balance', async () => {
  mockClient.auth.getUser.mockResolvedValue({ data: { user: null } });
  await expect(PointsPage()).rejects.toThrow('NOT_FOUND');
  expect(mockClient.rpc).not.toHaveBeenCalled();
});
