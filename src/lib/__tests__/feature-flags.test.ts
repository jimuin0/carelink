/**
 * @jest-environment node
 *
 * Tests for lib/feature-flags.ts
 * Covers: isFeatureEnabled, getAllFlags, clearFlagCache
 */

jest.mock('../supabase-server');

import { isFeatureEnabled, getAllFlags, clearFlagCache } from '../feature-flags';

const { createServerSupabaseClient } = require('../supabase-server');

function buildMock(flags: { key: string; enabled: boolean; rollout_pct: number; description: string | null; metadata: Record<string, unknown> }[]) {
  const mockSelect = jest.fn().mockResolvedValue({ data: flags });
  createServerSupabaseClient.mockReturnValue({
    from: jest.fn().mockReturnValue({ select: mockSelect }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearFlagCache();
});

describe('isFeatureEnabled', () => {
  test('returns false when flag does not exist', async () => {
    buildMock([]);
    expect(await isFeatureEnabled('nonexistent')).toBe(false);
  });

  test('returns false when flag is disabled', async () => {
    buildMock([{ key: 'my_flag', enabled: false, rollout_pct: 100, description: null, metadata: {} }]);
    expect(await isFeatureEnabled('my_flag')).toBe(false);
  });

  test('returns true when flag is enabled at 100%', async () => {
    buildMock([{ key: 'my_flag', enabled: true, rollout_pct: 100, description: null, metadata: {} }]);
    expect(await isFeatureEnabled('my_flag')).toBe(true);
  });

  test('returns false when rollout_pct is 0', async () => {
    buildMock([{ key: 'my_flag', enabled: true, rollout_pct: 0, description: null, metadata: {} }]);
    expect(await isFeatureEnabled('my_flag')).toBe(false);
  });

  test('returns true for whitelisted user ID even at 0% rollout', async () => {
    buildMock([{
      key: 'my_flag',
      enabled: true,
      rollout_pct: 0,
      description: null,
      metadata: { allowed_user_ids: ['user-allowed'] },
    }]);
    expect(await isFeatureEnabled('my_flag', 'user-allowed')).toBe(true);
  });

  test('uses hash-based rollout for user ID', async () => {
    buildMock([{ key: 'my_flag', enabled: true, rollout_pct: 50, description: null, metadata: {} }]);
    // Result depends on hash of userId, just verify it returns boolean
    const result = await isFeatureEnabled('my_flag', 'user-abc');
    expect(typeof result).toBe('boolean');
  });

  test('uses cache on second call (supabase called once)', async () => {
    buildMock([{ key: 'my_flag', enabled: true, rollout_pct: 100, description: null, metadata: {} }]);
    await isFeatureEnabled('my_flag');
    await isFeatureEnabled('my_flag');
    expect(createServerSupabaseClient).toHaveBeenCalledTimes(1);
  });
});

describe('getAllFlags', () => {
  test('returns all flags as array', async () => {
    buildMock([
      { key: 'flag_a', enabled: true, rollout_pct: 100, description: 'A', metadata: {} },
      { key: 'flag_b', enabled: false, rollout_pct: 0, description: null, metadata: {} },
    ]);
    const flags = await getAllFlags();
    expect(flags).toHaveLength(2);
    expect(flags.map((f) => f.key)).toContain('flag_a');
    expect(flags.map((f) => f.key)).toContain('flag_b');
  });

  test('returns empty array when no flags', async () => {
    buildMock([]);
    const flags = await getAllFlags();
    expect(flags).toEqual([]);
  });
});

describe('clearFlagCache', () => {
  test('forces DB reload on next call after clear', async () => {
    buildMock([{ key: 'my_flag', enabled: true, rollout_pct: 100, description: null, metadata: {} }]);
    await isFeatureEnabled('my_flag');
    clearFlagCache();
    await isFeatureEnabled('my_flag');
    expect(createServerSupabaseClient).toHaveBeenCalledTimes(2);
  });
});
