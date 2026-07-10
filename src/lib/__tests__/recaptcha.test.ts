/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/recaptcha.ts
 * Covers: verifyRecaptcha - all branches
 */

jest.mock('@/lib/alert', () => ({ postAlert: jest.fn() }));

import { verifyRecaptcha } from '../recaptcha';
import { postAlert } from '@/lib/alert';

const SECRET = 'test-secret-key';

beforeEach(() => {
  jest.restoreAllMocks();
  (postAlert as jest.Mock).mockClear();
  delete process.env.RECAPTCHA_SECRET_KEY;
});

describe('verifyRecaptcha', () => {
  test('no secret key → returns success=true with reason=no_secret_key', async () => {
    const result = await verifyRecaptcha('token', 'booking');
    expect(result).toEqual({ success: true, reason: 'no_secret_key' });
  });

  test('recaptcha returns success=false → returns success=false with error-codes', async () => {
    process.env.RECAPTCHA_SECRET_KEY = SECRET;
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: false, score: 0, action: 'booking', 'error-codes': ['invalid-input-response'] }),
    });
    const result = await verifyRecaptcha('bad-token', 'booking');
    expect(result).toEqual({ success: false, reason: 'invalid-input-response' });
  });

  test('recaptcha returns success=false with no error-codes → reason=failed', async () => {
    process.env.RECAPTCHA_SECRET_KEY = SECRET;
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: false, score: 0, action: 'booking' }),
    });
    const result = await verifyRecaptcha('bad-token', 'booking');
    expect(result).toEqual({ success: false, reason: 'failed' });
  });

  test('action mismatch → returns success=false with action_mismatch reason', async () => {
    process.env.RECAPTCHA_SECRET_KEY = SECRET;
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, score: 0.9, action: 'other_action' }),
    });
    const result = await verifyRecaptcha('token', 'booking');
    expect(result).toEqual({ success: false, score: 0.9, reason: 'action_mismatch:other_action' });
  });

  test('score below minScore → returns success=false with low_score reason', async () => {
    process.env.RECAPTCHA_SECRET_KEY = SECRET;
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, score: 0.3, action: 'booking' }),
    });
    const result = await verifyRecaptcha('token', 'booking', 0.5);
    expect(result).toEqual({ success: false, score: 0.3, reason: 'low_score:0.3' });
  });

  test('all checks pass → returns success=true with score', async () => {
    process.env.RECAPTCHA_SECRET_KEY = SECRET;
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, score: 0.9, action: 'booking' }),
    });
    const result = await verifyRecaptcha('token', 'booking', 0.5);
    expect(result).toEqual({ success: true, score: 0.9 });
  });

  test('uses default minScore=0.5 when not specified', async () => {
    process.env.RECAPTCHA_SECRET_KEY = SECRET;
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, score: 0.6, action: 'review' }),
    });
    const result = await verifyRecaptcha('token', 'review');
    expect(result.success).toBe(true);
  });

  test('no secret key in production → warn log + Slack alert emitted（無音の設定ミス防止・恒久根治の回帰）', async () => {
    const originalEnv = process.env.NODE_ENV;
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const result = await verifyRecaptcha('tok', 'booking');
    expect(result).toEqual({ success: true, reason: 'no_secret_key' });
    expect(warnSpy).toHaveBeenCalledWith('[recaptcha:secret-missing]', expect.stringContaining('RECAPTCHA_SECRET_KEY'));
    expect(postAlert).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      route: 'recaptcha:secret-missing',
      message: expect.stringContaining('booking'),
    }));
    warnSpy.mockRestore();
    Object.defineProperty(process.env, 'NODE_ENV', { value: originalEnv, configurable: true });
  });

  // 【2026年7月10日 恒久根治の回帰】開発・テスト環境では従来通り無音（Slack投稿しない）を固定する。
  test('no secret key in non-production（test）→ postAlert は呼ばれない', async () => {
    const result = await verifyRecaptcha('tok', 'booking');
    expect(result).toEqual({ success: true, reason: 'no_secret_key' });
    expect(postAlert).not.toHaveBeenCalled();
  });

  test('fetch throws → returns success=false with reason=verify_error', async () => {
    process.env.RECAPTCHA_SECRET_KEY = SECRET;
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
    const result = await verifyRecaptcha('token', 'booking');
    expect(result).toEqual({ success: false, reason: 'verify_error' });
  });
});
