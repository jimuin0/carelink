/**
 * @jest-environment node
 *
 * Tests for POST /api/slack/interactions (Phase 7b)
 *  - 署名検証なしリクエストは 401
 *  - 改ざんされた署名は 401
 *  - 正しい署名 + actions あり → 200 ack
 *  - payload 欠落 → 400
 *  - 未知の action_id → 200 ack（無視）
 */

import { createHmac } from 'crypto';
import { POST } from '../route';

const SECRET = 'test-signing-secret';

function makeSignedRequest(body: string, opts: { ts?: string; sig?: string } = {}): Request {
  const ts = opts.ts ?? String(Math.floor(Date.now() / 1000));
  const sig =
    opts.sig ??
    'v0=' + createHmac('sha256', SECRET).update(`v0:${ts}:${body}`).digest('hex');
  return new Request('http://localhost/api/slack/interactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-slack-signature': sig,
      'x-slack-request-timestamp': ts,
    },
    body,
  });
}

beforeEach(() => {
  process.env.SLACK_SIGNING_SECRET = SECRET;
});

describe('POST /api/slack/interactions', () => {
  test('署名ヘッダなし → 401', async () => {
    const req = new Request('http://localhost/api/slack/interactions', {
      method: 'POST',
      body: 'payload=%7B%7D',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test('改ざんされた署名 → 401 signature_mismatch', async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const req = makeSignedRequest('payload=%7B%7D', { ts, sig: 'v0=' + 'a'.repeat(64) });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const j = await res.json();
    expect(j.reason).toBe('signature_mismatch');
  });

  test('payload キー欠落 → 400', async () => {
    const req = makeSignedRequest('other=field');
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test('payload が不正 JSON → 400', async () => {
    const body = `payload=${encodeURIComponent('not json{{{')}`;
    const req = makeSignedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test('actions なし → 200 ack（無視）', async () => {
    const body = `payload=${encodeURIComponent(JSON.stringify({ type: 'block_actions' }))}`;
    const req = makeSignedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test('未知の action_id → 200 ack（無視）', async () => {
    const payload = {
      type: 'block_actions',
      user: { id: 'U123', name: 'tester' },
      actions: [{ type: 'button', action_id: 'unknown_action_xyz', value: 'v' }],
    };
    const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
    const req = makeSignedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test('5分以上前の timestamp → 401 stale_timestamp', async () => {
    const oldTs = String(Math.floor(Date.now() / 1000) - 600);
    const body = 'payload=%7B%7D';
    const req = makeSignedRequest(body, { ts: oldTs });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const j = await res.json();
    expect(j.reason).toBe('stale_timestamp');
  });
});
