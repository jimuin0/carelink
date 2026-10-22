/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */

const mockOnAuthStateChange = jest.fn();
const mockCreateBrowserClient = jest.fn(() => ({ from: jest.fn(), auth: { onAuthStateChange: mockOnAuthStateChange } }));

jest.mock('@supabase/ssr', () => ({
  createBrowserClient: (...args: unknown[]) => mockCreateBrowserClient(...args),
}));

const origEnv = process.env;

beforeEach(() => {
  mockCreateBrowserClient.mockClear();
  mockOnAuthStateChange.mockClear();
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

  it('starts recording password recovery as soon as the singleton is created, exactly once', () => {
    jest.isolateModules(() => {
      const { createBrowserSupabaseClient } = require('../supabase-browser');
      const { getPasswordRecoveryUser } = require('../password-recovery-session');
      createBrowserSupabaseClient();
      createBrowserSupabaseClient();
      // 生成と同じ同期区間で購読している（URL の認証コード交換が終わる前）
      expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
      const notify = mockOnAuthStateChange.mock.calls[0][0];
      notify('PASSWORD_RECOVERY', { user: { id: 'user-1', email: 'owner@example.invalid' } });
      expect(getPasswordRecoveryUser()).toEqual({ id: 'user-1', email: 'owner@example.invalid' });
    });
  });

  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    jest.isolateModules(() => {
      // Importing must not throw: the root layout loads this module on every page.
      const { createBrowserSupabaseClient } = require('../supabase-browser');
      expect(() => createBrowserSupabaseClient()).toThrow(
        'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required'
      );
      expect(mockCreateBrowserClient).not.toHaveBeenCalled();
    });
  });

  it('throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    jest.isolateModules(() => {
      // Importing must not throw: the root layout loads this module on every page.
      const { createBrowserSupabaseClient } = require('../supabase-browser');
      expect(() => createBrowserSupabaseClient()).toThrow(
        'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required'
      );
      expect(mockCreateBrowserClient).not.toHaveBeenCalled();
    });
  });
});
