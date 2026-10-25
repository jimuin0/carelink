/**
 * @jest-environment jsdom
 *
 * /auth/signup 回帰テスト（docs/register-blocker-instructions.md §3 P0-5・P0-4）。
 *
 * P0-5: signUp 成功後に画面が止まる不具合。`data.session` の有無で実行時に判定する
 *   実装にしたため、本番の Supabase「Confirm email」設定を知らなくても正しく動く形に
 *   なっている（session あり=確認無効→即遷移／session なし=確認有効→文言のまま留まる）。
 * P0-4: redirect のサニタイズを共有ヘルパー safeRedirect へ寄せた（`/\evil.com` 等の
 *   オープンリダイレクトを止める）。
 *
 * 🔴 CLAUDE.md の LineDeliveryOutcome 節と同じ教訓がここにも当てはまる:
 * 「戻り値を変えても `if (ok)` は素通りする。分岐の【結果】を主張する検査を書くこと」。
 * signUp への呼び出し引数だけを見るテストにはせず、router.push が【実際に呼ばれたか／
 * 呼ばれなかったか】と【どの引数で呼ばれたか】を直接 assert する。
 */
import '@testing-library/jest-dom';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server.node';
import SignupPage from '../page';
import { AuthWeakPasswordError } from '@supabase/supabase-js';
import { describePasswordUpdateError } from '@/lib/password-reset';

const mockPush = jest.fn();
const mockRefresh = jest.fn();
const mockReplace = jest.fn();
// jest.mock ファクトリから参照するため `mock` プレフィックス必須（babel-plugin-jest-hoist）。
// テストごとに useSearchParams の戻り値を差し替えられるよう let で保持する。
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh, replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

const mockSignUp = jest.fn();
const mockGetUser = jest.fn();
const mockSignInWithOAuth = jest.fn();
const mockResend = jest.fn();
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      signUp: (...args: unknown[]) => mockSignUp(...args),
      getUser: (...args: unknown[]) => mockGetUser(...args),
      signInWithOAuth: (...args: unknown[]) => mockSignInWithOAuth(...args),
      resend: (...args: unknown[]) => mockResend(...args),
    },
  }),
}));

// LINE ログインの出し分け（line-availability.ts）。既定は従来どおり非表示。
let mockLineLoginEnabled = false;
jest.mock('@/lib/line-availability', () => ({ isLineLoginEnabled: () => mockLineLoginEnabled }));
afterEach(() => { mockLineLoginEnabled = false; });

/** signupSchema が要求する必須項目をすべて有効な値で埋める。 */
function fillForm() {
  fireEvent.change(screen.getByLabelText(/^お名前/), { target: { value: 'テスト太郎' } });
  fireEvent.change(screen.getByLabelText(/^メールアドレス/), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText(/^電話番号/), { target: { value: '090-1234-5678' } });
  fireEvent.change(screen.getByLabelText(/^都道府県/), { target: { value: '東京都' } });
  // 「パスワード」と「パスワード（確認）」は前方一致だと曖昧になるため完全一致で区別する。
  fireEvent.change(screen.getByLabelText('パスワード *'), { target: { value: 'password123' } });
  fireEvent.change(screen.getByLabelText('パスワード（確認） *'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /利用規約/ }));
}

function submit() {
  // 掲載申込の続き（redirect=/admin/onboarding 等）では「店舗アカウントを作成」と表示する。
  fireEvent.click(screen.getByRole('button', { name: /^(新規登録|店舗アカウントを作成)$/ }));
}

test('native autofill is protected from accidental reload without storing the draft', () => {
  const storage = jest.spyOn(Storage.prototype, 'setItem');
  render(<SignupPage />);
  const empty = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(empty);
  expect(empty.defaultPrevented).toBe(false);
  // Autofill need not emit a React change event.
  (screen.getByLabelText(/^お名前/) as HTMLInputElement).value = '合成担当者';
  const leaving = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);
  expect(storage).not.toHaveBeenCalled();
  storage.mockRestore();
});

