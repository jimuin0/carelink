/**
 * @jest-environment jsdom
 *
 * /admin/onboarding 回帰テスト（2026年8月20日・無確認クエリ自動POSTの根治）。
 *
 * 旧実装は URL クエリに facility_name があり business_type が正規タクソノミー内なら、
 * ユーザー操作を1回も挟まずに POST /api/facility/setup を撃っていた。
 * `https://carelink-jp.com/admin/onboarding?facility_name=任意&business_type=<正規値>` を
 * ログイン済み・施設未所持の一般利用者に踏ませるだけで、その人の権限で施設が作られ
 * facility_members に owner として登録されてしまう欠陥だった（CSRF は Origin 一致のみで
 * 自サイト内リンクは通過し、middleware も /admin/onboarding をメンバーシップ判定から
 * 除外しているため止まらない）。加えて自動POST経路は handleFormSubmit が必須にしている
 * licenseWarranted（許認可・届出の表明）を一度も見せずに施設を作っていた。
 *
 * 🔴 CLAUDE.md の LineDeliveryOutcome 節と同じ教訓: 「戻り値/フラグを変えても
 * `if (ok)` は素通りする。分岐の【結果】を主張する検査を書くこと」。
 * ここでは fetch が【呼ばれたか／呼ばれなかったか】を直接 assert する
 * （呼び出し引数だけを見るテストにはしない）。(i) は負の対照として、自動POSTへ
 * 戻すと必ず赤くなることを実際に確認している（詳細は呼び出し元への報告を参照）。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OnboardingPage from '../page';

const mockPush = jest.fn();
const mockReplace = jest.fn();
// jest.mock ファクトリから参照するため `mock` プレフィックス必須（babel-plugin-jest-hoist）。
// テストごとに useSearchParams の戻り値を差し替えられるよう let で保持する。
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

const mockGetUser = jest.fn();
const mockMaybeSingle = jest.fn();
const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ select: mockSelect }));

jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

const mockFetch = jest.fn();

function fillLicenseCheckbox() {
  fireEvent.click(screen.getByRole('checkbox'));
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: '施設を作成する' }));
}

beforeEach(() => {
  // resetAllMocks: clearAllMocks と異なり mockResolvedValue 等の実装も消える。
  // 🔴 jest.fn(() => ...) で与えた「初期実装」も reset で失われるため、
  // from/select/eq のチェーンも含めて毎回明示的に組み直す
  // （既定値が undefined のまま残って supabase.from(...) が undefined を返し、
  // 意図しない TypeError で全テストが偽陽性の green にならないようにするため）。
  jest.resetAllMocks();
  mockSearchParams = new URLSearchParams();
  mockEq.mockImplementation(() => ({ maybeSingle: mockMaybeSingle }));
  mockSelect.mockImplementation(() => ({ eq: mockEq }));
  mockFrom.mockImplementation(() => ({ select: mockSelect }));
  // 既定＝ログイン済み・施設未所持（onboarding フォームに到達する主経路）。
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  // 🔴 fetch の既定を「呼ばれたら成功」にしておくと、(i) の主張（呼ばれない）が
  // 失敗時にも偽陽性で緑になりかねないため、成功レスポンスを明示しつつ
  // 呼び出し有無そのものを assert する（詳細は各テスト参照）。
  mockFetch.mockResolvedValue({
    json: async () => ({ success: true }),
  });
  global.fetch = mockFetch as unknown as typeof fetch;
});

describe('/admin/onboarding', () => {
  it('(i) クエリに facility_name/business_type が揃っていても、ユーザー操作が無ければ fetch は呼ばれない', async () => {
    mockSearchParams = new URLSearchParams({
      facility_name: '悪意のある施設名',
      business_type: 'ヘアサロン',
    });

    render(<OnboardingPage />);

    // フォーム画面に落ちることを確認してから、操作せずに待つ。
    await screen.findByRole('button', { name: '施設を作成する' });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('(ii) クエリの facility_name / business_type がフォームの初期値に入る', async () => {
    mockSearchParams = new URLSearchParams({
      facility_name: 'テストサロン',
      business_type: 'ネイル・まつげサロン',
    });

    render(<OnboardingPage />);

    const nameInput = (await screen.findByLabelText(/施設名/)) as HTMLInputElement;
    expect(nameInput.value).toBe('テストサロン');

    const select = screen.getByLabelText(/業態/) as HTMLSelectElement;
    expect(select.value).toBe('ネイル・まつげサロン');
  });

  it('(iii) 許認可チェックが未チェックだと送信できない（fetch は呼ばれない）', async () => {
    mockSearchParams = new URLSearchParams({
      facility_name: 'テストサロン',
      business_type: 'ヘアサロン',
    });

    render(<OnboardingPage />);
    await screen.findByRole('button', { name: '施設を作成する' });

    // licenseWarranted は未チェックのまま送信する。
    submit();

    await screen.findByText('許認可・届出に関する表明にチェックしてください');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('(iv) 送信ボタンを押すと POST され、成功で /admin へ遷移する', async () => {
    mockSearchParams = new URLSearchParams({
      facility_name: 'テストサロン',
      business_type: 'ヘアサロン',
    });

    render(<OnboardingPage />);
    await screen.findByRole('button', { name: '施設を作成する' });

    fillLicenseCheckbox();
    submit();

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith('/api/facility/setup', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        facility_name: 'テストサロン',
        business_type: 'ヘアサロン',
      }),
    }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/admin'));
  });

  it('(v) 既に facility_members を持つユーザーはフォームを見ずに /admin へ replace される', async () => {
    mockSearchParams = new URLSearchParams({
      facility_name: 'テストサロン',
      business_type: 'ヘアサロン',
    });
    mockMaybeSingle.mockResolvedValue({ data: { facility_id: 'f1' }, error: null });

    render(<OnboardingPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/admin'));

    // フォームは一度も出ず、確認なしPOSTも起きない。
    expect(screen.queryByRole('button', { name: '施設を作成する' })).not.toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('(vi) business_type が正規値でない場合もフォームに落ちる（既存の挙動を壊していない）', async () => {
    mockSearchParams = new URLSearchParams({
      facility_name: 'テストサロン',
      business_type: '美容サロン・アイラッシュ', // 旧デフォルト値＝非正規値
    });

    render(<OnboardingPage />);

    const nameInput = (await screen.findByLabelText(/施設名/)) as HTMLInputElement;
    expect(nameInput.value).toBe('テストサロン');

    const select = screen.getByLabelText(/業態/) as HTMLSelectElement;
    // 非正規値はフォームへ流し込まず、未選択のまま選び直させる。
    expect(select.value).toBe('');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('未認証時は /auth/login へ push される', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    render(<OnboardingPage />);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/auth/login?redirect=/admin/onboarding'));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('facility_members 取得失敗時はエラー表示になり fetch は呼ばれない', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'network' } });

    render(<OnboardingPage />);

    await screen.findByText('施設情報の確認に失敗しました。通信環境を確認して再読み込みしてください');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
