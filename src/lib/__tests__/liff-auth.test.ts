/**
 * @jest-environment node
 */
import { getBearerToken, resolveLiffUserId } from '@/lib/liff-auth';

jest.mock('@/lib/line', () => ({ verifyLineAccessToken: jest.fn() }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: jest.fn() }));

import { verifyLineAccessToken } from '@/lib/line';
import { createServiceRoleClient } from '@/lib/supabase-server';

const mockVerify = verifyLineAccessToken as jest.MockedFunction<typeof verifyLineAccessToken>;
const mockCreateAdmin = createServiceRoleClient as jest.MockedFunction<typeof createServiceRoleClient>;

function adminReturning(data: unknown) {
  return {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data }),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof createServiceRoleClient>;
}

describe('getBearerToken', () => {
  function reqWith(headers: Record<string, string>) {
    return new Request('http://localhost/x', { headers });
  }
  it('Authorization 無し → null', () => {
    expect(getBearerToken(reqWith({}))).toBeNull();
  });
  it('Bearer 以外のスキーム → null', () => {
    expect(getBearerToken(reqWith({ Authorization: 'Basic abc' }))).toBeNull();
  });
  it('Bearer トークンを取り出す', () => {
    expect(getBearerToken(reqWith({ Authorization: 'Bearer tok123' }))).toBe('tok123');
  });
});

describe('resolveLiffUserId', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('空トークン → null（audience 検証を呼ばない）', async () => {
    expect(await resolveLiffUserId('')).toBeNull();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('audience 検証 NG → null（profile を取りに行かない）', async () => {
    mockVerify.mockResolvedValue({ ok: false });
    global.fetch = jest.fn() as unknown as typeof fetch;
    expect(await resolveLiffUserId('tok')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('profile 取得 HTTP NG → null', async () => {
    mockVerify.mockResolvedValue({ ok: true });
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    expect(await resolveLiffUserId('tok')).toBeNull();
  });

  it('profile に userId が無い → null', async () => {
    mockVerify.mockResolvedValue({ ok: true });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }) as unknown as typeof fetch;
    expect(await resolveLiffUserId('tok')).toBeNull();
  });

  it('未連携（profiles に該当行なし）→ null', async () => {
    mockVerify.mockResolvedValue({ ok: true });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ userId: 'U1' }) }) as unknown as typeof fetch;
    mockCreateAdmin.mockReturnValue(adminReturning(null));
    expect(await resolveLiffUserId('tok')).toBeNull();
  });

  it('正常解決 → user_id を返す', async () => {
    mockVerify.mockResolvedValue({ ok: true });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ userId: 'U1' }) }) as unknown as typeof fetch;
    mockCreateAdmin.mockReturnValue(adminReturning({ id: 'app-user-1' }));
    expect(await resolveLiffUserId('tok')).toBe('app-user-1');
  });
});