test('a failed submission retains the visible form and reload protection; confirmation releases it', async () => {
  mockSignUp.mockResolvedValueOnce({ data: { session: null, user: null }, error: { code: 'unexpected_failure' } });
  render(<SignupPage />);
  fillForm();
  submit();
  await screen.findByRole('alert');
  expect(screen.getByLabelText('パスワード *')).toHaveValue('password123');
  expect(screen.getByRole('checkbox', { name: /利用規約/ })).toBeChecked();
  const leaving = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);
  mockSignUp.mockResolvedValueOnce({ data: { session: null, user: { id: 'fixture' } }, error: null });
  submit();
  await screen.findByText('メールをご確認ください');
  const confirmed = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(confirmed);
  expect(confirmed.defaultPrevented).toBe(false);
});

test('OAuth can navigate immediately, but an OAuth failure restores input protection', async () => {
  const oauthDeparture = new Event('beforeunload', { cancelable: true });
  mockSignInWithOAuth.mockImplementationOnce(async () => {
    window.dispatchEvent(oauthDeparture);
    return { data: null, error: { message: 'synthetic rejection' } };
  });
  render(<SignupPage />);
  fillForm();
  fireEvent.click(screen.getByRole('button', { name: 'Googleで登録' }));
  await screen.findByRole('alert');
  expect(oauthDeparture.defaultPrevented).toBe(false);
  const failed = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(failed);
  expect(failed.defaultPrevented).toBe(true);
});

test('consented LINE submission releases protection and a back-forward restore reinstates it', () => {
  mockLineLoginEnabled = true;
  render(<SignupPage />);
  fillForm();
  fireEvent.submit(screen.getByTestId('signup-line-form'));
  const approvedDeparture = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(approvedDeparture);
  expect(approvedDeparture.defaultPrevented).toBe(false);
  fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }));
  const restored = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(restored);
  expect(restored.defaultPrevented).toBe(true);
});

test('the strength meter reflects typing and native autofill when the field is focused or left', async () => {
  render(<SignupPage />);
  const field = screen.getByLabelText('パスワード *') as HTMLInputElement;
  field.value = 'password123';
  fireEvent.focus(field);
  await waitFor(() => expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '低い'));
  field.value = 'maple canyon orbit violet';
  fireEvent.blur(field);
  expect(field).toHaveValue('maple canyon orbit violet');
  await waitFor(() => expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '高い'));
  fireEvent.input(field, { target: { value: 'password123' } });
  await waitFor(() => expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '低い'));
  expect(mockSignUp).not.toHaveBeenCalled();
});

test.each([{ reasons: ['pwned'] }, { reasons: ['length'] }, { reasons: ['characters'] }, { reasons: [] }, { reasons: ['future-reason'] }])(
  'a rejected password explains the server reason inline and permits a corrected retry ($reasons)', async ({ reasons }) => {
    const rejection = new AuthWeakPasswordError('Untrusted server text', 422, reasons);
    mockSignUp.mockResolvedValueOnce({ data: { session: null, user: null }, error: rejection });
    render(<SignupPage />);
    fillForm();
    submit();
    const message = describePasswordUpdateError(rejection).message;
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveAttribute('id', 'signup-password-error');
    expect(screen.getByLabelText('パスワード *')).toHaveFocus();
    expect(screen.getByLabelText('パスワード *')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('メールをご確認ください')).not.toBeInTheDocument();
    expect(screen.queryByText('Untrusted server text')).not.toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();

    mockSignUp.mockResolvedValueOnce({ data: { session: null, user: { id: 'fixture' } }, error: null });
    for (const label of ['パスワード *', 'パスワード（確認） *']) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: 'corrected-local-fixture' } });
    }
    submit();
    await screen.findByText('メールをご確認ください');
    expect(mockSignUp).toHaveBeenCalledTimes(2);
    expect(mockReplace).not.toHaveBeenCalled();
  },
);

test.each(['', 'previous-password'])('autofill without change events submits the visible fields instead of cached values (%s)', async (previousPassword) => {
  mockSignUp.mockResolvedValue({ data: { session: null, user: { id: 'fixture' } }, error: null });
  render(<SignupPage />);
  fillForm();
  for (const label of ['パスワード *', 'パスワード（確認） *']) {
    fireEvent.change(screen.getByLabelText(label), { target: { value: previousPassword } });
  }
  // Password managers can update native controls without emitting React change
  // events. These are synthetic unit-test values, never real credentials.
  (screen.getByLabelText('パスワード *') as HTMLInputElement).value = 'autofilled-fixture';
  (screen.getByLabelText('パスワード（確認） *') as HTMLInputElement).value = 'autofilled-fixture';
  submit();
  await screen.findByText('メールをご確認ください');
  expect(mockSignUp).toHaveBeenCalledWith(expect.objectContaining({ password: 'autofilled-fixture' }));
});

