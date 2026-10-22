/** @jest-environment node */
import AuthLandingPage from '../page';

// 戻り先を付けずにログインした店舗オーナーが /mypage（来院者画面）に固定されていた不具合の回帰テスト。
// 振り分けはサーバー側で facility_members の owner/admin 行を確かめて行う。
const mockGetUser = jest.fn();
const mockMembership = jest.fn();
const mockCreate = jest.fn();
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: () => mockCreate() }));
jest.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));

function client() {
  return {
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => ({ select: () => ({ eq: (_c: string, userId: string) => ({ in: (_r: string, roles: string[]) => ({
      limit: () => ({ maybeSingle: async () => mockMembership(table, userId, roles) }),
    }) }) }) }),
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockCreate.mockImplementation(async () => client());
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
});

async function landing(): Promise<string> {
  try { await AuthLandingPage(); } catch (error) { return (error as Error).message; }
  throw new Error('no redirect');
}

test('owner/admin の店舗を持つアカウントは /admin へ', async () => {
  mockMembership.mockResolvedValue({ data: { role: 'owner' }, error: null });
  expect(await landing()).toBe('redirect:/admin');
  expect(mockMembership).toHaveBeenCalledWith('facility_members', 'u1', ['owner', 'admin']);
});

test('来院者（店舗なし）は従来どおり /mypage', async () => {
  mockMembership.mockResolvedValue({ data: null, error: null });
  expect(await landing()).toBe('redirect:/mypage');
});

test('所属を確認できないときは来院者側へ倒す', async () => {
  mockMembership.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
  expect(await landing()).toBe('redirect:/mypage');
  mockCreate.mockRejectedValue(new Error('cookies unavailable'));
  expect(await landing()).toBe('redirect:/mypage');
});

test('未ログインはログイン画面へ（戻り先なし＝ループしない）', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  expect(await landing()).toBe('redirect:/auth/login');
  expect(mockMembership).not.toHaveBeenCalled();
});
