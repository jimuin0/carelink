/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */

const mockAgent = jest.fn();
jest.mock('undici', () => ({ Agent: mockAgent }));

import { createPublicReadFetch, createServiceReadFetch } from '../public-read-transport';

const originalFetch = global.fetch;
const mockFetch = jest.fn();
const pool = { synthetic: 'connection-pool' };

beforeEach(() => {
  mockFetch.mockReset().mockResolvedValue(new Response('[]'));
  mockAgent.mockImplementation(() => pool);
  global.fetch = mockFetch;
});
afterAll(() => { global.fetch = originalFetch; });

it('shares a bounded socket pool across concurrent clients without caching responses', async () => {
  const first = createPublicReadFetch('https://public.example.test');
  const second = createPublicReadFetch('https://public.example.test');
  const signal = new AbortController().signal;
  const init = { headers: { apikey: 'synthetic-public-key' }, signal, cache: 'no-store' as const };
  await Promise.all([
    first('https://public.example.test/rest/v1/facilities', init),
    second(new URL('https://public.example.test/rest/v1/facilities'), init),
  ]);
  expect(mockAgent).toHaveBeenCalledTimes(1);
  expect(mockAgent).toHaveBeenCalledWith({ connections: 4, pipelining: 1, allowH2: false,
    keepAliveTimeout: 60_000, keepAliveMaxTimeout: 60_000 });
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(mockFetch).toHaveBeenNthCalledWith(1, 'https://public.example.test/rest/v1/facilities',
    { ...init, dispatcher: pool });
  expect(init).not.toHaveProperty('dispatcher');
});

it('preserves HEAD requests, method overrides and every per-request header', async () => {
  const read = createPublicReadFetch('https://public.example.test');
  const request = new Request('https://public.example.test/rest/v1/facilities', { method: 'HEAD' });
  await read(request);
  expect(mockFetch).toHaveBeenLastCalledWith(request, { dispatcher: pool });
  const init = { method: 'head', headers: { Authorization: 'Bearer synthetic-anon' } };
  await read('https://public.example.test/rest/v1/facilities', init);
  expect(mockFetch).toHaveBeenLastCalledWith('https://public.example.test/rest/v1/facilities',
    { ...init, dispatcher: pool });
});

it.each([
  ['https://another.example.test/rest/v1/facilities', undefined],
  ['https://public.example.test/auth/v1/user', undefined],
  ['https://public.example.test/rest/v1/facilities', { method: 'POST' }],
  ['https://public.example.test/rest/v1/facilities', { method: 'PATCH' }],
  ['https://public.example.test/rest/v1/facilities', { method: 'DELETE' }],
])('leaves other origins, authentication and writes unchanged: %s %j', async (input, init) => {
  await createPublicReadFetch('https://public.example.test')(input, init);
  expect(mockFetch).toHaveBeenCalledWith(input, init);
});

it('preserves abort and network failures without retries or stale fallback data', async () => {
  const failure = new Error('synthetic transport failure');
  mockFetch.mockRejectedValue(failure);
  await expect(createPublicReadFetch('https://public.example.test')(
    'https://public.example.test/rest/v1/facilities',
  )).rejects.toBe(failure);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('trusted read sockets are separate, while headers remain request-local and every result is fetched', async () => {
  const privatePool = { synthetic: 'private-pool' };
  mockAgent.mockImplementationOnce(() => privatePool);
  const first = createServiceReadFetch('https://public.example.test');
  const second = createServiceReadFetch('https://public.example.test');
  const publicRead = createPublicReadFetch('https://public.example.test');
  const privateHeaders = { Authorization: 'Bearer synthetic-service-only' };
  await Promise.all([
    first('https://public.example.test/rest/v1/bookings', { headers: privateHeaders }),
    second('https://public.example.test/rest/v1/bookings', { method: 'HEAD' }),
    publicRead('https://public.example.test/rest/v1/facilities'),
  ]);
  expect(mockFetch).toHaveBeenCalledWith('https://public.example.test/rest/v1/bookings',
    { headers: privateHeaders, dispatcher: privatePool });
  expect(mockFetch).toHaveBeenCalledWith('https://public.example.test/rest/v1/bookings',
    { method: 'HEAD', dispatcher: privatePool });
  expect(mockFetch).toHaveBeenCalledWith('https://public.example.test/rest/v1/facilities', { dispatcher: pool });
  expect(mockFetch).toHaveBeenCalledTimes(3);
  expect(privateHeaders).toEqual({ Authorization: 'Bearer synthetic-service-only' });
});

it.each([
  ['https://public.example.test/rest/v1/bookings', { method: 'POST' }],
  ['https://public.example.test/auth/v1/admin/users', { method: 'GET' }],
  ['https://other.example.test/rest/v1/bookings', { method: 'GET' }],
])('trusted-read opt-in does not reroute writes, auth or other origins: %s', async (url, init) => {
  await createServiceReadFetch('https://public.example.test')(url, init);
  expect(mockFetch).toHaveBeenCalledWith(url, init);
});
