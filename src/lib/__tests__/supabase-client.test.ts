/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */

const mockCreateClient = jest.fn().mockReturnValue({ from: jest.fn() });

jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

const origEnv = process.env;

beforeEach(() => {
  mockCreateClient.mockClear();
  process.env = {
    ...origEnv,
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-test',
  };
});

afterAll(() => {
  process.env = origEnv;
});

describe('supabase client (lib/supabase.ts)', () => {
  it('exports supabase client created with anon key', () => {
    jest.isolateModules(() => {
      const { supabase } = require('../supabase');
      expect(supabase).toBeDefined();
      expect(mockCreateClient).toHaveBeenCalledWith(
        'https://test.supabase.co',
        'anon-key-test'
      );
    });
  });

  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    jest.isolateModules(() => {
      expect(() => require('../supabase')).toThrow();
    });
  });

  it('throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    jest.isolateModules(() => {
      expect(() => require('../supabase')).toThrow();
    });
  });
});
