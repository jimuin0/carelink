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
jest.mock('@/lib/line-availability', () => ({ isLineEnabled: jest.fn(()=>false), isLineLoginEnabled: jest.fn(()=>false) }));

const profile = { display_name: '合成プロフィール', phone: '09000000000', prefecture: '東京都',
  city: '', birth_date: '', gender: '', avatar_url: null, email_unsubscribed: false, line_user_id: null };
beforeEach(() => {
  jest.clearAllMocks();
  require('@/lib/line-availability').isLineEnabled.mockReturnValue(false);
  require('@/lib/line-availability').isLineLoginEnabled.mockReturnValue(false);
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

test('legacy profile LINE ID alone shows reconfirmation rather than a verified badge',async()=>{
 require('@/lib/line-availability').isLineEnabled.mockReturnValue(true);require('@/lib/line-availability').isLineLoginEnabled.mockReturnValue(true);
 mockMaybeSingle.mockResolvedValue({data:{...profile,line_user_id:'U_legacy'},error:null});render(<ProfileEditPage/>);
 const button=await screen.findByRole('button',{name:'LINE連携を再確認'});const form=button.closest('form')!;
 expect(form).toHaveAttribute('action','/api/auth/line');expect(form).toHaveAttribute('method','get');
 expect(form.querySelector('input[name="mode"]')).toHaveAttribute('value','link');expect(form.querySelector('input[name="redirect"]')).toHaveAttribute('value','/mypage/profile');
 expect(screen.queryByText('LINE連携済み')).not.toBeInTheDocument();expect(screen.getByText('友だち追加だけではアカウント連携は完了しません。')).toBeInTheDocument();
});
test('current profile and server-verified owner show the same verified badge',async()=>{
 mockMaybeSingle.mockResolvedValueOnce({data:{...profile,line_user_id:'U_owned'},error:null}).mockResolvedValueOnce({data:{line_user_id:'U_owned'},error:null}).mockResolvedValueOnce({data:{user_id:'synthetic-user',line_user_id:'U_owned',proof_version:1,verified_at:'2026-10-09T00:00:00Z'},error:null});
 render(<ProfileEditPage/>);expect(await screen.findByText('LINE連携済み')).toBeInTheDocument();
});

// ==========================================================================
// お知らせメールの再開（2026年10月22日）
// メールの配信停止リンクは newsletter_subscriptions に抑止行を作る。ブラウザから
// profiles.email_unsubscribed だけを戻すと抑止行が残り、「再開しました」と出るのに二度と届かなかった。
// トグルはサーバーの API（旗と抑止行を 1 トランザクションで切り替える）だけを通す。
// ==========================================================================
const NEWSLETTER_LABEL = /お知らせメール（クーポン・キャンペーン情報など）を受け取る/;

test('配信停止中に ON にすると、API へ receive=true を送り「再開しました」を出す', async () => {
  mockMaybeSingle.mockResolvedValue({ data: { ...profile, email_unsubscribed: true }, error: null });
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, receive: true }) });
  render(<ProfileEditPage />);
  const toggle = await screen.findByRole('checkbox', { name: NEWSLETTER_LABEL });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  expect(await screen.findByText('お知らせメールの配信を再開しました')).toBeInTheDocument();
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [url, init] = mockFetch.mock.calls[0];
  expect(url).toBe('/api/profile/newsletter');
  expect(init.method).toBe('PUT');
  expect(JSON.parse(init.body)).toEqual({ receive: true });
  await waitFor(() => expect(toggle).toBeChecked());
});

test('OFF にすると API へ receive=false を送る', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, receive: false }) });
  render(<ProfileEditPage />);
  const toggle = await screen.findByRole('checkbox', { name: NEWSLETTER_LABEL });
  fireEvent.click(toggle);
  expect(await screen.findByText('お知らせメールの配信を停止しました')).toBeInTheDocument();
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ receive: false });
  await waitFor(() => expect(toggle).not.toBeChecked());
});

test.each([
  ['HTTP エラー（サーバーの文言を出す）', { ok: false, json: async () => ({ error: 'プロフィールを確認できません。設定は変更されていません。' }) }, 'プロフィールを確認できません。設定は変更されていません。'],
  ['成功でない応答', { ok: true, json: async () => ({ success: false }) }, '設定の変更に失敗しました'],
  ['逆向きの結果', { ok: true, json: async () => ({ success: true, receive: false }) }, '設定の変更に失敗しました'],
  ['壊れた JSON', { ok: true, json: () => Promise.reject(new Error('bad JSON')) }, '設定の変更に失敗しました'],
])('%s は再開済みに見せない', async (_label, response, message) => {
  mockMaybeSingle.mockResolvedValue({ data: { ...profile, email_unsubscribed: true }, error: null });
  mockFetch.mockResolvedValue(response);
  render(<ProfileEditPage />);
  const toggle = await screen.findByRole('checkbox', { name: NEWSLETTER_LABEL });
  fireEvent.click(toggle);
  expect(await screen.findByText(message)).toBeInTheDocument();
  expect(screen.queryByText('お知らせメールの配信を再開しました')).not.toBeInTheDocument();
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(toggle).not.toBeChecked();
});

test('通信失敗も再開済みに見せない（英語の内部エラーは出さない）', async () => {
  mockMaybeSingle.mockResolvedValue({ data: { ...profile, email_unsubscribed: true }, error: null });
  mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
  render(<ProfileEditPage />);
  const toggle = await screen.findByRole('checkbox', { name: NEWSLETTER_LABEL });
  fireEvent.click(toggle);
  expect(await screen.findByText('設定の変更に失敗しました')).toBeInTheDocument();
  expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
  expect(toggle).not.toBeChecked();
});