test('a leaked-password rejection is cleared when native autofill replaces that password', async () => {
  mockSignUp.mockResolvedValueOnce({ data: { session: null, user: null }, error: new AuthWeakPasswordError('fixture', 422, ['pwned']) });
  render(<SignupPage />);
  fillForm(); submit();
  await screen.findByRole('alert');
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '使用不可');
  const field = screen.getByLabelText('パスワード *') as HTMLInputElement;
  field.value = 'replacement-local-fixture';
  fireEvent.focus(field);
  await waitFor(() => expect(screen.getByRole('meter')).not.toHaveAttribute('aria-valuetext', '使用不可'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(mockSignUp).toHaveBeenCalledTimes(1);
});

test('a rejection for an earlier in-flight password does not mark the newly edited password as leaked', async () => {
  let finish!: (value: unknown) => void;
  mockSignUp.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<SignupPage />);
  fillForm(); submit();
  await waitFor(() => expect(mockSignUp).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText('パスワード *'), { target: { value: 'changed-during-request-fixture' } });
  await act(async () => finish({ data: { session: null, user: null }, error: new AuthWeakPasswordError('fixture', 422, ['pwned']) }));
  await screen.findByText('送信したパスワードは使用できません。変更後の内容でもう一度登録してください。');
  expect(screen.getByLabelText('パスワード *')).toHaveValue('changed-during-request-fixture');
  expect(screen.getByLabelText('パスワード *')).toHaveAttribute('aria-invalid', 'false');
  expect(screen.getByRole('meter')).not.toHaveAttribute('aria-valuetext', '使用不可');
});

test('native autofill reconciles identity fields before validation and Auth', async () => {
  mockSignUp.mockResolvedValue({ data: { session: null, user: { id: 'fixture' } }, error: null });
  render(<SignupPage />);
  fillForm();
  (screen.getByLabelText(/^お名前/) as HTMLInputElement).value = ' 表示中の担当者 ';
  (screen.getByLabelText(/^メールアドレス/) as HTMLInputElement).value = 'visible@example.invalid';
  (screen.getByLabelText(/^電話番号/) as HTMLInputElement).value = '０９２－１２３－４５６７';
  (screen.getByLabelText(/^都道府県/) as HTMLSelectElement).value = '福岡県';
  submit();
  await screen.findByText('メールをご確認ください');
  expect(mockSignUp).toHaveBeenCalledWith(expect.objectContaining({
    email: 'visible@example.invalid',
    options: expect.objectContaining({ data: { display_name: '表示中の担当者', phone: '092-123-4567', prefecture: '福岡県' } }),
  }));
});

test('native fields still reject mismatched passwords and a consent checkbox cleared without change events', async () => {
  render(<SignupPage />);
  fillForm();
  const confirm = screen.getByLabelText('パスワード（確認） *') as HTMLInputElement;
  confirm.value = 'different-fixture';
  submit();
  await screen.findByText('パスワードが一致しません');
  expect(mockSignUp).not.toHaveBeenCalled();
  confirm.value = 'password123';
  (screen.getByRole('checkbox', { name: /利用規約/ }) as HTMLInputElement).checked = false;
  submit();
  await screen.findByText('利用規約とプライバシーポリシーへの同意が必要です');
  expect(mockSignUp).not.toHaveBeenCalled();
});

