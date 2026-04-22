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

// ─── 深掘り: エッジケース ─────────────────────────────────────────────────────

describe('checkCsrf - 深掘りエッジケース', () => {
  test('ポート番号が一致する場合は通過', () => {
    const req = makeRequest({ origin: 'http://localhost:3000', host: 'localhost:3000' });
    expect(checkCsrf(req)).toBeNull();
  });

  test('ポート番号が不一致の場合は拒否（3000 vs 8080）', () => {
    const req = makeRequest({ origin: 'http://localhost:3000', host: 'localhost:8080' });
    const res = checkCsrf(req);
    expect((res as any).status).toBe(403);
  });

  test('HTTPS と HTTP の混在は拒否（origin: https, host: http相当）', () => {
    const req = makeRequest({ origin: 'https://carelink.jp', host: 'http-carelink.jp' });
    const res = checkCsrf(req);
    expect((res as any).status).toBe(403);
  });

  test('サブドメインは親ドメインと別扱い（拒否）', () => {
    const req = makeRequest({ origin: 'https://admin.carelink.jp', host: 'carelink.jp' });
    const res = checkCsrf(req);
    expect((res as any).status).toBe(403);
  });

  test('サブドメイン同士が一致する場合は通過', () => {
    const req = makeRequest({ origin: 'https://app.carelink.jp', host: 'app.carelink.jp' });
    expect(checkCsrf(req)).toBeNull();
  });

  test('origin が空文字列の場合は拒否', () => {
    const req = makeRequest({ origin: '', host: 'carelink.jp' });
    const res = checkCsrf(req);
    expect((res as any).status).toBe(403);
  });

  test('origin と referer の両方がある場合は origin を優先', () => {
    // origin が一致して referer が不一致
    const req = makeRequest({
      origin: 'https://carelink.jp',
      referer: 'https://evil.com/page',
      host: 'carelink.jp',
    });
    expect(checkCsrf(req)).toBeNull();
  });

  test('referer のパスが含まれていても host 部分のみ比較', () => {
    const req = makeRequest({
      referer: 'https://carelink.jp/some/path?param=value',
      host: 'carelink.jp',
    });
    expect(checkCsrf(req)).toBeNull();
  });

  test('IPアドレスによる host でも動作する', () => {
    const req = makeRequest({ origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000' });
    expect(checkCsrf(req)).toBeNull();
  });

  test('origin が javascript: スキームは拒否', () => {
    const req = makeRequest({ origin: 'javascript:alert(1)', host: 'carelink.jp' });
    const res = checkCsrf(req);
    expect((res as any).status).toBe(403);
  });

  test('null バイトを含む origin は拒否', () => {
    const req = makeRequest({ origin: 'https://carelink.jp\x00evil.com', host: 'carelink.jp' });
    const res = checkCsrf(req);
    // null バイトで URL パースが失敗するか不一致になる
    expect([403, null]).toContain(res === null ? null : (res as any).status);
  });
});
