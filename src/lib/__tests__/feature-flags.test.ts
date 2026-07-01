/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
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

  test('空テーブル（flags=[]）でも2回目はDBを叩かない（キャッシュが効く）', async () => {
    // feature_flags テーブルが空の場合も loadedAt がセットされ、5分以内は再クエリしない
    buildMock([]);
    await isFeatureEnabled('nonexistent');
    await isFeatureEnabled('nonexistent');
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

describe('isFeatureEnabled — extra branch coverage', () => {
  test('allowed_user_ids exists but userId is undefined → falls through to rollout', async () => {
    buildMock([{
      key: 'my_flag',
      enabled: true,
      rollout_pct: 100,
      description: null,
      metadata: { allowed_user_ids: ['only-this-user'] },
    }]);
    // no userId arg → allowedIds && userId is false → continues to rollout_pct >= 100 → true
    expect(await isFeatureEnabled('my_flag')).toBe(true);
  });

  test('allowed_user_ids exists, userId not in list, rollout 0 → false', async () => {
    buildMock([{
      key: 'my_flag',
      enabled: true,
      rollout_pct: 0,
      description: null,
      metadata: { allowed_user_ids: ['other'] },
    }]);
    expect(await isFeatureEnabled('my_flag', 'me')).toBe(false);
  });

  test('no userId at non-edge rollout uses Math.random branch', async () => {
    buildMock([{ key: 'my_flag', enabled: true, rollout_pct: 50, description: null, metadata: {} }]);
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0.1); // 10 < 50 → true
    expect(await isFeatureEnabled('my_flag')).toBe(true);
    spy.mockReturnValue(0.99); // 99 < 50 → false
    clearFlagCache();
    buildMock([{ key: 'my_flag', enabled: true, rollout_pct: 50, description: null, metadata: {} }]);
    expect(await isFeatureEnabled('my_flag')).toBe(false);
    spy.mockRestore();
  });

  test('DB error → loadFlags catches and returns existing (empty) cache', async () => {
    createServerSupabaseClient.mockImplementation(() => {
      throw new Error('db down');
    });
    expect(await isFeatureEnabled('any')).toBe(false);
  });

  test('cache TTL expiry triggers reload', async () => {
    buildMock([{ key: 'my_flag', enabled: true, rollout_pct: 100, description: null, metadata: {} }]);
    await isFeatureEnabled('my_flag');
    // Advance time past TTL (5min)
    const realNow = Date.now;
    Date.now = () => realNow() + 6 * 60 * 1000;
    try {
      await isFeatureEnabled('my_flag');
      expect(createServerSupabaseClient).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = realNow;
    }
  });

  test('hash-based rollout: userId hash below threshold returns true', async () => {
    buildMock([{ key: 'my_flag', enabled: true, rollout_pct: 99, description: null, metadata: {} }]);
    // userId ending in "00" → parseInt("00", 16)=0 → 0<99 true
    expect(await isFeatureEnabled('my_flag', 'user00')).toBe(true);
  });

  test('hash-based rollout: userId hash above threshold returns false', async () => {
    buildMock([{ key: 'my_flag', enabled: true, rollout_pct: 1, description: null, metadata: {} }]);
    // userId ending in "ff" → 255 % 100 = 55 → 55 < 1 false
    expect(await isFeatureEnabled('my_flag', 'userff')).toBe(false);
  });

  // Branch coverage: line 40 — data が null のとき if (data) false 分岐 → キャッシュ更新なし
  test('data が null → if(data) false 分岐 → キャッシュ更新スキップ（line 40 false 分岐）', async () => {
    const mockSelect = jest.fn().mockResolvedValue({ data: null });
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({ select: mockSelect }),
    });
    // data=null → キャッシュ更新なし → 存在しないフラグ → false
    expect(await isFeatureEnabled('any_flag')).toBe(false);
  });
});
