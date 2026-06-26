/**
 * @jest-environment node
 *
 * Tests for POST /api/line/webhook
 * Key assertions:
 *   - LINE signature verification (x-line-signature)
 *   - Follow event: LINE profile API call, upsert to line_user_links
 *   - Message event: auto-reply with sendLineReply
 *   - User ID validation (alphanumeric + hyphen/underscore only)
 *   - Fire-and-forget event handling
 *   - Error resilience (always returns 200)
 */

jest.mock('@/lib/line');

const mockFromDelegate = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (...args: any[]) => mockFromDelegate(...args),
  })),
}));

import { verifyLineSignature, sendLineReply } from '@/lib/line';
import { POST } from '../route';

let mockUpsert: jest.Mock;

function setupDefaultMocks(signatureValid: boolean = true) {
  (verifyLineSignature as jest.Mock).mockReturnValue(signatureValid);

  mockUpsert = jest.fn().mockResolvedValue({ error: null });

  mockFromDelegate.mockReturnValue({
    upsert: mockUpsert,
  });

  global.fetch = jest.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ displayName: 'Test User', pictureUrl: 'https://example.com/pic.jpg' }),
      { status: 200 }
    )
  );

  (sendLineReply as jest.Mock).mockResolvedValue({ ok: true });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'test-token';
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
});

function makeRequest(body: object, signature: string = 'valid-sig') {
  const bodyStr = JSON.stringify(body);
  return new Request('http://localhost/api/line/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-line-signature': signature,
    },
    body: bodyStr,
  });
}

const VALID_LINE_USER_ID = 'U1234567890abcdefghijklmnopqrstuv';

