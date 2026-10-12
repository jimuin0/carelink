/** @jest-environment node */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => false, mutationRateLimit: null }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: () => null }));
jest.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [] }) }));
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'fa120000-0000-4000-8000-000000000001' } }, error: null }) } }) }));
jest.mock('@/lib/notification-settings', () => ({ getFacilityNotificationSettings: async () => ({ pushOnReview: false }) }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
const mockInsert = jest.fn();
let mockFailureTable: string | null;
let mockInsertError: unknown;
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({
  from: (table: string) => {
    const result = () => ({ data: table === 'profiles' ? null : [], error: table === mockFailureTable ? { code: '522' } : null });
    const chain = { eq: () => chain, gte: () => chain, select: () => chain, limit: async () => result(), maybeSingle: async () => result() };
    return { ...chain, insert: (...args: unknown[]) => { mockInsert(...args); return { select: () => ({ single: async () => ({ data: mockInsertError ? null : { id: 'fa120002-0000-4000-8000-000000000001' }, error: mockInsertError }) }) }; } };
  },
}) }));
import { POST } from '../route';
const body = { facility_id: 'fa120001-0000-4000-8000-000000000001', reviewer_name: 'Synthetic', rating_skill: 4, rating_service: 4, rating_atmosphere: 4, rating_cleanliness: 4, rating_explanation: 4 };
const request = () => new Request('http://localhost/api/review', { method: 'POST', headers: { 'X-CareLink-Review-Consumer': '1' }, body: JSON.stringify(body) });
beforeEach(() => { jest.clearAllMocks(); mockFailureTable = null; mockInsertError = null; delete process.env.RECAPTCHA_SECRET_KEY; process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'; });
test.each(['profiles','facility_reviews','bookings'])('failed %s observation never grants an anonymous name, duplicate permission, or unverified visit fallback', async table => {
  mockFailureTable = table;
  const response = await POST(request()); expect(response.status).toBe(500);
  expect(response.headers.get('X-CareLink-Review-Commit')).toBe('not-started'); expect(mockInsert).not.toHaveBeenCalled();
});
test('transaction rejects an observed concurrent duplicate', async () => {
  mockInsertError = { code: 'P0001', message: 'REVIEW_RECENT_DUPLICATE' };
  expect((await POST(request())).status).toBe(429);
});
test('a failed insert reply never grants permission to retry an unknown commit', async () => {
  mockInsertError = { code: '522', message: 'lost commit reply' };
  const response = await POST(request()); expect(response.status).toBe(500);
  expect(response.headers.get('X-CareLink-Review-Commit')).not.toBe('not-started');
});
