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

  test('warning level extra なし → console.warn (extra なしブランチ)', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    safeCaptureMessage('warn-bare', 'warning', 'tagw');
    expect(warnSpy).toHaveBeenCalledWith('[safeCaptureMessage:tagw]', 'warn-bare');
    warnSpy.mockRestore();
  });

  test('error level with extra → console.error with extra', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation();
    safeCaptureMessage('boom', 'error', 'tage', { foo: 'bar' });
    expect(errSpy).toHaveBeenCalledWith('[safeCaptureMessage:tage]', 'boom', { foo: 'bar' });
    errSpy.mockRestore();
  });

  test('info level with extra → console.info with extra', () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation();
    safeCaptureMessage('hi', 'info', 'tagi', { k: 'v' });
    expect(infoSpy).toHaveBeenCalledWith('[safeCaptureMessage:tagi]', 'hi', { k: 'v' });
    infoSpy.mockRestore();
  });
});

describe('safeCaptureException — Error without stack', () => {
  test('Error with stack を含む（stack 三項演算 truthy 側）', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const err = new Error('with-stack');
    safeCaptureException(err, 'tagS');
    const args = consoleSpy.mock.calls[0];
    // 3rd arg should include newline + stack
    expect(typeof args[2]).toBe('string');
    expect((args[2] as string).startsWith('\n')).toBe(true);
    consoleSpy.mockRestore();
  });
});

describe('safeSync — 非 Error スロー', () => {
  // Branch coverage: line 52 — e instanceof Error の false 分岐（String(e) でメッセージ生成）
  test('文字列をスロー → String(e) フォールバック → fallback 返却（line 52 false 分岐）', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const r = safeSync(
      () => { throw 'string error'; },
      'fb',
      { tag: 'sync-str' }
    );
    expect(r).toBe('fb');
    expect(consoleSpy).toHaveBeenCalledWith('[safe:sync-str]', 'string error');
    consoleSpy.mockRestore();
  });
});
