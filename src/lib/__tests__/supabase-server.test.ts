/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */

const mockCreateClient = jest.fn().mockReturnValue({ from: jest.fn() });

jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import { createServerSupabaseClient, createServiceRoleClient } from '../supabase-server';

const origEnv = process.env;

beforeEach(() => {
  mockCreateClient.mockClear();
  process.env = {
    ...origEnv,
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  };
});

afterAll(() => {
  process.env = origEnv;
});

describe('createServerSupabaseClient', () => {
  it('creates client with anon key', () => {
    createServerSupabaseClient();
    expect(mockCreateClient).toHaveBeenCalledWith('https://test.supabase.co', 'anon-key-test');
  });

  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(() => createServerSupabaseClient()).toThrow(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required'
    );
  });

  it('throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(() => createServerSupabaseClient()).toThrow(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required'
    );
  });
});

describe('createServiceRoleClient', () => {
  it('creates client with service role key', () => {
    createServiceRoleClient();
    expect(mockCreateClient).toHaveBeenCalledWith('https://test.supabase.co', 'service-role-key');
  });

  it('throws when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => createServiceRoleClient()).toThrow(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required'
    );
  });

  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(() => createServiceRoleClient()).toThrow(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required'
    );
  });
});
