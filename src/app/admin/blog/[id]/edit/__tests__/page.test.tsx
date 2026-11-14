/**
 * @jest-environment jsdom
 *
 * 監査 A173: 保存・削除に try/catch/finally が無く、通信断で「保存中...」のまま固まり、エラーも出なかった。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Page from '../page';

const mockPush = jest.fn();
const mockRouter = { push: mockPush, replace: jest.fn() };
const FID = '7b000000-0000-4000-8000-000000000001';
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useParams: () => ({ id: 'p1' }),
  useSearchParams: () => new URLSearchParams(`facility_id=${FID}`),
}));
jest.mock('@/hooks/useUnsavedGuard', () => ({ useUnsavedGuard: () => {} }));
jest.mock('@/lib/auth-verification', () => ({ verifyAuthUser: async () => ({ state: 'verified', user: { id: 'u1' } }) }));
jest.mock('@/lib/admin-facility-selection', () => ({
  loadAdminFacilitySelection: async () => ({ choices: [{ id: FID, name: '合成店舗' }], selectedId: FID }),
}));
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {},
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'p1', facility_id: FID, title: '合成記事', content: '本文', is_published: false }, error: null }) }) }) }),
  }),
}));

beforeEach(() => mockPush.mockReset());

test('保存が通信断ならボタンを戻してエラーを出す', async () => {
  render(<Page />);
  const save = await screen.findByRole('button', { name: '保存する' });
  global.fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
  await act(async () => { fireEvent.click(save); });
  expect(await screen.findByText(/通信に失敗しました。保存されていない可能性があります/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '保存する' })).toBeEnabled();
});

test('削除が通信断なら一覧へ移らずエラーを出す', async () => {
  render(<Page />);
  fireEvent.click(await screen.findByRole('button', { name: '削除' }));
  global.fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '削除する' })); });
  expect(await screen.findByText(/削除されていない可能性があります/)).toBeInTheDocument();
  expect(mockPush).not.toHaveBeenCalled();
});
