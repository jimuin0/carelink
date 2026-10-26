/** @jest-environment node */

jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));

import { alertCaughtError } from '@/lib/alert';
import { onRequestError, register } from '../instrumentation';

const request = { path: '/blog/example', method: 'GET', headers: {} };

describe('onRequestError', () => {
  beforeEach(() => jest.clearAllMocks());

  test('Next の notFound 制御フローは障害通知しない', async () => {
    await onRequestError(
      { digest: 'NEXT_HTTP_ERROR_FALLBACK;404', message: 'not found' },
      request,
      {},
    );

    expect(alertCaughtError).not.toHaveBeenCalled();
  });

  test('Next の redirect 制御フローは障害通知しない', async () => {
    await onRequestError({ digest: 'NEXT_REDIRECT;replace;/auth/login;307;' }, request, {});

    expect(alertCaughtError).not.toHaveBeenCalled();
  });

  test('実際の例外は従来どおり通知する', async () => {
    await onRequestError(new Error('render failed'), request, { routePath: '/blog/[slug]' });

    expect(alertCaughtError).toHaveBeenCalledWith('onRequestError', expect.any(Error), '/blog/example');
  });

  test('通知の例外本文をフォールバックログへ転記しない', async () => {
    const privateMarker = 'synthetic-private-notification-body';
    jest.mocked(alertCaughtError).mockImplementationOnce(() => { throw new Error(privateMarker); });
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(onRequestError(new Error('render failed'), request, {})).resolves.toBeUndefined();
      expect(log.mock.calls).toEqual([['[instrumentation.onRequestError] alert failed']]);
      expect(JSON.stringify(log.mock.calls)).not.toContain(privateMarker);
    } finally { log.mockRestore(); }
  });
});


describe('register runtime evidence', () => {
  const savedRuntime = process.env.NEXT_RUNTIME;
  afterEach(() => {
    if (savedRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = savedRuntime;
    jest.restoreAllMocks();
  });

  test('Node の実行バージョンだけをログに残す', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const log = jest.spyOn(console, 'info').mockImplementation(() => {});
    await register();
    expect(log.mock.calls).toEqual([['[runtime-security] node=' + process.version]]);
  });

  test('Node 以外ではバージョンを出力しない', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    const log = jest.spyOn(console, 'info').mockImplementation(() => {});
    await register();
    expect(log).not.toHaveBeenCalled();
  });
});