test('SSR keeps signup controls and Google disabled until client handlers are installed', () => {
  const document = window.document.createElement('div');
  document.innerHTML = renderToString(<SignupPage />);
  expect(document.querySelector('#signup-name')).toBeDisabled();
  expect(document.querySelector('#signup-email')).toBeDisabled();
  expect(document.querySelector('#signup-terms')).toBeDisabled();
  expect(Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Googleで登録')).toBeDisabled();
  expect(mockGetUser).not.toHaveBeenCalled();
  expect(mockSignUp).not.toHaveBeenCalled();
});

test('email and Google registration require fresh explicit consent without calling Auth', async () => {
  render(<SignupPage />);fillForm();
  fireEvent.click(screen.getByRole('checkbox',{name:/利用規約/}));
  submit();await screen.findByText('利用規約とプライバシーポリシーへの同意が必要です');
  expect(mockSignUp).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Googleで登録'}));
  await screen.findByText('Googleで登録する場合も、利用規約とプライバシーポリシーへの同意が必要です。');
  expect(mockSignInWithOAuth).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/^メールアドレス/)).toHaveValue('test@example.com');
});
test('unsettled initial verification leaves signup usable and ignores a late user',async()=>{
 jest.useFakeTimers();let finish!: (value:unknown)=>void;
 mockGetUser.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));render(<SignupPage />);
 expect(screen.getByLabelText(/^メールアドレス/)).toBeEnabled();
 expect(screen.getByRole('button',{name:'Googleで登録'})).toBeEnabled();
 fireEvent.change(screen.getByLabelText(/^メールアドレス/),{target:{value:'retained@example.invalid'}});
 await act(async()=>{await jest.advanceTimersByTimeAsync(5000);});
 await act(async()=>{finish({data:{user:{id:'late'}}});await Promise.resolve();});
 expect(mockReplace).not.toHaveBeenCalled();expect(screen.getByLabelText(/^メールアドレス/)).toHaveValue('retained@example.invalid');
 expect(screen.getByRole('button',{name:'新規登録'})).toBeEnabled();
});

beforeEach(() => {
  // resetAllMocks: clearAllMocks と異なり mockResolvedValue 等の実装も消える。
  // 🔴 各テストで signUp の戻り値を明示的に設定させることで「既定値が session あり
  // のまま残って (ii) が偽陽性になる」事故（CLAUDE.md LineDeliveryOutcome 節と同種）を防ぐ。
  jest.resetAllMocks();
  // マウント時の useEffect が supabase.auth.getUser() を呼ぶ（未ログイン状態を既定にする）。
  mockGetUser.mockResolvedValue({ data: { user: null } });
  mockSearchParams = new URLSearchParams();
});

afterEach(() => jest.useRealTimers());

test('既登録の疑似user応答も送達を断定しない確認・ログイン導線へ送る', async () => {
  mockSignUp.mockResolvedValue({ data: { session: null, user: { identities: [] } }, error: null });
  render(<SignupPage />);
  fillForm(); submit();
  await screen.findByText('メールをご確認ください');
  expect(screen.getByRole('link', { name: '確認後、ログインして続ける' })).toBeVisible();
  expect(mockResend).not.toHaveBeenCalled();
});

test('email/Google共通の登録画面から利用規約とプライバシーポリシーを確認できる', () => {
  render(<SignupPage />);
  expect(screen.getByRole('link', { name: '利用規約' })).toHaveAttribute('href', '/terms');
  expect(screen.getByRole('link', { name: 'プライバシーポリシー' })).toHaveAttribute('href', '/privacy');
});

test('初期セッション確認の通信例外でも登録可能', async () => {
  mockGetUser.mockRejectedValue(new Error('network'));
  mockSignUp.mockResolvedValue({ data: { session: null, user: { id: 'fixture' } }, error: null });
  render(<SignupPage />);
  fillForm(); submit();
  await screen.findByText('メールをご確認ください');
});

test.each([false, true])('再送は60秒待機し、成功/失敗(%s)後も連打を防ぐ', async (fails) => {
  jest.useFakeTimers();
  mockSignUp.mockResolvedValue({ data: { session: null, user: { id: 'fixture' } }, error: null });
  mockResend.mockResolvedValue({ error: fails ? { message: 'private' } : null });
  render(<SignupPage />);
  fillForm(); submit();
  await screen.findByText('メールをご確認ください');
  expect(screen.getByRole('button', { name: '再送は1分後にできます' })).toBeDisabled();
  await act(async () => { jest.advanceTimersByTime(60_000); });
  const button = screen.getByRole('button', { name: '確認メールを再送する' });
  fireEvent.click(button); fireEvent.click(button);
  await act(async () => {});
  expect(mockResend).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '再送は1分後にできます' })).toBeDisabled();
  expect(screen.getByText(fails ? '再送を受け付けられませんでした。時間をおいてもう一度お試しください。' : '再送を受け付けました。確認が必要なアカウントにはメールが届きます。')).toBeVisible();
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(screen.getByRole('button', { name: '確認メールを再送する' })).toBeEnabled();
});

