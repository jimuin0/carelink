import { getVariant, trackAbEvent } from '../ab-testing';

describe('getVariant', () => {
  test('0% rollout always returns control', () => {
    expect(getVariant('test-exp', 'user-123', 0)).toBe('control');
    expect(getVariant('test-exp', 'user-456', 0)).toBe('control');
    expect(getVariant('test-exp', 'user-789', 0)).toBe('control');
  });

  test('100% rollout always returns treatment', () => {
    expect(getVariant('test-exp', 'user-123', 100)).toBe('treatment');
    expect(getVariant('test-exp', 'user-456', 100)).toBe('treatment');
    expect(getVariant('test-exp', 'user-789', 100)).toBe('treatment');
  });

  test('negative rollout returns control', () => {
    expect(getVariant('test-exp', 'user-123', -5)).toBe('control');
    expect(getVariant('test-exp', 'user-123', -100)).toBe('control');
  });

  test('>100% rollout returns treatment', () => {
    expect(getVariant('test-exp', 'user-123', 105)).toBe('treatment');
    expect(getVariant('test-exp', 'user-123', 200)).toBe('treatment');
  });

  test('same user always gets same variant', () => {
    const userId = 'deterministic-user-id';
    const exp = 'stable-exp';
    const rollout = 50;

    const v1 = getVariant(exp, userId, rollout);
    const v2 = getVariant(exp, userId, rollout);
    const v3 = getVariant(exp, userId, rollout);

    expect(v1).toBe(v2);
    expect(v2).toBe(v3);
  });

  test('different users get different variants sometimes', () => {
    const exp = 'test-exp';
    const rollout = 50;

    const variants = [];
    for (let i = 0; i < 20; i++) {
      const v = getVariant(exp, `user-${i}`, rollout);
      variants.push(v);
    }

    const hasControl = variants.includes('control');
    const hasTreatment = variants.includes('treatment');

    expect(hasControl && hasTreatment).toBe(true);
  });

  test('50% rollout is roughly 50/50 split', () => {
    const exp = 'test-exp';
    const rollout = 50;

    let treatmentCount = 0;

    for (let i = 0; i < 100; i++) {
      const v = getVariant(exp, `user-${i}`, rollout);
      if (v === 'treatment') treatmentCount++;
    }

    // Should be roughly 50% (allow variance 30-70)
    expect(treatmentCount).toBeGreaterThan(20);
    expect(treatmentCount).toBeLessThan(80);
  });

  test('25% rollout is roughly 25% split', () => {
    const exp = 'test-exp';
    const rollout = 25;

    let treatmentCount = 0;

    for (let i = 0; i < 100; i++) {
      const v = getVariant(exp, `user-${i}`, rollout);
      if (v === 'treatment') treatmentCount++;
    }

    // Should be roughly 25% (allow variance 10-40)
    expect(treatmentCount).toBeGreaterThan(5);
    expect(treatmentCount).toBeLessThan(45);
  });

  test('variant is consistent across calls', () => {
    const user = 'consistency-test';
    const exp = 'consistency-exp';

    for (let rollout = 0; rollout <= 100; rollout += 10) {
      const v1 = getVariant(exp, user, rollout);
      const v2 = getVariant(exp, user, rollout);
      expect(v1).toBe(v2);
    }
  });

  test('only returns valid variants', () => {
    for (let rollout = 0; rollout <= 100; rollout++) {
      const v = getVariant('test', `user-${rollout}`, rollout);
      expect(['control', 'treatment']).toContain(v);
    }
  });

  test('different experiments assign independently', () => {
    const user = 'user-123';
    const rollout = 50;

    const results: Record<string, string[]> = {};
    for (let i = 0; i < 5; i++) {
      const v = getVariant(`exp-${i}`, user, rollout);
      if (!results[`exp-${i}`]) results[`exp-${i}`] = [];
      results[`exp-${i}`].push(v);
    }

    Object.values(results).forEach(variants => {
      expect(['control', 'treatment']).toContain(variants[0]);
    });
  });
});

describe('trackAbEvent()', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;
    try { localStorage.removeItem('_carelink_sid'); } catch {}
  });

  test('calls fetch with correct payload', async () => {
    await trackAbEvent('exp-1', 'control', 'impression', {
      userId: 'u-1',
      sessionId: 'sess-1',
      pagePath: '/test',
      metadata: { foo: 'bar' },
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/ab-test');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.experiment_key).toBe('exp-1');
    expect(body.variant).toBe('control');
    expect(body.event_type).toBe('impression');
    expect(body.user_id).toBe('u-1');
    expect(body.session_id).toBe('sess-1');
    expect(body.page_path).toBe('/test');
    expect(body.metadata).toEqual({ foo: 'bar' });
  });

  test('uses window.location.pathname when pagePath not provided', async () => {
    await trackAbEvent('exp-2', 'treatment', 'conversion');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(typeof body.page_path).toBe('string');
  });

  test('generates session ID from localStorage when not provided', async () => {
    await trackAbEvent('exp-3', 'treatment', 'click');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(typeof body.session_id).toBe('string');
    expect(body.session_id.length).toBeGreaterThan(0);
  });

  test('reuses existing session ID from localStorage', async () => {
    localStorage.setItem('_carelink_sid', 'existing-sid-xyz');
    await trackAbEvent('exp-4', 'control', 'booking');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.session_id).toBe('existing-sid-xyz');
  });

  test('silently fails when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    await expect(trackAbEvent('exp-5', 'control', 'impression')).resolves.toBeUndefined();
  });

  test('empty metadata when not provided', async () => {
    await trackAbEvent('exp-6', 'control', 'impression');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.metadata).toEqual({});
  });

  test('localStorage が throw した場合 session_id は "unknown"', async () => {
    const getSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    await trackAbEvent('exp-storage-fail', 'control', 'impression');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.session_id).toBe('unknown');
    getSpy.mockRestore();
  });

  // 監査T5: SSR ガード（typeof window === 'undefined' → 早期 return・line 39）の検証は、
  // jsdom 環境では window が非configurableで undefined 化できないため、
  // node 環境の専用ファイル ab-testing-ssr.test.ts に移設して実アサーションで検証している。
  // （旧テストは delete/代入が効かないまま expect(true).toBe(true) の空アサーションだった。）
});
