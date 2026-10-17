/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient } from '@supabase/supabase-js';
import { searchAreaFacilities } from '../area-facilities';
const mockFetch = jest.fn();
jest.mock('../supabase-server', () => ({ createServerSupabaseClient: () => createClient(
  'https://area-verification.example.invalid', 'synthetic-anon-key',
  { global: { fetch: mockFetch }, auth: { persistSession: false, autoRefreshToken: false } },
) }));

beforeEach(() => jest.clearAllMocks());

test.each([0, 1, 20])('real SDK decodes 416 then a scoped HEAD count %s without parsing error text', async total => {
  mockFetch.mockImplementation(async (_url, init) => init.method === 'HEAD'
    ? new Response(null, { status: 200, headers: { 'Content-Range': `*/${total}` } })
    : new Response(JSON.stringify({ code: 'PGRST103', message: 'Requested range not satisfiable', details: 'not used' }),
      { status: 416, headers: { 'Content-Range': `*/${total}`, 'Content-Type': 'application/json' } }));
  await expect(searchAreaFacilities({ kind: 'city', prefecture: '大阪府', city: '堺市堺区' }, 2))
    .resolves.toEqual({ facilities: [], total, perPage: 20 });
  expect(mockFetch).toHaveBeenCalledTimes(2);
  const calls = mockFetch.mock.calls;
  expect(calls.map(([, init]) => init.method)).toEqual(['GET', 'HEAD']);
  for (const [url] of calls) {
    const params = new URL(url).searchParams;
    expect(params.get('status')).toBe('eq.published');
    expect(params.get('prefecture')).toBe('eq.大阪府');
    expect(params.get('city')).toBe('eq.堺市堺区');
  }
  expect(new URL(calls[0][0]).searchParams.get('offset')).toBe('20');
  expect(new URL(calls[1][0]).searchParams.has('offset')).toBe(false);
});

test('recount HTTP failure remains a failure, not a successful empty page', async () => {
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'PGRST103' }), { status: 416 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: '42501' }), { status: 403 }));
  await expect(searchAreaFacilities({ kind: 'prefecture', prefecture: '大阪府' }, 2)).rejects.toThrow('Area facilities unavailable');
});
