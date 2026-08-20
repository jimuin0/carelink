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
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SignupPage from '../page';

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
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      signUp: (...args: unknown[]) => mockSignUp(...args),
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
  }),
}));

/** signupSchema が要求する必須項目をすべて有効な値で埋める。 */
function fillForm() {
  fireEvent.change(screen.getByLabelText(/^お名前/), { target: { value: 'テスト太郎' } });
  fireEvent.change(screen.getByLabelText(/^メールアドレス/), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText(/^電話番号/), { target: { value: '090-1234-5678' } });
  fireEvent.change(screen.getByLabelText(/^都道府県/), { target: { value: '東京都' } });
  // 「パスワード」と「パスワード（確認）」は前方一致だと曖昧になるため完全一致で区別する。
  fireEvent.change(screen.getByLabelText('パスワード *'), { target: { value: 'password123' } });
  fireEvent.change(screen.getByLabelText('パスワード（確認） *'), { target: { value: 'password123' } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
}

beforeEach(() => {
  // resetAllMocks: clearAllMocks と異なり mockResolvedValue 等の実装も消える。
  // 🔴 各テストで signUp の戻り値を明示的に設定させることで「既定値が session あり
  // のまま残って (ii) が偽陽性になる」事故（CLAUDE.md LineDeliveryOutcome 節と同種）を防ぐ。
  jest.resetAllMocks();
  // マウント時の useEffect が supabase.auth.getUser() を呼ぶ（未ログイン状態を既定にする）。
  mockGetUser.mockResolvedValue({ data: { user: null } });
  mockSearchParams = new URLSearchParams();
});

describe('/auth/signup', () => {
  it('(i) session あり（メール確認無効）→ router.push が redirect 先で呼ばれる', async () => {
    mockSignUp.mockResolvedValue({
      data: { session: { access_token: 'tok' }, user: { id: 'u1' } },
      error: null,
    });

    render(<SignupPage />);
    fillForm();
    submit();

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    // 呼ばれた引数まで検証する（redirect 未指定時の既定値 = DEFAULT_REDIRECT）。
    expect(mockPush).toHaveBeenCalledWith('/mypage');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('(ii) session なし（メール確認有効）→ router.push は呼ばれず確認メール文言が出る', async () => {
    mockSignUp.mockResolvedValue({
      data: { session: null, user: { id: 'u1' } },
      error: null,
    });

    render(<SignupPage />);
    fillForm();
    submit();

    await screen.findByText(/確認メールを送信しました/);
    // 偽陽性防止: 呼ばれていないことを明示的に主張する（呼び出し引数ではなく「呼ばれたか」自体）。
    expect(mockPush).not.toHaveBeenCalled();
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

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(mockPush).toHaveBeenCalledWith(expectedRedirect);
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

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(mockPush).toHaveBeenCalledWith('/mypage');
  });

  it('(v) already registered エラー → アカウント列挙対策どおり成功トーストのまま・push されない', async () => {
    mockSignUp.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'User already registered', name: 'AuthApiError', status: 422 },
    });

    render(<SignupPage />);
    fillForm();
    submit();

    await screen.findByText(/確認メールを送信しました/);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('(v-対照) already registered 以外のエラー → 失敗トーストが出て push されない', async () => {
    mockSignUp.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'Network error', name: 'AuthApiError', status: 500 },
    });

    render(<SignupPage />);
    fillForm();
    submit();

    await screen.findByText(/登録に失敗しました/);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
