/**
 * Tests for lib/threads.ts
 * Covers: publishThreadsText, refreshThreadsToken, buildArticlePostText
 */

type MaybeSingleResult = { data: unknown; error: unknown };

let maybeSingleResult: MaybeSingleResult = {
  data: { id: 'cred-1', access_token: 'stored-token', expires_at: '2099-01-01T00:00:00.000Z' },
  error: null,
};
let updateResult: { error: unknown } = { error: null };
let createServiceRoleClientImpl: (() => unknown) | null = null;

const mockEq = jest.fn().mockImplementation(() => Promise.resolve(updateResult));
const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });
const mockMaybeSingle = jest.fn().mockImplementation(() => Promise.resolve(maybeSingleResult));
const mockLimit = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
const mockOrder = jest.fn().mockReturnValue({ limit: mockLimit });
const mockSelect = jest.fn().mockReturnValue({ order: mockOrder });
const mockFrom = jest.fn().mockReturnValue({ select: mockSelect, update: mockUpdate });

jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(() => {
    if (createServiceRoleClientImpl) return createServiceRoleClientImpl();
    return { from: mockFrom };
  }),
}));

import { publishThreadsText, refreshThreadsToken, buildArticlePostText } from '../threads';

function mockFetchSequence(responses: Array<Partial<Response> & { ok: boolean }>) {
  const fn = jest.fn();
  for (const r of responses) {
    fn.mockImplementationOnce(async () => r as Response);
  }
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function jsonResponse(ok: boolean, status: number, body: unknown): Partial<Response> & { ok: boolean } {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  process.env.THREADS_USER_ID = 'user-123';
  maybeSingleResult = {
    data: { id: 'cred-1', access_token: 'stored-token', expires_at: '2099-01-01T00:00:00.000Z' },
    error: null,
  };
  updateResult = { error: null };
  createServiceRoleClientImpl = null;
  mockFrom.mockClear();
  mockSelect.mockClear();
  mockOrder.mockClear();
  mockLimit.mockClear();
  mockMaybeSingle.mockClear();
  mockUpdate.mockClear();
  mockEq.mockClear();
});

afterEach(() => {
  delete process.env.THREADS_USER_ID;
  jest.restoreAllMocks();
});

describe('publishThreadsText', () => {
  test('skipped when THREADS_USER_ID is not set', async () => {
    delete process.env.THREADS_USER_ID;
    const result = await publishThreadsText('hello');
    expect(result.outcome).toBe('skipped');
  });

  test('skipped when THREADS_USER_ID is an empty string', async () => {
    process.env.THREADS_USER_ID = '   ';
    const result = await publishThreadsText('hello');
    expect(result.outcome).toBe('skipped');
  });

  test('skipped when threads_credentials has no row', async () => {
    maybeSingleResult = { data: null, error: null };
    const result = await publishThreadsText('hello');
    expect(result.outcome).toBe('skipped');
  });

  test('skipped when threads_credentials query errors', async () => {
    maybeSingleResult = { data: null, error: { message: 'boom' } };
    const result = await publishThreadsText('hello');
    expect(result.outcome).toBe('skipped');
  });

  test('skipped when createServiceRoleClient throws (e.g. env missing)', async () => {
    createServiceRoleClientImpl = () => {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    };
    const result = await publishThreadsText('hello');
    expect(result.outcome).toBe('skipped');
  });

  test('published: happy path returns postId', async () => {
    mockFetchSequence([
      jsonResponse(true, 200, { id: 'container-1' }),
      jsonResponse(true, 200, { id: 'post-1' }),
    ]);
    const result = await publishThreadsText('hello world');
    expect(result.outcome).toBe('published');
    expect(result.postId).toBe('post-1');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [containerUrl] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(containerUrl)).toContain('/user-123/threads?');
    expect(String(containerUrl)).toContain('media_type=TEXT');
    const [publishUrl] = (global.fetch as jest.Mock).mock.calls[1];
    expect(String(publishUrl)).toContain('/user-123/threads_publish?');
    expect(String(publishUrl)).toContain('creation_id=container-1');
  });

  test('permanent: container creation returns 4xx (not 429)', async () => {
    mockFetchSequence([jsonResponse(false, 401, { error: 'invalid token' })]);
    const result = await publishThreadsText('hello');
    expect(result.outcome).toBe('permanent');
  });

  test('transient: container creation returns 429', async () => {
    mockFetchSequence([jsonResponse(false, 429, { error: 'rate limited' })]);
    const result = await publishThreadsText('hello');
    expect(result.outcome).toBe('transient');
  });

  test('transient: container creation returns 5xx', async () => {
    mockFetchSequence([jsonResponse(false, 503, { error: 'unavailable' })]);
    const result = await publishThreadsText('hello');
    expect(result.outcome).toBe('transient');
  });

  test('permanent: container creation ok but response has no id', async () => {
    mockFetchSequence([jsonResponse(true, 200, {})]);
    const result = await publishThreadsText('hello');
    expect(result.outcome).toBe('permanent');
  });

  test('permanent: container creation returns 4xx and body text() itself rejects', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => {
        throw new Error('body read failed');
      },
    } as unknown as Response);
    const result = await publishThreadsText('hello');
    expect(result.outcome).toBe('permanent');
  });

  test('transient: container creation fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const result = await publishThreadsText('hello');
    expect(result.outcome).toBe('transient');
  });

  test('permanent: publish step returns 4xx', async () => {
    mockFetchSequence([
      jsonResponse(true, 200, { id: 'container-1' }),
      jsonResponse(false, 400, { error: 'bad creation_id' }),
    ]);
    const result = await publishThreadsText('hello');
    expect(result.outcome).toBe('permanent');
  });

  test('transient: publish step returns 5xx', async () => {
    mockFetchSequence([
      jsonResponse(true, 200, { id: 'container-1' }),
      jsonResponse(false, 500, { error: 'oops' }),
    ]);
    const result = await publishThreadsText('hello');
    expect(result.outcome).toBe('transient');
  });

  test('permanent: publish step returns 4xx and body text() itself rejects', async () => {
    const fn = jest.fn();
    fn.mockImplementationOnce(async () => jsonResponse(true, 200, { id: 'container-1' }) as Response);
    fn.mockImplementationOnce(async () => ({
      ok: false,
      status: 400,
      text: async () => {
        throw new Error('body read failed');
      },
    } as unknown as Response));
    global.fetch = fn as unknown as typeof fetch;
    const result = await publishThreadsText('hello');
    expect(result.outcome).toBe('permanent');
  });

  test('permanent: publish ok but response has no id', async () => {
    mockFetchSequence([jsonResponse(true, 200, { id: 'container-1' }), jsonResponse(true, 200, {})]);
    const result = await publishThreadsText('hello');
    expect(result.outcome).toBe('permanent');
  });

  test('transient: publish step fetch throws', async () => {
    const fn = jest.fn();
    fn.mockImplementationOnce(async () => jsonResponse(true, 200, { id: 'container-1' }) as Response);
    fn.mockImplementationOnce(async () => {
      throw new Error('network down');
    });
    global.fetch = fn as unknown as typeof fetch;
    const result = await publishThreadsText('hello');
    expect(result.outcome).toBe('transient');
  });
});

