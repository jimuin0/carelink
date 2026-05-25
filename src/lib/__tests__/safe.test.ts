/**
 * @jest-environment node
 *
 * Tests for src/lib/safe.ts（Phase 3 Layer6）
 */
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));

import { safeAsync, safeSync, safeCaptureException } from '../safe';
import * as Sentry from '@sentry/nextjs';

beforeEach(() => jest.clearAllMocks());

describe('safeAsync', () => {
  test('正常時は fn の戻り値を返す', async () => {
    const r = await safeAsync(async () => 42, 0, { tag: 'unit' });
    expect(r).toBe(42);
  });

  test('throw 時は fallback を返す', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const r = await safeAsync(
      async () => {
        throw new Error('boom');
      },
      'fallback',
      { tag: 'unit' }
    );
    expect(r).toBe('fallback');
    expect(consoleSpy).toHaveBeenCalledWith('[safe:unit]', 'boom');
    consoleSpy.mockRestore();
  });

  test('throw 時に Sentry へ通報する（既定）', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    await safeAsync(
      async () => {
        throw new Error('boom');
      },
      null,
      { tag: 'unit' }
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(Sentry.captureException).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('reportToSentry: false → Sentry を呼ばない', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    await safeAsync(
      async () => {
        throw new Error('boom');
      },
      null,
      { tag: 'unit', reportToSentry: false }
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(Sentry.captureException).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('Sentry 自体が throw しても safeAsync は throw しない', async () => {
    (Sentry.captureException as jest.Mock).mockImplementation(() => {
      throw new Error('sentry down');
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    await expect(
      safeAsync(
        async () => {
          throw new Error('boom');
        },
        'ok',
        { tag: 'unit' }
      )
    ).resolves.toBe('ok');
    consoleSpy.mockRestore();
  });

  test('文字列例外も処理する', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const r = await safeAsync(
      async () => {
        throw 'string error';
      },
      'fb',
      { tag: 'unit' }
    );
    expect(r).toBe('fb');
    expect(consoleSpy).toHaveBeenCalledWith('[safe:unit]', 'string error');
    consoleSpy.mockRestore();
  });
});

describe('safeSync', () => {
  test('正常時は fn の戻り値を返す', () => {
    expect(safeSync(() => 'ok', 'fb', { tag: 'sync' })).toBe('ok');
  });

  test('throw 時は fallback を返す', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const r = safeSync(
      () => {
        throw new Error('sync boom');
      },
      'fb',
      { tag: 'sync' }
    );
    expect(r).toBe('fb');
    expect(consoleSpy).toHaveBeenCalledWith('[safe:sync]', 'sync boom');
    consoleSpy.mockRestore();
  });
});

describe('safeCaptureException', () => {
  test('Sentry が throw しても本関数は throw しない', async () => {
    (Sentry.captureException as jest.Mock).mockImplementation(() => {
      throw new Error('sentry down');
    });
    expect(() => safeCaptureException(new Error('x'), 'tag')).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });

  test('Sentry が正常時は captureException が呼ばれる', async () => {
    safeCaptureException(new Error('x'), 'tag');
    await new Promise((r) => setTimeout(r, 10));
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