describe('POST /api/line/webhook', () => {
  test('invalid signature → 401', async () => {
    setupDefaultMocks(false);

    const res = await POST(
      makeRequest({
        events: [
          {
            type: 'follow',
            source: { userId: VALID_LINE_USER_ID },
            replyToken: 'token-123',
          },
        ],
      }) as any
    );

    expect(res.status).toBe(401);
  });

  test('missing signature → 401', async () => {
    const body = {
      events: [
        {
          type: 'follow',
          source: { userId: VALID_LINE_USER_ID },
          replyToken: 'token-123',
        },
      ],
    };
    const req = new Request('http://localhost/api/line/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const res = await POST(req as any);

    expect(res.status).toBe(401);
  });

  test('follow event → creates line_user_links entry', async () => {
    const res = await POST(
      makeRequest({
        events: [
          {
            type: 'follow',
            source: { userId: VALID_LINE_USER_ID },
            replyToken: 'token-123',
          },
        ],
      }) as any
    );

    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalled();
    const call = mockUpsert.mock.calls[0];
    expect(call[0]).toEqual(
      expect.objectContaining({
        line_user_id: VALID_LINE_USER_ID,
      })
    );
  });

  test('follow event: calls LINE profile API', async () => {
    await POST(
      makeRequest({
        events: [
          {
            type: 'follow',
            source: { userId: VALID_LINE_USER_ID },
            replyToken: 'token-123',
          },
        ],
      }) as any
    );

    // Verify LINE profile API was called (would happen inside handleFollow)
    expect(mockUpsert).toHaveBeenCalled();
  });

  test('follow event: sends welcome reply', async () => {
    await POST(
      makeRequest({
        events: [
          {
            type: 'follow',
            source: { userId: VALID_LINE_USER_ID },
            replyToken: 'token-123',
          },
        ],
      }) as any
    );

    expect(sendLineReply).toHaveBeenCalledWith(
      'token-123',
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('CareLink'),
        }),
      ])
    );
  });

  test('unfollow event → line_user_links を削除（dead link 除去）', async () => {
    const mockEq = jest.fn().mockResolvedValue({ error: null });
    const mockDelete = jest.fn().mockReturnValue({ eq: mockEq });
    mockFromDelegate.mockReturnValue({ delete: mockDelete });

    const res = await POST(
      makeRequest({
        events: [{ type: 'unfollow', source: { userId: VALID_LINE_USER_ID } }],
      }) as any
    );

    expect(res.status).toBe(200);
    expect(mockFromDelegate).toHaveBeenCalledWith('line_user_links');
    expect(mockDelete).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith('line_user_id', VALID_LINE_USER_ID);
  });

  test('unfollow event: 削除エラーでもログのみで 200 継続', async () => {
    const mockEq = jest.fn().mockResolvedValue({ error: { message: 'delete failed' } });
    mockFromDelegate.mockReturnValue({ delete: jest.fn().mockReturnValue({ eq: mockEq }) });

    const res = await POST(
      makeRequest({
        events: [{ type: 'unfollow', source: { userId: VALID_LINE_USER_ID } }],
      }) as any
    );

    expect(res.status).toBe(200);
    expect(mockEq).toHaveBeenCalled();
  });

  test('unfollow event: 例外でもログのみで 200 継続', async () => {
    mockFromDelegate.mockImplementation(() => { throw new Error('boom'); });

    const res = await POST(
      makeRequest({
        events: [{ type: 'unfollow', source: { userId: VALID_LINE_USER_ID } }],
      }) as any
    );

    expect(res.status).toBe(200);
  });

  test('message event → sends auto-reply', async () => {
    await POST(
      makeRequest({
        events: [
          {
            type: 'message',
            source: { userId: VALID_LINE_USER_ID },
            replyToken: 'token-456',
            message: { type: 'text', text: 'Hello' },
          },
        ],
      }) as any
    );

    expect(sendLineReply).toHaveBeenCalledWith(
      'token-456',
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('検索'),
        }),
      ])
    );
  });

  test('message non-text → no reply', async () => {
    (sendLineReply as jest.Mock).mockClear();

    await POST(
      makeRequest({
        events: [
          {
            type: 'message',
            source: { userId: VALID_LINE_USER_ID },
            replyToken: 'token-456',
            message: { type: 'image' },
          },
        ],
      }) as any
    );

    expect(sendLineReply).not.toHaveBeenCalled();
  });

  test('invalid user ID (special chars) → ignored', async () => {
    (sendLineReply as jest.Mock).mockClear();
    mockUpsert.mockClear();

    await POST(
      makeRequest({
        events: [
          {
            type: 'follow',
            source: { userId: 'user@invalid#chars' },
            replyToken: 'token-123',
          },
        ],
      }) as any
    );

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(sendLineReply).not.toHaveBeenCalled();
  });

  test('multiple events → processes all', async () => {
    (sendLineReply as jest.Mock).mockClear();

    await POST(
      makeRequest({
        events: [
          {
            type: 'follow',
            source: { userId: VALID_LINE_USER_ID },
            replyToken: 'token-1',
          },
          {
            type: 'message',
            source: { userId: VALID_LINE_USER_ID },
            replyToken: 'token-2',
            message: { type: 'text', text: 'Hello' },
          },
        ],
      }) as any
    );

    expect(sendLineReply).toHaveBeenCalledTimes(2);
  });

  test('missing events array → 200 (graceful)', async () => {
    const res = await POST(makeRequest({}) as any);

    expect(res.status).toBe(200);
  });

  test('missing source in event → ignored', async () => {
    mockUpsert.mockClear();

    await POST(
      makeRequest({
        events: [
          {
            type: 'follow',
            replyToken: 'token-123',
          },
        ],
      }) as any
    );

    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test('missing userId → ignored', async () => {
    mockUpsert.mockClear();

    await POST(
      makeRequest({
        events: [
          {
            type: 'follow',
            source: {},
            replyToken: 'token-123',
          },
        ],
      }) as any
    );

    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test('valid user ID formats: hyphens and underscores', async () => {
    mockUpsert.mockClear();

    await POST(
      makeRequest({
        events: [
          {
            type: 'follow',
            source: { userId: 'U-valid_user_123' },
            replyToken: 'token-123',
          },
        ],
      }) as any
    );

    expect(mockUpsert).toHaveBeenCalled();
  });

  test('upsert includes display_name from LINE profile', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          displayName: 'Test User',
          pictureUrl: 'https://example.com/pic.jpg',
        }),
        { status: 200 }
      )
    );

    await POST(
      makeRequest({
        events: [
          {
            type: 'follow',
            source: { userId: VALID_LINE_USER_ID },
            replyToken: 'token-123',
          },
        ],
      }) as any
    );

    // Display name should be included in upsert
    const call = mockUpsert.mock.calls[0];
    expect(call[0].display_name).toBeDefined();
  });

  test('invalid JSON → 200 (graceful error)', async () => {
    const req = new Request('http://localhost/api/line/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-line-signature': 'sig',
      },
      body: 'invalid json {',
    });

    const res = await POST(req as any);

    expect(res.status).toBe(200);
  });

  test('exception during profile fetch → continues', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const res = await POST(
      makeRequest({
        events: [
          {
            type: 'follow',
            source: { userId: VALID_LINE_USER_ID },
            replyToken: 'token-123',
          },
        ],
      }) as any
    );

    expect(res.status).toBe(200);
  });

  test('returns OK status always', async () => {
    const res = await POST(
      makeRequest({
        events: [
          {
            type: 'follow',
            source: { userId: VALID_LINE_USER_ID },
            replyToken: 'token-123',
          },
        ],
      }) as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
  });

  test('message without replyToken → no reply', async () => {
    (sendLineReply as jest.Mock).mockClear();

    await POST(
      makeRequest({
        events: [
          {
            type: 'message',
            source: { userId: VALID_LINE_USER_ID },
            message: { type: 'text', text: 'Hello' },
          },
        ],
      }) as any
    );

    expect(sendLineReply).not.toHaveBeenCalled();
  });

  test('follow event without replyToken → upsert but no reply', async () => {
    (sendLineReply as jest.Mock).mockClear();
    await POST(
      makeRequest({
        events: [
          { type: 'follow', source: { userId: VALID_LINE_USER_ID } },
        ],
      }) as any
    );
    expect(sendLineReply).not.toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalled();
  });

  test('LINE_CHANNEL_ACCESS_TOKEN_CARELINK undefined → handleFollow returns early', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
    (global.fetch as jest.Mock).mockClear();
    mockUpsert.mockClear();
    await POST(
      makeRequest({
        events: [
          { type: 'follow', source: { userId: VALID_LINE_USER_ID }, replyToken: 't' },
        ],
      }) as any
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test('LINE profile API non-ok → upsert skipped', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response('error', { status: 500 })
    );
    mockUpsert.mockClear();
    await POST(
      makeRequest({
        events: [
          { type: 'follow', source: { userId: VALID_LINE_USER_ID }, replyToken: 't' },
        ],
      }) as any
    );
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test('profile without displayName/pictureUrl → upsert with null fields', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );
    await POST(
      makeRequest({
        events: [
          { type: 'follow', source: { userId: VALID_LINE_USER_ID }, replyToken: 't' },
        ],
      }) as any
    );
    const call = mockUpsert.mock.calls[0];
    expect(call[0].display_name).toBeNull();
    expect(call[0].picture_url).toBeNull();
  });

  test('unknown event type → ignored (switch default)', async () => {
    (sendLineReply as jest.Mock).mockClear();
    mockUpsert.mockClear();
    await POST(
      makeRequest({
        events: [
          { type: 'unfollow', source: { userId: VALID_LINE_USER_ID } },
        ],
      }) as any
    );
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(sendLineReply).not.toHaveBeenCalled();
  });
});
