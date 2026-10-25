/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createServerSupabaseClient, createServiceRoleClient } from '../supabase-server';

test('repeated real SDK data clients do not accumulate background Auth refresh timers', async () => {
  const original = process.env;
  process.env = { ...original,
    NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.supabase.invalid',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
  };
  const interval = jest.spyOn(global, 'setInterval');
  const clients = Array.from({ length: 10 }, () => [createServerSupabaseClient(), createServiceRoleClient()]).flat();
  try {
    await Promise.all(clients.map((client) => client.auth.initialize()));
    expect(interval).not.toHaveBeenCalled();
  } finally {
    await Promise.all(clients.map((client) => client.auth.stopAutoRefresh()));
    interval.mockRestore();
    process.env = original;
  }
});
