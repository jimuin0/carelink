/**
 * @jest-environment node
 *
 * Tests for lib/supabase-server-auth.ts
 * Covers the inner cookie callbacks (getAll, setAll, forEach lambda)
 * by using a createServerClient mock that actually invokes the provided config.
 */

jest.mock('next/headers');
jest.mock('@supabase/ssr');

import { createServerSupabaseAuthClient } from '../supabase-server-auth';

describe('createServerSupabaseAuthClient', () => {
  const mockGetAll = jest.fn().mockReturnValue([{ name: 'sb-token', value: 'abc', path: '/' }]);
  const mockSet = jest.fn();
  const mockCookieStore = { getAll: mockGetAll, set: mockSet };

  const mockAuthClient = { auth: { getUser: jest.fn() }, from: jest.fn() };

  let capturedCookiesConfig: {
    getAll: () => unknown[];
    setAll: (v: { name: string; value: string; options: unknown }[]) => void;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    const { cookies } = require('next/headers');
    cookies.mockResolvedValue(mockCookieStore);

    const { createServerClient } = require('@supabase/ssr');
    createServerClient.mockImplementation(
      (_url: string, _key: string, config: typeof capturedCookiesConfig extends unknown ? { cookies: typeof capturedCookiesConfig } : never) => {
        // Capture and immediately invoke callbacks to exercise them
        capturedCookiesConfig = config.cookies as typeof capturedCookiesConfig;
        return mockAuthClient;
      }
    );

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  });

  test('returns a supabase client', async () => {
    const client = await createServerSupabaseAuthClient();
    expect(client).toBe(mockAuthClient);
  });

  test('getAll callback delegates to cookieStore.getAll()', async () => {
    await createServerSupabaseAuthClient();
    const result = capturedCookiesConfig.getAll();
    expect(result).toEqual([{ name: 'sb-token', value: 'abc', path: '/' }]);
    expect(mockGetAll).toHaveBeenCalled();
  });

  test('setAll callback calls cookieStore.set() for each cookie', async () => {
    await createServerSupabaseAuthClient();
    const cookies = [
      { name: 'a', value: '1', options: { path: '/' } },
      { name: 'b', value: '2', options: { httpOnly: true } },
    ];
    capturedCookiesConfig.setAll(cookies);
    expect(mockSet).toHaveBeenCalledWith('a', '1', { path: '/' });
    expect(mockSet).toHaveBeenCalledWith('b', '2', { httpOnly: true });
  });

  test('setAll silently ignores errors (Server Component restriction)', async () => {
    await createServerSupabaseAuthClient();
    mockSet.mockImplementation(() => { throw new Error('Cannot set cookies in Server Component'); });
    // Should not throw
    expect(() => capturedCookiesConfig.setAll([{ name: 'x', value: 'y', options: {} }])).not.toThrow();
  });

  test('setAll with empty array does not call cookieStore.set()', async () => {
    await createServerSupabaseAuthClient();
    capturedCookiesConfig.setAll([]);
    expect(mockSet).not.toHaveBeenCalled();
  });
});
