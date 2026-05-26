/**
 * @jest-environment node
 *
 * Tests for src/lib/with-route.ts（Phase 3 Layer6）
 */
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });
jest.mock('../csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('../rate-limit', () => ({
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
}));

import { NextResponse } from 'next/server';
import { withRoute } from '../with-route';
import { checkCsrf } from '../csrf';
import { checkRateLimit } from '../rate-limit';

beforeEach(() => {
  jest.clearAllMocks();
  // mockReturnValue は clearAllMocks では消えないので明示的に再設定
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
});

const makeReq = (opts: { method?: string; body?: string } = {}) =>
  new Request('http://localhost/api/test', {
    method: opts.method ?? 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: opts.body,
  });

describe('withRoute', () => {
  test('正常系 → handler の Response をそのまま返す', async () => {
    const handler = jest.fn(async () => NextResponse.json({ ok: true }));
    const route = withRoute(handler);
    const res = await route(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(handler).toHaveBeenCalled();
  });

  test('CSRF 失敗 → 403 を返し handler 呼ばない', async () => {
    (checkCsrf as jest.Mock).mockReturnValue(
      NextResponse.json({ error: 'CSRF' }, { status: 403 })
    );
    const handler = jest.fn();
    const route = withRoute(handler);
    const res = await route(makeReq());
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  test('csrf: false → CSRF をスキップ', async () => {
    (checkCsrf as jest.Mock).mockReturnValue(
      NextResponse.json({ error: 'CSRF' }, { status: 403 })
    );
    const handler = jest.fn(async () => NextResponse.json({ ok: true }));
    const route = withRoute(handler, { csrf: false });
    const res = await route(makeReq());
    expect(res.status).toBe(200);
    expect(checkCsrf).not.toHaveBeenCalled();
  });

  test('rateLimit 超過 → 429 を返し handler 呼ばない', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);
    const handler = jest.fn();
    const route = withRoute(handler, {
      rateLimit: { limiter: null, limit: 10, windowMs: 60_000, prefix: 'p' },
    });
    const res = await route(makeReq());
    expect(res.status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
  });

  test('rateLimit 未指定時は checkRateLimit を呼ばない', async () => {
    const handler = jest.fn(async () => NextResponse.json({ ok: true }));
    const route = withRoute(handler);
    await route(makeReq());
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  test('handler が throw → 500 を返し Sentry 通報', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const handler = jest.fn(async () => {
      throw new Error('handler boom');
    });
    const route = withRoute(handler);
    const res = await route(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('サーバーエラー');
    await new Promise((r) => setTimeout(r, 10));
    consoleSpy.mockRestore();
  });

  test('CSRF と rateLimit を順序通り評価する', async () => {
    const order: string[] = [];
    (checkCsrf as jest.Mock).mockImplementation(() => {
      order.push('csrf');
      return null;
    });
    (checkRateLimit as jest.Mock).mockImplementation(async () => {
      order.push('rl');
      return false;
    });
    const handler = jest.fn(async () => {
      order.push('handler');
      return NextResponse.json({ ok: true });
    });
    const route = withRoute(handler, {
      rateLimit: { limiter: null, limit: 10, windowMs: 60_000, prefix: 'p' },
    });
    await route(makeReq());
    expect(order).toEqual(['csrf', 'rl', 'handler']);
  });
});
