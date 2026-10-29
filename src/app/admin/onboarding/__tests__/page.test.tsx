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
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import OnboardingPage from '../page';
import { AuthSessionMissingError } from '@supabase/supabase-js';
import { SALON_BROWSER_CONTEXT_KEY, SALON_RECOVERY_CONTEXT_KEY, salonHandoffAuthPath, SALON_RECOVERY_SELECT_PATH,
  SALON_ONBOARDING_PATH, SALON_RECOVERY_ONBOARDING_PATH } from '@/lib/salon-browser-context';
import { navigateAfterFacilitySetup } from '@/lib/onboarding-navigation';
jest.mock('@/lib/onboarding-navigation', () => ({ navigateAfterFacilitySetup: jest.fn() }));

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockRouter = { push: mockPush, replace: mockReplace };
// jest.mock ファクトリから参照するため `mock` プレフィックス必須（babel-plugin-jest-hoist）。
// テストごとに useSearchParams の戻り値を差し替えられるよう let で保持する。
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));

const mockGetUser = jest.fn();
const mockMaybeSingle = jest.fn();
const mockLimit = jest.fn();
const mockOrder = jest.fn();
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
  fireEvent.click(screen.getByRole('button', { name: '店舗を作成する' }));
}

beforeEach(() => {
  // resetAllMocks: clearAllMocks と異なり mockResolvedValue 等の実装も消える。
  // 🔴 jest.fn(() => ...) で与えた「初期実装」も reset で失われるため、
  // from/select/eq のチェーンも含めて毎回明示的に組み直す
  // （既定値が undefined のまま残って supabase.from(...) が undefined を返し、
  // 意図しない TypeError で全テストが偽陽性の green にならないようにするため）。
  jest.resetAllMocks();
  window.sessionStorage.clear();
  mockSearchParams = new URLSearchParams();
  mockEq.mockImplementation(() => ({ maybeSingle: mockMaybeSingle, order: mockOrder }));
  mockOrder.mockImplementation(() => ({ limit: mockLimit }));
  mockLimit.mockImplementation(() => ({ maybeSingle: mockMaybeSingle }));
  mockSelect.mockImplementation(() => ({ eq: mockEq }));
  mockFrom.mockImplementation(() => ({ select: mockSelect }));
  // 既定＝ログイン済み・施設未所持（onboarding フォームに到達する主経路）。
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  // 🔴 fetch の既定を「呼ばれたら成功」にしておくと、(i) の主張（呼ばれない）が
  // 失敗時にも偽陽性で緑になりかねないため、成功レスポンスを明示しつつ
  // 呼び出し有無そのものを assert する（詳細は各テスト参照）。
  mockFetch.mockResolvedValue({
    ok: true, json: async () => ({ success: true, facilityId: '11111111-1111-4111-8111-111111111111' }),
  });
  global.fetch = mockFetch as unknown as typeof fetch;
});

