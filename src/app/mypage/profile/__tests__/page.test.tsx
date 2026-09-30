/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProfileEditPage from '../page';
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard';

const mockGetUser = jest.fn();
const mockMaybeSingle = jest.fn();
const mockFetch = jest.fn();
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => ({
  auth: { getUser: mockGetUser },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
}) }));
jest.mock('@/hooks/useUnsavedGuard', () => ({ useUnsavedGuard: jest.fn() }));
jest.mock('@/lib/line-availability', () => ({ isLineEnabled: () => false }));

const profile = { display_name: '合成プロフィール', phone: '09000000000', prefecture: '東京都',
  city: '', birth_date: '', gender: '', avatar_url: null, email_unsubscribed: false, line_user_id: null };
beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'synthetic-user' } }, error: null });
  mockMaybeSingle.mockResolvedValue({ data: profile, error: null });
  global.fetch = mockFetch;
});

test('欠損プロフィールは新規入力や保存成功にせず再試行・問い合わせを表示する', async () => {
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  render(<ProfileEditPage />);
  expect(await screen.findByRole('link', { name: 'お問い合わせ' })).toHaveAttribute('href', '/contact');
  expect(screen.queryByRole('button', { name: 'プロフィールを更新' })).not.toBeInTheDocument();
  expect(mockFetch).not.toHaveBeenCalled();
  mockMaybeSingle.mockResolvedValue({ data: profile, error: null });
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  expect(await screen.findByLabelText(/^お名前/)).toHaveValue(profile.display_name);
  expect(screen.queryByRole('link', { name: 'お問い合わせ' })).not.toBeInTheDocument();
});

test.each(['no-session', 'db-error', 'auth-throw'])('初期化%sは空フォームで書き込ませない', async failure => {
  if (failure === 'no-session') mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  if (failure === 'db-error') mockMaybeSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
  if (failure === 'auth-throw') mockGetUser.mockRejectedValue(new Error('synthetic failure'));
  render(<ProfileEditPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('プロフィールの読み込みに失敗しました');
  expect(screen.queryByRole('button', { name: 'プロフィールを更新' })).not.toBeInTheDocument();
});

test.each(['http-error', 'business-error', 'broken-json', 'network'])('保存%sは入力と未保存状態を保持する', async failure => {
  if (failure === 'network') mockFetch.mockRejectedValue(new Error('synthetic failure'));
  else mockFetch.mockResolvedValue({
    ok: failure !== 'http-error',
    json: failure === 'broken-json' ? () => Promise.reject(new Error('bad JSON'))
      : async () => failure === 'http-error' ? { error: 'プロフィールを確認できません' } : { success: false, error: {} },
  });
  render(<ProfileEditPage />);
  const name = await screen.findByLabelText(/^お名前/);
  fireEvent.change(name, { target: { value: '未保存の合成入力' } });
  fireEvent.click(screen.getByRole('button', { name: 'プロフィールを更新' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'プロフィールを更新' })).toBeEnabled());
  expect(name).toHaveValue('未保存の合成入力');
  expect(screen.queryByText('プロフィールを更新しました')).not.toBeInTheDocument();
  expect(useUnsavedGuard).toHaveBeenLastCalledWith(true);
});

test('HTTPと業務成功の両方を確認して未保存状態を解除する', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
  render(<ProfileEditPage />);
  fireEvent.change(await screen.findByLabelText(/^お名前/), { target: { value: '保存した合成入力' } });
  fireEvent.click(screen.getByRole('button', { name: 'プロフィールを更新' }));
  expect(await screen.findByText('プロフィールを更新しました')).toBeInTheDocument();
  await waitFor(() => expect(useUnsavedGuard).toHaveBeenLastCalledWith(false));
  expect(JSON.parse(mockFetch.mock.calls[0][1].body).birth_date).toBeNull();
});

test('保存応答待ちでは全入力をロックし送信後の編集が成功応答で消えない', async () => {
  let resolveSave!: (response: unknown) => void;
  mockFetch.mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));
  render(<ProfileEditPage />);
  const name = await screen.findByLabelText(/^お名前/);
  fireEvent.change(name, { target: { value: '保存中の合成入力' } });
  fireEvent.click(screen.getByRole('button', { name: 'プロフィールを更新' }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  for (const label of [/^お名前/, /^電話番号/, /^都道府県/, '市区町村', '生年月日', '性別']) {
    expect(screen.getByLabelText(label)).toBeDisabled();
  }
  expect(screen.getByRole('button', { name: '更新中...' })).toBeDisabled();
  await act(async () => { resolveSave({ ok: true, json: async () => ({ success: true }) }); });
  expect(await screen.findByText('プロフィールを更新しました')).toBeInTheDocument();
  expect(name).toHaveValue('保存中の合成入力');
  expect(name).toBeEnabled();
  fireEvent.change(name, { target: { value: '次の未保存入力' } });
  expect(name).toHaveValue('次の未保存入力');
  await waitFor(() => expect(useUnsavedGuard).toHaveBeenLastCalledWith(true));
});
