jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: Record<string, unknown>, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}));

import { checkCsrf } from '../csrf';

function makeRequest(headers: Record<string, string>): Request {
  return {
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
  } as unknown as Request;
}

describe('checkCsrf', () => {
  test('origin一致時はnullを返す（通過）', () => {
    const req = makeRequest({ origin: 'https://carelink.jp', host: 'carelink.jp' });
    expect(checkCsrf(req)).toBeNull();
  });

  test('origin不一致時は403を返す', () => {
    const req = makeRequest({ origin: 'https://evil.com', host: 'carelink.jp' });
    const res = checkCsrf(req);
    expect(res).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).status).toBe(403);
  });

  test('originもrefererもない場合は403を返す', () => {
    const req = makeRequest({ host: 'carelink.jp' });
    const res = checkCsrf(req);
    expect(res).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).status).toBe(403);
  });

  test('refererのみでorigin一致時はnullを返す（通過）', () => {
    const req = makeRequest({ referer: 'https://carelink.jp/page', host: 'carelink.jp' });
    expect(checkCsrf(req)).toBeNull();
  });

  test('hostヘッダーなしの場合は403を返す', () => {
    const req = makeRequest({ origin: 'https://carelink.jp' });
    const res = checkCsrf(req);
    expect(res).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).status).toBe(403);
  });

  test('localhost同士は通過する', () => {
    const req = makeRequest({ origin: 'http://localhost:3000', host: 'localhost:3000' });
    expect(checkCsrf(req)).toBeNull();
  });

  test('ドメイン末尾一致の偽サイトを拒否する', () => {
    const req = makeRequest({ origin: 'https://evil-carelink.jp', host: 'carelink.jp' });
    const res = checkCsrf(req);
    expect(res).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).status).toBe(403);
  });

  test('不正なorigin形式は拒否する', () => {
    const req = makeRequest({ origin: 'not-a-url', host: 'carelink.jp' });
    const res = checkCsrf(req);
    expect(res).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).status).toBe(403);
  });
});
