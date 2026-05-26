/**
 * @jest-environment node
 *
 * Tests for src/lib/safe.ts (Phase 8: Sentry 廃止後)
 *   - fn の戻り値透過
 *   - throw 時の fallback
 *   - console.error への構造化ログ出力
 *   - safeCaptureException / safeCaptureMessage は console 出力のみ（Sentry 廃止）
 */

import {
  safeAsync,
  safeSync,
  safeCaptureException,
  safeCaptureMessage,
} from '../safe';

beforeEach(() => jest.clearAllMocks());

describe('safeAsync', () => {
  test('正常時は fn の戻り値を返す', async () => {
    const r = await safeAsync(async () => 42, 0, { tag: 'unit' });
    expect(r).toBe(42);
  });

  test('throw 時は fallback を返し console.error を出力', async () => {
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

  test('reportToSentry オプションは互換性のため残置（no-op）', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const r = await safeAsync(
      async () => {
        throw new Error('boom');
      },
      'fb',
      { tag: 'unit', reportToSentry: false }
    );
    expect(r).toBe('fb');
    consoleSpy.mockRestore();
  });
});

describe('safeSync', () => {
  test('正常時は fn の戻り値を返す', () => {
    expect(safeSync(() => 'ok', 'fb', { tag: 'sync' })).toBe('ok');
  });

  test('throw 時は fallback を返し console.error を出力', () => {
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
  test('Error オブジェクトを console.error に出力（stack 含む）', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const err = new Error('test-error');
    safeCaptureException(err, 'tag');
    expect(consoleSpy).toHaveBeenCalled();
    const args = consoleSpy.mock.calls[0];
    expect(args[0]).toBe('[safeCaptureException:tag]');
    expect(args[1]).toBe('test-error');
    consoleSpy.mockRestore();
  });

  test('文字列例外も処理する', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    safeCaptureException('plain string', 'tag2');
    expect(consoleSpy).toHaveBeenCalledWith('[safeCaptureException:tag2]', 'plain string', '');
    consoleSpy.mockRestore();
  });

  test('throw しない（fail-safe）', () => {
    expect(() => safeCaptureException(new Error('x'), 'tag')).not.toThrow();
  });
});

describe('safeCaptureMessage', () => {
  test('warning level → console.warn', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    safeCaptureMessage('msg', 'warning', 'csrf', { ip: '1.2.3.4' });
    expect(warnSpy).toHaveBeenCalledWith('[safeCaptureMessage:csrf]', 'msg', { ip: '1.2.3.4' });
    warnSpy.mockRestore();
  });

  test('info level → console.info', () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation();
    safeCaptureMessage('hello', 'info', 'tag');
    expect(infoSpy).toHaveBeenCalledWith('[safeCaptureMessage:tag]', 'hello');
    infoSpy.mockRestore();
  });

  test('error level → console.error', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation();
    safeCaptureMessage('boom', 'error', 'tag');
    expect(errSpy).toHaveBeenCalledWith('[safeCaptureMessage:tag]', 'boom');
    errSpy.mockRestore();
  });

  test('throw しない（fail-safe）', () => {
    expect(() => safeCaptureMessage('m', 'error', 'tag')).not.toThrow();
  });
});