describe('refreshThreadsToken', () => {
  test('ok:false when threads_credentials has no row', async () => {
    maybeSingleResult = { data: null, error: null };
    const result = await refreshThreadsToken();
    expect(result.ok).toBe(false);
  });

  test('ok:false and does not call fetch when token already expired', async () => {
    maybeSingleResult = {
      data: { id: 'cred-1', access_token: 'old-token', expires_at: '2000-01-01T00:00:00.000Z' },
      error: null,
    };
    global.fetch = jest.fn();
    const result = await refreshThreadsToken();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/expired/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('ok:true on success, updates DB and returns expiresAt', async () => {
    mockFetchSequence([jsonResponse(true, 200, { access_token: 'new-token', expires_in: 5184000 })]);
    const result = await refreshThreadsToken();
    expect(result.ok).toBe(true);
    expect(result.expiresAt).toBeTruthy();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: 'new-token' })
    );
    expect(mockEq).toHaveBeenCalledWith('id', 'cred-1');
  });

  test('ok:false when refresh endpoint returns non-ok', async () => {
    mockFetchSequence([jsonResponse(false, 401, { error: 'expired' })]);
    const result = await refreshThreadsToken();
    expect(result.ok).toBe(false);
  });

  test('ok:false when refresh endpoint returns non-ok and body text() itself rejects', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => {
        throw new Error('body read failed');
      },
    } as unknown as Response);
    const result = await refreshThreadsToken();
    expect(result.ok).toBe(false);
  });

  test('ok:false when refresh response missing access_token/expires_in', async () => {
    mockFetchSequence([jsonResponse(true, 200, {})]);
    const result = await refreshThreadsToken();
    expect(result.ok).toBe(false);
  });

  test('ok:false when DB update fails', async () => {
    updateResult = { error: { message: 'db down' } };
    mockFetchSequence([jsonResponse(true, 200, { access_token: 'new-token', expires_in: 5184000 })]);
    const result = await refreshThreadsToken();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/db update failed/);
  });

  test('ok:false when fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const result = await refreshThreadsToken();
    expect(result.ok).toBe(false);
  });
});

describe('buildArticlePostText', () => {
  const URL = 'https://carelink-jp.com/blog/example-article';

  test('short title fits without truncation', () => {
    const text = buildArticlePostText('短いタイトル', URL);
    expect(text).toBe(`短いタイトル\n\n${URL}`);
    expect(text.length).toBeLessThanOrEqual(500);
  });

  test('long title is truncated with ellipsis and URL is preserved in full', () => {
    const longTitle = 'あ'.repeat(600);
    const text = buildArticlePostText(longTitle, URL);
    expect(text.length).toBeLessThanOrEqual(500);
    expect(text.endsWith(URL)).toBe(true);
    expect(text).toContain('…');
  });

  test('result never exceeds 500 characters for a wide range of title lengths', () => {
    for (const len of [0, 1, 10, 50, 100, 400, 499, 500, 501, 600, 2000]) {
      const title = 'あ'.repeat(len);
      const text = buildArticlePostText(title, URL);
      expect(text.length).toBeLessThanOrEqual(500);
      expect(text.endsWith(URL)).toBe(true);
    }
  });

  test('extremely long URL alone (no room for title/separator) returns URL only', () => {
    const hugeUrl = 'https://carelink-jp.com/' + 'a'.repeat(500);
    const text = buildArticlePostText('タイトル', hugeUrl);
    expect(text).toBe(hugeUrl);
  });

  test('URL fills exactly up to the point where only the separator has no room', () => {
    // budgetForTitleAndSeparator > 0 だが budgetForTitle <= 0 になる境界を作る。
    const url = 'x'.repeat(499); // budgetForTitleAndSeparator = 1, budgetForTitle = 1-2 = -1
    const text = buildArticlePostText('タイトル', url);
    expect(text).toBe(url);
  });

  test('empty title returns separator + URL when it fits', () => {
    const text = buildArticlePostText('', URL);
    expect(text).toBe(`\n\n${URL}`);
  });
});
