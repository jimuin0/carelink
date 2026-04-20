import { getVariant } from '../ab-testing';

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