describe('/auth/signup', () => {
  it('(i) session あり（メール確認無効）→ router.replace が redirect 先で呼ばれる', async () => {
    mockSignUp.mockResolvedValue({
      data: { session: { access_token: 'tok' }, user: { id: 'u1' } },
      error: null,
    });

    render(<SignupPage />);
    fillForm();
    submit();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    // 呼ばれた引数まで検証する（redirect 未指定時の既定値 = DEFAULT_REDIRECT）。
    expect(mockReplace).toHaveBeenCalledWith('/mypage');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('(ii) session なし（メール確認有効）→ 過度な送達断定をせず確認待ち画面を出す', async () => {
    mockSignUp.mockResolvedValue({
      data: { session: null, user: { id: 'u1' } },
      error: null,
    });

    render(<SignupPage />);
    fillForm();
    submit();

    await screen.findByText('メールをご確認ください');
    // 偽陽性防止: 呼ばれていないことを明示的に主張する（呼び出し引数ではなく「呼ばれたか」自体）。
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('(iii) redirect=/admin/onboarding&facility_name=...&business_type=... → push 先にクエリが保持される', async () => {
    mockSearchParams = new URLSearchParams({
      redirect: '/admin/onboarding',
      facility_name: 'テスト施設',
      business_type: 'ヘアサロン',
    });
    mockSignUp.mockResolvedValue({
      data: { session: { access_token: 'tok' }, user: { id: 'u1' } },
      error: null,
    });

    render(<SignupPage />);
    fillForm();
    submit();

    const expectedParams = new URLSearchParams();
    expectedParams.set('facility_name', 'テスト施設');
    expectedParams.set('business_type', 'ヘアサロン');
    const expectedRedirect = `/admin/onboarding?${expectedParams.toString()}`;

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith(expectedRedirect);
  });

  it('(iii-nested) redirect に /admin/onboarding?facility_name=...&business_type=... がネストされている場合 → そのまま push 先になる（新形式・兄弟クエリのマージ処理は空振りする）', async () => {
    // 2026年8月20日〜: /register/complete・email.ts の受付/フォローメールは
    // src/lib/onboarding-link.ts の buildOnboardingAuthPath 経由で、facility_name/business_type を
    // 「redirect の兄弟」ではなく「redirect の中」に載せる形へ統一した（middleware.ts が
    // redirect の値しか転送しないため）。このテストはその新形式の入力を再現する。
    const nestedParams = new URLSearchParams();
    nestedParams.set('facility_name', 'ネスト施設');
    nestedParams.set('business_type', '整体');
    const nestedRedirect = `/admin/onboarding?${nestedParams.toString()}`;
    mockSearchParams = new URLSearchParams({ redirect: nestedRedirect });
    // 空振り防止: 本当に「トップレベルには redirect しか無い」入力になっているか
    // （＝下の (iii) の兄弟クエリ形とは別の形であること）を明示する。
    expect(mockSearchParams.get('facility_name')).toBeNull();
    expect(mockSearchParams.get('business_type')).toBeNull();

    mockSignUp.mockResolvedValue({
      data: { session: { access_token: 'tok' }, user: { id: 'u1' } },
      error: null,
    });

    render(<SignupPage />);
    fillForm();
    submit();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    // 兄弟クエリ用のマージ処理（facilityName || businessType のとき redirect を
    // 組み立て直す分岐）は発火しない（トップレベルに facility_name/business_type が無いため）。
    // それでも redirect 自体が既に onboarding パラメータを含んでいるので、
    // push 先には正しく facility_name/business_type が残っている。
    expect(mockReplace).toHaveBeenCalledWith(nestedRedirect);
  });

  it('(iv) redirect=/\\evil.com（旧ガードは通すがsafeRedirectは止める値）→ push 先は /mypage（負の対照）', async () => {
    // 旧ガード raw.startsWith('/') && !raw.startsWith('//') はこの値を素通りさせていた
    // （src/lib/safe-redirect.test.ts の「旧ガードが素通りさせていた値」と同じ入力）。
    mockSearchParams = new URLSearchParams({ redirect: '/\\evil.com' });
    // safeRedirect が本当にこの値を止める入力であることをテスト内で明示しておく
    // （safe-redirect.test.ts が検証済みの前提を、ここでも空振り防止として確認する）。
    expect(new URL('/\\evil.com', 'https://carelink-jp.com').origin).not.toBe('https://carelink-jp.com');

    mockSignUp.mockResolvedValue({
      data: { session: { access_token: 'tok' }, user: { id: 'u1' } },
      error: null,
    });

    render(<SignupPage />);
    fillForm();
    submit();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith('/mypage');
  });

  it('(v) already registered エラー → 既登録と送達を断定せず確認待ち導線を出す', async () => {
    mockSignUp.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'User already registered', name: 'AuthApiError', status: 422 },
    });

    render(<SignupPage />);
    fillForm();
    submit();

    await screen.findByText('メールをご確認ください');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('(v-対照) already registered 以外のエラー → 失敗トーストが出て push されない', async () => {
    mockSignUp.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'Network error', name: 'AuthApiError', status: 500 },
    });

    render(<SignupPage />);
    fillForm();
    submit();

    await screen.findByText(/登録処理の結果を確認できませんでした/);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('(vi) signUp が通信例外 → 画面上で中立な失敗案内・pushされない', async () => {
    mockSignUp.mockRejectedValue(new Error('network unavailable'));

    render(<SignupPage />);
    fillForm();
    submit();

    await screen.findByText(/登録処理の結果を確認できませんでした/);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('(vii) Google OAuth 起動のエラー → 画面上で案内する', async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: { message: 'provider unavailable' } });

    render(<SignupPage />);
    fireEvent.click(screen.getByRole('checkbox', { name: /利用規約/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Googleで登録' }));

    await screen.findByText(/Googleでの登録を開始できませんでした/);
  });
});

describe('店舗アカウント作成（掲載申込の続き）', () => {
  test.each([
    '/admin/onboarding?handoff=registration', '/register/recover', '/admin/onboarding?handoff=recovered',
  ])('redirect=%s は来院者向けの登録に見せない', async redirect => {
    mockSearchParams = new URLSearchParams({ redirect });
    render(<SignupPage />);
    expect(screen.getByRole('heading', { level: 1, name: '店舗アカウントの作成' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: '新規登録' })).not.toBeInTheDocument();
    expect(screen.getByText('申込と同じメールアドレスで作成してください')).toBeVisible();
    expect(screen.queryByRole('link', { name: '施設を探す' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '店舗アカウントを作成' })).toBeInTheDocument();
    // バックエンドが使う必須項目（電話番号・都道府県）は残す
    expect(screen.getByLabelText(/^電話番号/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^都道府県/)).toBeInTheDocument();
    await waitFor(() => expect(mockGetUser).toHaveBeenCalled());
  });
  test('来院者の新規登録は従来どおり（負の対照）', async () => {
    mockSearchParams = new URLSearchParams({ redirect: '/mypage/bookings' });
    render(<SignupPage />);
    expect(screen.getByRole('heading', { level: 1, name: '新規登録' })).toBeInTheDocument();
    expect(screen.queryByText('申込と同じメールアドレスで作成してください')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '施設を探す' })).toBeInTheDocument();
    await waitFor(() => expect(mockGetUser).toHaveBeenCalled());
  });
  test('SSR でも h1 が出る（見出しの fallback）', () => {
    mockSearchParams = new URLSearchParams({ redirect: '/register/recover' });
    expect(renderToString(<SignupPage />)).toMatch(/<h1[^>]*>(新規登録|店舗アカウントの作成)<\/h1>/);
  });
  test('確認メール送信後は送信先を示し、同じ戻り先でこのタブからログインして続けられる', async () => {
    mockSearchParams = new URLSearchParams({ redirect: '/admin/onboarding?handoff=registration' });
    mockSignUp.mockResolvedValue({ data: { session: null, user: { id: 'u1' } }, error: null });
    render(<SignupPage />);
    fillForm(); submit();
    await screen.findByText('メールをご確認ください');
    expect(screen.getByTestId('signup-sent-to')).toHaveTextContent('test@example.com');
    expect(screen.getByRole('link', { name: '確認後、ログインして続ける' }))
      .toHaveAttribute('href', `/auth/login?redirect=${encodeURIComponent('/admin/onboarding?handoff=registration')}`);
    expect(mockSignUp.mock.calls[0][0].options.emailRedirectTo)
      .toContain(`/auth/callback?redirect=${encodeURIComponent('/admin/onboarding?handoff=registration')}`);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

test('LINE registration requires the same terms consent as Google before leaving the page', async () => {
  mockLineLoginEnabled = true;
  render(<SignupPage />);
  const form = screen.getByTestId('signup-line-form');
  // fireEvent.submit は preventDefault されたとき false を返す（=送信しない）。
  expect(fireEvent.submit(form)).toBe(false);
  await screen.findByText('LINEで登録する場合も、利用規約とプライバシーポリシーへの同意が必要です。');
  fireEvent.click(screen.getByRole('checkbox', { name: /利用規約/ }));
  expect(fireEvent.submit(form)).toBe(true);
});

/**
 * 同意は URL ではなく、同一オリジンのフォーム POST で渡す（サーバーが CSRF を検証する）。
 * URL で渡していた版は、公開された同意マーカー付きの /api/auth/line を直接開く・共有するだけで
 * 同意なしに新規アカウントが作れた（PR#793 レビュー P2）。
 */
test('LINE registration is a same-origin POST form whose consent is filled only after the terms checkbox', () => {
  mockLineLoginEnabled = true;
  mockSearchParams = new URLSearchParams({ redirect: '/mypage/bookings' });
  render(<SignupPage />);
  const button = screen.getByRole('button', { name: 'LINEで登録' });
  const form = button.closest('form')!;
  expect(form).toBe(screen.getByTestId('signup-line-form'));
  expect(form.getAttribute('method')).toBe('post');
  expect(form.getAttribute('action')).toBe('/api/auth/line');
  expect(button).toHaveAttribute('type', 'submit');
  // ログイン・登録の開始に GET のリンクを使わない（URL は誰でも作れる）。
  expect(screen.queryByRole('link', { name: 'LINEで登録' })).not.toBeInTheDocument();
  expect(document.querySelector('a[href*="/api/auth/line"]')).toBeNull();

  const fields = () => Object.fromEntries(new FormData(form).entries());
  expect(fields()).toEqual({ redirect: '/mypage/bookings', intent: 'signup', consent: '' });

  fireEvent.click(screen.getByRole('checkbox', { name: /利用規約/ }));
  expect(fields()).toEqual({ redirect: '/mypage/bookings', intent: 'signup', consent: 'agreed' });

  fireEvent.click(screen.getByRole('checkbox', { name: /利用規約/ }));
  expect(fields()).toEqual({ redirect: '/mypage/bookings', intent: 'signup', consent: '' });
});

test('the signup page never ships the server-side terms-edition marker', () => {
  const { LINE_SIGNUP_CONSENT_MARKER } = jest.requireActual('@/lib/line-oauth');
  const source = require('fs').readFileSync(require('path').join(process.cwd(), 'src/app/auth/signup/page.tsx'), 'utf8');
  expect(source).not.toContain('LINE_SIGNUP_CONSENT_MARKER');
  mockLineLoginEnabled = true;
  const { container } = render(<SignupPage />);
  fireEvent.click(screen.getByRole('checkbox', { name: /利用規約/ }));
  expect(container.innerHTML).not.toContain(LINE_SIGNUP_CONSENT_MARKER);
});

test('LINE registration cannot be submitted while email signup is in flight', async () => {
  mockLineLoginEnabled = true;
  mockSignUp.mockReturnValue(new Promise(() => {}));
  render(<SignupPage />);
  fillForm(); submit();
  const button = screen.getByRole('button', { name: 'LINEで登録' });
  await waitFor(() => expect(button).toBeDisabled());
  expect(fireEvent.submit(screen.getByTestId('signup-line-form'))).toBe(false);
  expect(screen.queryByText('LINEで登録する場合も、利用規約とプライバシーポリシーへの同意が必要です。')).not.toBeInTheDocument();
});

test('callback refusal without consent shows a clear Japanese message on the signup page', () => {
  mockSearchParams = new URLSearchParams({ error: 'line_consent_required', redirect: '/mypage' });
  render(<SignupPage />);
  expect(screen.getByTestId('signup-line-consent-required'))
    .toHaveTextContent('LINEで登録するには、利用規約・プライバシーポリシーへの同意が必要です');
  expect(screen.getByTestId('signup-line-consent-required')).toHaveAttribute('role', 'alert');
});

test('signup page shows no LINE consent message without the error code', () => {
  mockSearchParams = new URLSearchParams({ error: 'something_else' });
  render(<SignupPage />);
  expect(screen.queryByTestId('signup-line-consent-required')).not.toBeInTheDocument();
});

test('signup shows the same password rule as reset and rejects a password over the 72-byte bcrypt limit', async () => {
  render(<SignupPage />);
  expect(screen.getByText(/8文字以上で入力してください。よく使われるパスワード/)).toHaveAttribute('id', 'signup-password-help');
  fillForm();
  fireEvent.change(screen.getByLabelText('パスワード *'), { target: { value: 'あ'.repeat(25) } });
  fireEvent.change(screen.getByLabelText('パスワード（確認） *'), { target: { value: 'あ'.repeat(25) } });
  submit();
  await screen.findByText(/パスワードが長すぎます/);
  expect(mockSignUp).not.toHaveBeenCalled();
});

/**
 * 外部登録（Google・LINE）の同意エラーは、同意欄の直下に出して欄へ移る。
 * 以前は画面上部に固定のトーストで出しており、スマホでは文句を言っている同意欄そのものを覆っていた。
 */
describe('external signup consent errors are shown inline under the checkbox', () => {
  test.each([
    ['Google', 'Googleで登録する場合も、利用規約とプライバシーポリシーへの同意が必要です。'],
    ['LINE', 'LINEで登録する場合も、利用規約とプライバシーポリシーへの同意が必要です。'],
  ])('%s: inline error, focus on the checkbox, no toast; checking it clears the error', async (provider, message) => {
    mockLineLoginEnabled = true;
    const scroll = jest.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      render(<SignupPage />);
      const checkbox = screen.getByRole('checkbox', { name: /利用規約/ });
      if (provider === 'Google') fireEvent.click(screen.getByRole('button', { name: 'Googleで登録' }));
      else expect(fireEvent.submit(screen.getByTestId('signup-line-form'))).toBe(false);
      const error = await screen.findByText(message);
      expect(error).toHaveAttribute('id', 'signup-terms-error');
      expect(error).toHaveAttribute('role', 'alert');
      expect(checkbox).toHaveAttribute('aria-invalid', 'true');
      expect(checkbox).toHaveAttribute('aria-describedby', 'signup-terms-error');
      expect(document.activeElement).toBe(checkbox);
      expect(scroll).toHaveBeenCalledWith({ block: 'center' });
      // トースト（画面上部に固定表示＝同意欄を覆う）は出さない。
      expect(screen.getAllByRole('alert')).toEqual([error]);
      expect(mockSignInWithOAuth).not.toHaveBeenCalled();
      fireEvent.click(checkbox);
      await waitFor(() => expect(screen.queryByText(message)).not.toBeInTheDocument());
      expect(checkbox).not.toHaveAttribute('aria-invalid', 'true');
    } finally { Element.prototype.scrollIntoView = original; }
  });
});

/**
 * 低速回線ではフォームが fallback の後から届く。カードを縦中央寄せにしていると、その瞬間に見出しごと
 * カード全体が跳ねていた（実測 CLS 0.115）。上寄せにして、伸びるのはカードの下端だけにする。
 */
test('the signup card is top-aligned and the form placeholder reserves the form height', () => {
  const html = renderToString(<SignupPage />);
  const shell = html.match(/class="([^"]*)" data-testid="signup-shell"/)?.[1].split(/\s+/) ?? [];
  expect(shell).toContain('items-start');
  expect(shell).not.toContain('items-center');
  const source: string = jest.requireActual<typeof import('fs')>('fs')
    .readFileSync(jest.requireActual<typeof import('path')>('path').join(process.cwd(), 'src/app/auth/signup/page.tsx'), 'utf8');
  const placeholder = source.match(/<div className="min-h-\[(\d+)px\]" data-testid="signup-form-placeholder" \/>/);
  expect(Number(placeholder?.[1])).toBeGreaterThanOrEqual(600);
});

test('shop-account mode labels the in-flight submit with the glossary term, not 登録中', async () => {
  mockSearchParams = new URLSearchParams({ redirect: '/admin/onboarding?handoff=registration' });
  mockSignUp.mockReturnValue(new Promise(() => {}));
  try {
    render(<SignupPage />);
    fillForm(); submit();
    expect(await screen.findByRole('button', { name: '店舗アカウントを作成中...' })).toBeDisabled();
    expect(screen.queryByText('登録中...')).not.toBeInTheDocument();
  } finally { mockSearchParams = new URLSearchParams(); }
});
