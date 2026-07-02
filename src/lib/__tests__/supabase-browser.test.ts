/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */

const mockCreateBrowserClient = jest.fn().mockReturnValue({ from: jest.fn() });

jest.mock('@supabase/ssr', () => ({
  createBrowserClient: (...args: unknown[]) => mockCreateBrowserClient(...args),
}));

const origEnv = process.env;

beforeEach(() => {
  mockCreateBrowserClient.mockClear();
  process.env = {
    ...origEnv,
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-test',
  };
});

afterAll(() => {
  process.env = origEnv;
});

describe('createBrowserSupabaseClient', () => {
  it('creates browser client with anon key', () => {
    jest.isolateModules(() => {
      const { createBrowserSupabaseClient } = require('../supabase-browser');
      createBrowserSupabaseClient();
      expect(mockCreateBrowserClient).toHaveBeenCalledWith(
        'https://test.supabase.co',
        'anon-key-test'
      );
    });
  });

  it('returns the same singleton instance on repeated calls (no duplicate GoTrueClient)', () => {
    jest.isolateModules(() => {
      const { createBrowserSupabaseClient } = require('../supabase-browser');
      const first = createBrowserSupabaseClient();
      const second = createBrowserSupabaseClient();
      expect(second).toBe(first);
      expect(mockCreateBrowserClient).toHaveBeenCalledTimes(1);
    });
  });

  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    jest.isolateModules(() => {
      expect(() => require('../supabase-browser')).toThrow(
        'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required'
      );
    });
  });

  it('throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    jest.isolateModules(() => {
      expect(() => require('../supabase-browser')).toThrow(
        'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required'
      );
    });
  });
});