describe('verified recovery handoff', () => {
  const recoveryId='b2000000-0000-4000-8000-000000000001';
  const summary={state:'confirmed',receiptId:'b1000000-0000-4000-8000-000000000001',name:'Original recovered branch',type:'ヘアサロン',address:'Original address'};
  function context() {
    mockSearchParams=new URLSearchParams({handoff:'recovered',facility_name:'Untrusted query'});
    window.sessionStorage.setItem(SALON_RECOVERY_CONTEXT_KEY,JSON.stringify({version:1,recoveryId}));
    mockFetch.mockResolvedValue({ok:true,json:async()=>summary});
  }
  test('summary never creates; original fields are immutable and explicit license/button create',async()=>{
    context();mockMaybeSingle.mockResolvedValue({data:{facility_id:'already-owned'},error:null});render(<OnboardingPage/>);
    expect(await screen.findByLabelText(/店舗名/)).toHaveValue(summary.name);
    expect(screen.queryByText(/ここで作成すると、申込の写真/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/店舗名/)).toBeDisabled();expect(screen.getByLabelText(/業種/)).toBeDisabled();
    expect(mockFetch).toHaveBeenCalledTimes(1);expect(mockReplace).not.toHaveBeenCalled();
    expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({action:'summary',recoveryId});
    submit();expect(mockFetch).toHaveBeenCalledTimes(1);
    fillLicenseCheckbox();mockFetch.mockResolvedValue({ok:true,json:async()=>({success:true,facilityId:summary.receiptId})});
    submit();await waitFor(()=>expect(navigateAfterFacilitySetup).toHaveBeenCalledTimes(1));
    expect(mockReplace).not.toHaveBeenCalled();
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({facility_name:summary.name,business_type:summary.type,license_warranted:true,recoveryId});
  });
  test.each([null,{...summary,state:'unverified'},{...summary,address:2},{...summary,receiptId:'bad'}])('invalid summary never becomes direct setup %#',async body=>{
    context();mockFetch.mockResolvedValue({ok:true,json:async()=>body});render(<OnboardingPage/>);
    await screen.findByText('店舗情報の確認に失敗しました。通信環境を確認して再読み込みしてください');
    expect(mockFetch).toHaveBeenCalledTimes(1);expect(mockReplace).not.toHaveBeenCalled();
    expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
  });
  test('missing recovery selector fails closed and sends the owner to choose the application again',async()=>{
    context();window.sessionStorage.clear();render(<OnboardingPage/>);
    await waitFor(()=>expect(mockReplace).toHaveBeenCalledWith(SALON_RECOVERY_SELECT_PATH));
    expect(mockFetch).not.toHaveBeenCalled();expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
    expect(screen.queryByText(/通信環境を確認して再読み込み/)).not.toBeInTheDocument();
  });
  test('expired login while reading the recovered summary offers login back to the same handoff',async()=>{
    context();mockFetch.mockResolvedValue({ok:false,status:401,json:async()=>({error:'認証が必要です'})});render(<OnboardingPage/>);
    expect(await screen.findByText('ログインの有効期限が切れました')).toBeVisible();
    expect(screen.queryByText('認証が必要です')).not.toBeInTheDocument();
    expect(screen.getByRole('link',{name:'ログインして続ける'})).toHaveAttribute('href',`/auth/login?redirect=${encodeURIComponent(SALON_RECOVERY_ONBOARDING_PATH)}`);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  test('changed selector cannot submit a different receipt',async()=>{
    context();render(<OnboardingPage/>);await screen.findByLabelText(/店舗名/);fillLicenseCheckbox();window.sessionStorage.clear();submit();
    expect(mockFetch).toHaveBeenCalledTimes(1);expect(mockReplace).not.toHaveBeenCalled();
    expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
  });
});

describe('selected registration handoff', () => {
  const intentId = '74000000-0000-4000-8000-000000000001';
  const receiptId = '74000000-0000-4000-8000-000000000002';
  const summary = { state: 'confirmed', receiptId, name: '選択した合成店舗', type: 'ヘアサロン', area: '合成住所' };
  function context() {
    mockSearchParams = new URLSearchParams({ handoff: 'registration', facility_name: 'untrusted name' });
    window.sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY, JSON.stringify({ version: 1, intentId, phase: 'confirmed' }));
    mockFetch.mockResolvedValue({ ok: true, json: async () => summary });
  }
  test('unauthenticated redirect keeps only the handoff mode, never applicant data', async () => {
    context(); mockGetUser.mockResolvedValue({ data: { user: null } });
    render(<OnboardingPage />);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(salonHandoffAuthPath('login')));
    expect(mockFetch).not.toHaveBeenCalled();
  });
  test('existing membership cannot hide an unconsumed selected receipt', async () => {
    context(); mockMaybeSingle.mockResolvedValue({ data: { facility_id: 'existing' }, error: null });
    render(<OnboardingPage />);
    expect(await screen.findByLabelText(/店舗名/)).toHaveValue(summary.name);
    // 既に店舗の管理者なら admin レイアウトのヘッダー（ログアウト）があるので、最小ヘッダーは重ねない。
    expect(screen.queryByTestId('onboarding-header')).not.toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/salons/summary');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ intentId });
    fillLicenseCheckbox();
    mockFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: 'ALREADY_MEMBER', error: '今回の申込は取り込んでいません。' }) });
    submit();
    await screen.findByText('今回の申込は取り込んでいません。');
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ facility_name: summary.name,
      business_type: summary.type, license_warranted: true, intentId });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
  });
  // 🔴 確認メールのリンクは新しいタブ・別ブラウザで開くので、申込タブの受付情報はここで必ず失われる。
  // 以前は「通信環境を確認して再読み込み」を永久に出していた。施設は作らず、申込の選び直しへ自動で送る。
  test.each(['missing', 'broken'])('missing/corrupt selector never becomes direct onboarding and routes to recovery %s', async value => {
    context();
    if (value === 'missing') window.sessionStorage.clear();
    else window.sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY, '{');
    render(<OnboardingPage />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(SALON_RECOVERY_SELECT_PATH));
    expect(SALON_RECOVERY_SELECT_PATH).toBe('/register/recover?from=handoff');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
    expect(screen.queryByText(/通信環境を確認して再読み込み/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '店舗を作成する' })).not.toBeInTheDocument();
  });
  test.each([
    [{ state: 'unverified' }, 403], [{ state: 'expired' }, 200],
  ])('receipt proof missing in this browser or expired intent routes to recovery %#', async (body, status) => {
    context(); mockFetch.mockResolvedValue({ ok: status === 200, status, json: async () => body });
    render(<OnboardingPage />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(SALON_RECOVERY_SELECT_PATH));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '店舗を作成する' })).not.toBeInTheDocument();
  });
  test('login expiring before the create POST shows a login button back to the same handoff, not 認証が必要です', async () => {
    context(); render(<OnboardingPage />);
    await screen.findByLabelText(/店舗名/); fillLicenseCheckbox();
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: '認証が必要です' }) });
    submit();
    expect(await screen.findByText('ログインの有効期限が切れました')).toBeVisible();
    expect(screen.queryByText('認証が必要です')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '再読み込みして登録状況を確認' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ログインして続ける' }))
      .toHaveAttribute('href', `/auth/login?redirect=${encodeURIComponent(SALON_ONBOARDING_PATH)}`);
    expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
  });
  test.each([
    { ...summary, state: 'uncommitted' }, { ...summary, name: '' }, { ...summary, name: 'x'.repeat(201) },
    { ...summary, type: 'invalid' }, { ...summary, receiptId: 'bad' }, { ...summary, name: 1 },
  ])('unverified/malformed receipt cannot enable setup %#', async value => {
    context(); mockFetch.mockResolvedValue({ ok: true, json: async () => value });
    render(<OnboardingPage />);
    await screen.findByText('店舗情報の確認に失敗しました。通信環境を確認して再読み込みしてください');
    expect(mockFetch).toHaveBeenCalledTimes(1); expect(mockReplace).not.toHaveBeenCalled();
    expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
  });
  test('changing tab context while form is open prevents wrong-receipt submission', async () => {
    context(); render(<OnboardingPage />);
    await screen.findByLabelText(/店舗名/); fillLicenseCheckbox();
    window.sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY, JSON.stringify({ version: 1, intentId: receiptId, phase: 'confirmed' }));
    submit();
    await screen.findByText('引き継ぎ対象を確認できません。申込時の同じタブで受付完了画面を開いてください。');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('onboarding transport and membership recovery', () => {
  async function form() {
    mockSearchParams = new URLSearchParams({ facility_name: '合成施設', business_type: 'ヘアサロン' });
    const view = render(<OnboardingPage />);
    await screen.findByRole('button', { name: '店舗を作成する' });
    fillLicenseCheckbox();
    return view;
  }

  test('membership existence query has a one-row limit even for multi-facility operators', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { facility_id: '11111111-1111-4111-8111-111111111111' }, error: null });
    render(<OnboardingPage />);
    await waitFor(() => expect(navigateAfterFacilitySetup).toHaveBeenCalledTimes(1));
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockLimit).toHaveBeenCalledWith(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test.each([
    { ok: false, body: { success: true, facilityId: '11111111-1111-4111-8111-111111111111' } },
    { ok: true, body: { success: 'yes', facilityId: '11111111-1111-4111-8111-111111111111' } },
    { ok: true, body: { success: true } },
    { ok: true, body: { success: true, facilityId: 'not-a-uuid' } },
    { ok: true, body: null },
    { ok: false, body: { error: { internal: 'not displayable' } } },
  ])('does not turn invalid business/HTTP success into navigation %#', async ({ ok, body }) => {
    mockFetch.mockResolvedValue({ ok, json: async () => body });
    await form(); submit();
    // 作成済みの可能性がある応答は「エラー」ではなく「確認中」にし、再確認を利用者に委ねる。
    await screen.findByRole('button', { name: '作成状況を再確認' });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('expired login on a plain onboarding create offers login back to onboarding', async () => {
    await form();
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: '認証が必要です' }) });
    submit();
    expect(await screen.findByText('ログインの有効期限が切れました')).toBeVisible();
    expect(screen.getByRole('link', { name: 'ログインして続ける' })).toHaveAttribute('href', '/auth/login?redirect=%2Fadmin%2Fonboarding');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  test('broken JSON is an unknown result, not success or automatic resend', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => { throw new Error('invalid json'); } });
    await form(); submit();
    await screen.findByText('店舗の作成結果をまだ確認できていません。');
    expect(mockReplace).not.toHaveBeenCalled(); expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
  });

  test('HTTP202 preserves the explicit uncertain-result recovery instruction', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 202, json: async () => ({ code: 'SETUP_RESULT_UNKNOWN', error: '申込を新しく送信せず、同じ内容で確認してください。' }) });
    await form(); submit();
    await screen.findByText('申込を新しく送信せず、同じ内容で確認してください。');
    expect(mockReplace).not.toHaveBeenCalled(); expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
  });

  // 以前は 202（結果不明）でも「エラーが発生しました」と再読み込みボタンだけを出していた
  // （文言は「この画面から同じ内容で確認して」と言っているのに、確認する手段が無かった）。
  test('HTTP202 is a 確認中 state whose re-check resends the identical body once and follows the result', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({ code: 'SETUP_RESULT_UNKNOWN', error: '作成結果を確認できていません。' }) });
    await form(); submit();
    expect(await screen.findByRole('heading', { name: '店舗の作成結果を確認中です' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('作成結果を確認できていません。');
    expect(screen.queryByText('エラーが発生しました')).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, state: 'replay', facilityId: '11111111-1111-4111-8111-111111111111' }) });
    fireEvent.click(screen.getByRole('button', { name: '作成状況を再確認' }));
    await waitFor(() => expect(navigateAfterFacilitySetup).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toBe('/api/facility/setup');
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual(JSON.parse(mockFetch.mock.calls[0][1].body));
  });

  test('a re-check that is still unknown stays in 確認中 and never posts on its own', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'));
    await form(); submit();
    await screen.findByRole('button', { name: '作成状況を再確認' });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'Internal Server Error' }) });
    fireEvent.click(screen.getByRole('button', { name: '作成状況を再確認' }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: '作成状況を再確認' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('店舗の作成結果をまだ確認できていません。');
    expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('a definitive 4xx refusal stays an error with its message (nothing was created)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ code: 'HANDOFF_CONFLICT', error: 'この申込は取り込み済みです。' }) });
    await form(); submit();
    await screen.findByText('この申込は取り込み済みです。');
    expect(screen.queryByRole('button', { name: '作成状況を再確認' })).not.toBeInTheDocument();
  });

  // 店舗が無い人の管理画面には admin レイアウトのヘッダーが出ず、ログアウトできなかった。
  test('an owner without a store sees a minimal header with the account (logout) menu', async () => {
    await form();
    const header = screen.getByTestId('onboarding-header');
    expect(header).toContainElement(screen.getByRole('button', { name: 'アカウントメニュー' }));
    fireEvent.click(screen.getByRole('button', { name: 'アカウントメニュー' }));
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument();
  });

  test('network rejection leaves the spinner and offers status recheck without retrying POST', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    await form(); submit();
    await screen.findByText('店舗の作成結果をまだ確認できていません。');
    expect(screen.queryByText('店舗を作成しています...')).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test.each(['auth', 'membership'])('%s rejection leaves loading without registration', async source => {
    if (source === 'auth') mockGetUser.mockRejectedValue(new Error('network'));
    else mockMaybeSingle.mockRejectedValue(new Error('network'));
    render(<OnboardingPage />);
    await screen.findByText('店舗情報の確認に失敗しました。通信環境を確認して再読み込みしてください');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('SDK missing session redirects to login, while an actual auth error offers recheck', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    const first = render(<OnboardingPage />);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/auth/login?redirect=/admin/onboarding'));
    first.unmount(); mockPush.mockClear();
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('network') });
    render(<OnboardingPage />);
    await screen.findByRole('alert');
    expect(mockPush).not.toHaveBeenCalled(); expect(mockFetch).not.toHaveBeenCalled();
  });

  test('unmounted auth lookup cannot navigate or start a membership lookup', async () => {
    let resolve!: (value: unknown) => void;
    mockGetUser.mockReturnValue(new Promise(done => { resolve = done; }));
    const view = render(<OnboardingPage />); view.unmount();
    await act(async () => { resolve({ data: { user: null } }); });
    expect(mockPush).not.toHaveBeenCalled(); expect(mockFrom).not.toHaveBeenCalled();
  });

  test('unmounted membership lookup cannot navigate', async () => {
    let resolve!: (value: unknown) => void;
    mockMaybeSingle.mockReturnValue(new Promise(done => { resolve = done; }));
    const view = render(<OnboardingPage />);
    await waitFor(() => expect(mockMaybeSingle).toHaveBeenCalled());
    view.unmount();
    await act(async () => { resolve({ data: { facility_id: 'fixture' }, error: null }); });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
  });

  test('same-tick clicks dispatch only one POST', async () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    await form(); const button = screen.getByRole('button', { name: '店舗を作成する' });
    act(() => { button.click(); button.click(); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('late POST success after leaving the page does not hijack navigation', async () => {
    let resolve!: (value: unknown) => void;
    mockFetch.mockReturnValue(new Promise(done => { resolve = done; }));
    const view = await form(); submit(); view.unmount();
    await act(async () => { resolve({ ok: true, json: async () => ({ success: true,
      facilityId: '11111111-1111-4111-8111-111111111111' }) }); });
    expect(mockReplace).not.toHaveBeenCalled(); expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
  });

  test('a stalled POST times out as unknown, without another POST', async () => {
    mockFetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    await form();
    jest.useFakeTimers();
    try {
      submit();
      await act(async () => { await jest.advanceTimersByTimeAsync(29999); });
      expect(screen.getByText('店舗を作成しています...')).toBeInTheDocument();
      await act(async () => { await jest.advanceTimersByTimeAsync(1); });
      expect(screen.getByText('店舗の作成結果をまだ確認できていません。')).toBeInTheDocument();
      expect(mockFetch).toHaveBeenCalledTimes(1); expect(mockReplace).not.toHaveBeenCalled();
      expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
  });
});

describe('/admin/onboarding', () => {
  it('(i) クエリに facility_name/business_type が揃っていても、ユーザー操作が無ければ fetch は呼ばれない', async () => {
    mockSearchParams = new URLSearchParams({
      facility_name: '悪意のある施設名',
      business_type: 'ヘアサロン',
    });

    render(<OnboardingPage />);

    // フォーム画面に落ちることを確認してから、操作せずに待つ。
    await screen.findByRole('button', { name: '店舗を作成する' });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('(ii) クエリの facility_name / business_type がフォームの初期値に入る', async () => {
    mockSearchParams = new URLSearchParams({
      facility_name: 'テストサロン',
      business_type: 'ネイル・まつげサロン',
    });

    render(<OnboardingPage />);

    const nameInput = (await screen.findByLabelText(/店舗名/)) as HTMLInputElement;
    expect(nameInput.value).toBe('テストサロン');

    const select = screen.getByLabelText(/業種/) as HTMLSelectElement;
    expect(select.value).toBe('ネイル・まつげサロン');
  });

  it('(iii) 許認可チェックが未チェックだと送信できない（fetch は呼ばれない）', async () => {
    mockSearchParams = new URLSearchParams({
      facility_name: 'テストサロン',
      business_type: 'ヘアサロン',
    });

    render(<OnboardingPage />);
    await screen.findByRole('button', { name: '店舗を作成する' });

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
    await screen.findByRole('button', { name: '店舗を作成する' });

    fillLicenseCheckbox();
    submit();

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith('/api/facility/setup', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        facility_name: 'テストサロン',
        business_type: 'ヘアサロン',
        license_warranted: true,
      }),
    }));

    await waitFor(() => expect(navigateAfterFacilitySetup).toHaveBeenCalledTimes(1));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('(vii) 送信 body に license_warranted: true が載る（許認可表明の送信証跡・2026年8月20日）', async () => {
    mockSearchParams = new URLSearchParams({
      facility_name: 'テストサロン',
      business_type: 'ヘアサロン',
    });

    render(<OnboardingPage />);
    await screen.findByRole('button', { name: '店舗を作成する' });

    fillLicenseCheckbox();
    submit();

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const [, init] = mockFetch.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody).toHaveProperty('license_warranted', true);
  });

  it('(v) 既に facility_members を持つユーザーはフォームを見ずに /admin へ replace される', async () => {
    mockSearchParams = new URLSearchParams({
      facility_name: 'テストサロン',
      business_type: 'ヘアサロン',
    });
    mockMaybeSingle.mockResolvedValue({ data: { facility_id: 'f1' }, error: null });

    render(<OnboardingPage />);

    await waitFor(() => expect(navigateAfterFacilitySetup).toHaveBeenCalledTimes(1));
    expect(mockReplace).not.toHaveBeenCalled();

    // フォームは一度も出ず、確認なしPOSTも起きない。
    expect(screen.queryByRole('button', { name: '店舗を作成する' })).not.toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('(vi) business_type が正規値でない場合もフォームに落ちる（既存の挙動を壊していない）', async () => {
    mockSearchParams = new URLSearchParams({
      facility_name: 'テストサロン',
      business_type: '美容サロン・アイラッシュ', // 旧デフォルト値＝非正規値
    });

    render(<OnboardingPage />);

    const nameInput = (await screen.findByLabelText(/店舗名/)) as HTMLInputElement;
    expect(nameInput.value).toBe('テストサロン');

    const select = screen.getByLabelText(/業種/) as HTMLSelectElement;
    // 非正規値はフォームへ流し込まず、未選択のまま選び直させる。
    expect(select.value).toBe('');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('(iv) 引き継ぎ無しの作成フォームでも、送信済みの申込がある人を作成前に復旧画面へ案内する（古い案内メールのリンク対策）', async () => {
    // 2026年10月22日: 申込者へのフォローメールは以前この画面へ直接リンクしていた。ここで作ると
    // 申込内容を取り込まない空の店舗になり、後から復旧しても ALREADY_MEMBER で取り込めない。
    mockSearchParams = new URLSearchParams({ facility_name: 'テストサロン', business_type: 'ヘアサロン' });
    render(<OnboardingPage />);
    const link = await screen.findByRole('link', { name: '掲載申込の続きへ' });
    expect(link).toHaveAttribute('href', '/register/recover');
    expect(screen.getByText(/ここで作成すると、申込の写真・営業時間・PR文などは引き継がれません/)).toBeInTheDocument();
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

    await screen.findByText('店舗情報の確認に失敗しました。通信環境を確認して再読み込みしてください');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('verified registration automatic publication', () => {
 const intentId='74000000-0000-4000-8000-000000000011';
 const receiptId='74000000-0000-4000-8000-000000000012';
 const facilityId='74000000-0000-4000-8000-000000000013';
 const summary={state:'confirmed',receiptId,name:'合成店舗',type:'ヘアサロン',area:'合成住所',autoPublication:true};
 beforeEach(()=>{
  process.env.NEXT_PUBLIC_REGISTRATION_AUTO_PUBLISH='true';
  mockSearchParams=new URLSearchParams({handoff:'registration'});
  window.sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY,JSON.stringify({version:1,intentId,phase:'confirmed'}));
  mockGetUser.mockResolvedValue({data:{user:{id:'u1',email_confirmed_at:'2026-10-29T00:00:00Z'}}});
 });
 afterEach(()=>{delete process.env.NEXT_PUBLIC_REGISTRATION_AUTO_PUBLISH;});
 test('only the confirmed selected receipt is set up and published',async()=>{
  mockFetch.mockResolvedValueOnce({ok:true,json:async()=>summary})
   .mockResolvedValueOnce({ok:true,json:async()=>({success:true,facilityId})});
  render(<OnboardingPage/>);
  await waitFor(()=>expect(navigateAfterFacilitySetup).toHaveBeenCalledWith(facilityId));
  expect(mockFetch.mock.calls.map(call=>call[0])).toEqual(['/api/salons/summary','/api/facility/setup']);
  expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({facility_name:summary.name,business_type:summary.type,license_warranted:true,intentId});
  expect(window.sessionStorage.getItem(`carelink-registration-auto-attempt:${intentId}`)).toBeNull();
 });
 test('a lost response is never automatically resent after a reload',async()=>{
  window.sessionStorage.setItem(`carelink-registration-auto-attempt:${intentId}`,'attempted');
  mockFetch.mockResolvedValueOnce({ok:true,json:async()=>summary});
  render(<OnboardingPage/>);
  await screen.findByRole('button',{name:'作成状況を再確認'});
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
 });
 test('email not confirmed cannot start publication',async()=>{
  mockGetUser.mockResolvedValue({data:{user:{id:'u1',email_confirmed_at:null}}});
  mockFetch.mockResolvedValueOnce({ok:true,json:async()=>summary});
  render(<OnboardingPage/>);
  await screen.findByText('申込に使用したメールアドレスの確認を完了してください。');
  expect(mockFetch).toHaveBeenCalledTimes(1);
 });
 test('a historical receipt without a marker still needs explicit setup',async()=>{
  mockFetch.mockResolvedValueOnce({ok:true,json:async()=>({...summary,autoPublication:false})});
  render(<OnboardingPage/>);
  await screen.findByLabelText(/店舗名/);
  expect(mockFetch).toHaveBeenCalledTimes(1);
 });
});

describe('automatic publication recovery and failure fences', () => {
 const intentId='74000000-0000-4000-8000-000000000021';
 const recoveryId='74000000-0000-4000-8000-000000000022';
 const receiptId='74000000-0000-4000-8000-000000000023';
 const facilityId='74000000-0000-4000-8000-000000000024';
 const summary={state:'confirmed',receiptId,name:'合成店舗',type:'ヘアサロン',area:'住所',address:'住所',autoPublication:true};
 beforeEach(()=>{process.env.NEXT_PUBLIC_REGISTRATION_AUTO_PUBLISH='true';mockGetUser.mockResolvedValue({data:{user:{id:'u1',email_confirmed_at:'2026-10-29T00:00:00Z'}}});});
 afterEach(()=>{delete process.env.NEXT_PUBLIC_REGISTRATION_AUTO_PUBLISH;jest.restoreAllMocks();});
 function intent() {
  mockSearchParams=new URLSearchParams({handoff:'registration'});
  window.sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY,JSON.stringify({version:1,intentId,phase:'confirmed'}));
 }
 test('verified recovery also publishes its selected receipt',async()=>{
  mockSearchParams=new URLSearchParams({handoff:'recovered'});
  window.sessionStorage.setItem(SALON_RECOVERY_CONTEXT_KEY,JSON.stringify({version:1,recoveryId}));
  mockFetch.mockResolvedValueOnce({ok:true,json:async()=>summary}).mockResolvedValueOnce({ok:true,json:async()=>({success:true,facilityId})});
  render(<OnboardingPage/>);await waitFor(()=>expect(navigateAfterFacilitySetup).toHaveBeenCalledWith(facilityId));
  expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({facility_name:summary.name,business_type:summary.type,license_warranted:true,recoveryId});
 });
 test('a rejected setup clears the attempt fence and does not navigate',async()=>{
  intent();mockFetch.mockResolvedValueOnce({ok:true,json:async()=>summary}).mockResolvedValueOnce({ok:false,status:403,json:async()=>({error:'申込を確認できません'})});
  render(<OnboardingPage/>);await screen.findByText('申込を確認できません');
  expect(window.sessionStorage.getItem(`carelink-registration-auto-attempt:${intentId}`)).toBeNull();
  expect(navigateAfterFacilitySetup).not.toHaveBeenCalled();
 });
 test('a lost setup reply keeps the fence until the user explicitly retries',async()=>{
  intent();mockFetch.mockResolvedValueOnce({ok:true,json:async()=>summary}).mockRejectedValueOnce(new Error('lost'))
   .mockResolvedValueOnce({ok:true,json:async()=>({success:true,facilityId})});
  render(<OnboardingPage/>);const retry=await screen.findByRole('button',{name:'作成状況を再確認'});
  expect(window.sessionStorage.getItem(`carelink-registration-auto-attempt:${intentId}`)).toBe('attempted');
  expect(mockFetch).toHaveBeenCalledTimes(2);fireEvent.click(retry);
  await waitFor(()=>expect(navigateAfterFacilitySetup).toHaveBeenCalledWith(facilityId));
  expect(mockFetch).toHaveBeenCalledTimes(3);
 });
 test('cannot start the mutation if the local attempt fence cannot be saved',async()=>{
  intent();mockFetch.mockResolvedValueOnce({ok:true,json:async()=>summary});
  const original=Storage.prototype.setItem;
  jest.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){if(key.startsWith('carelink-registration-auto-attempt:'))throw new Error('storage');return original.call(this,key,value);});
  render(<OnboardingPage/>);await screen.findByText('掲載の準備を確認できません。入力と申込を保持して、もう一度お試しください。');
  expect(mockFetch).toHaveBeenCalledTimes(1);
 });
 test('a changed selected receipt cannot be published',async()=>{
  intent();let finish!: (value: unknown)=>void;
  mockFetch.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  render(<OnboardingPage/>);await waitFor(()=>expect(mockFetch).toHaveBeenCalledTimes(1));
  window.sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY,JSON.stringify({version:1,intentId:receiptId,phase:'confirmed'}));
  finish({ok:true,json:async()=>summary});
  await screen.findByText('店舗情報の確認に失敗しました。通信環境を確認して再読み込みしてください');
  expect(mockFetch).toHaveBeenCalledTimes(1);
 });
 test('query-only onboarding is never auto-submitted even when feature is enabled',async()=>{
  mockSearchParams=new URLSearchParams({facility_name:'Untrusted',business_type:'ヘアサロン'});
  render(<OnboardingPage/>);await screen.findByLabelText(/店舗名/);
  expect(mockFetch).not.toHaveBeenCalled();
 });
});
