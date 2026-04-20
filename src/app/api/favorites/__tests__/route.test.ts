/**
 * @jest-environment node
 */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: null,
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));

const mockGetUser = jest.fn();
const mockFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));
jest.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: jest.fn() }),
}));

import { POST } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
});

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Host: 'localhost' },
    body: JSON.stringify(body),
  });
}

function fluent(resolvedValue: unknown) {
  const self: Record<string, jest.Mock> = {};
  const handler = jest.fn(() => self);
  self.select = handler;
  self.eq = handler;
  self.delete = jest.fn(() => self);
  self.insert = jest.fn(() => Promise.resolve({ error: null }));
  self.maybeSingle = jest.fn(() => Promise.resolve(resolvedValue));
  return self;
}

describe('POST /api/favorites', () => {
  const validFacilityId = '123e4567-e89b-12d3-a456-426614174000';

  test('お気に入り追加（既存なし→insert）', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return fluent({ data: { id: validFacilityId } }); // facility published check
      if (callNum === 2) return fluent({ data: null }); // existing favorites check
      // insert chain: from('favorites').insert({...})
      return { insert: jest.fn(() => Promise.resolve({ error: null })) };
    });

    const res = await POST(makeRequest({ facilityId: validFacilityId }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.isFavorited).toBe(true);
  });

  test('お気に入り解除（既存あり→delete）', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return fluent({ data: { id: validFacilityId } }); // facility published check
      if (callNum === 2) return fluent({ data: { id: 'fav-1' } }); // existing favorites check
      // delete chain: from('favorites').delete().eq('id', existing.id)
      return { delete: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })) };
    });

    const res = await POST(makeRequest({ facilityId: validFacilityId }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.isFavorited).toBe(false);
  });

  test('認証なし→401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(makeRequest({ facilityId: validFacilityId }));
    expect(res.status).toBe(401);
  });

  test('不正なfacilityId→400', async () => {
    const res = await POST(makeRequest({ facilityId: 'invalid' }));
    expect(res.status).toBe(400);
  });

  test('CSRF失敗→403', async () => {
    const { NextResponse } = jest.requireActual('next/server') as { NextResponse: typeof import('next/server').NextResponse };
    (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({ error: 'CSRF' }, { status: 403 }));

    const res = await POST(makeRequest({ facilityId: validFacilityId }));
    expect(res.status).toBe(403);
  });

  test('レートリミット→429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(makeRequest({ facilityId: validFacilityId }));
    expect(res.status).toBe(429);
  });
});
