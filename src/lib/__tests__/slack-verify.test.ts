/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for src/lib/slack-verify.ts (Phase 7b)
 * Slack 公式の署名仕様に準拠することを検証
 */

import { createHmac } from 'crypto';
import { verifySlackRequest } from '../slack-verify';

const SECRET = 'test-signing-secret';
const NOW_SEC = Math.floor(Date.now() / 1000);

function signRequest(timestamp: string, body: string, secret = SECRET): string {
  const basestring = `v0:${timestamp}:${body}`;
  return 'v0=' + createHmac('sha256', secret).update(basestring).digest('hex');
}

describe('verifySlackRequest', () => {
  test('正しい署名 + 鮮度 OK → valid', () => {
    const ts = String(NOW_SEC);
    const body = 'payload=%7B%22type%22%3A%22block_actions%22%7D';
    const sig = signRequest(ts, body);
    expect(verifySlackRequest({
      signature: sig, timestamp: ts, rawBody: body, signingSecret: SECRET,
    })).toEqual({ valid: true });
  });

  test('SLACK_SIGNING_SECRET が無い → no_signing_secret', () => {
    expect(verifySlackRequest({
      signature: 'v0=...', timestamp: String(NOW_SEC), rawBody: '', signingSecret: '',
    })).toEqual({ valid: false, reason: 'no_signing_secret' });
  });

  test('signature 欠落 → missing_signature', () => {
    expect(verifySlackRequest({
      signature: null, timestamp: String(NOW_SEC), rawBody: '', signingSecret: SECRET,
    })).toEqual({ valid: false, reason: 'missing_signature' });
  });

  test('timestamp 欠落 → missing_timestamp', () => {
    expect(verifySlackRequest({
      signature: 'v0=x', timestamp: null, rawBody: '', signingSecret: SECRET,
    })).toEqual({ valid: false, reason: 'missing_timestamp' });
  });

  test('timestamp が数値以外 → invalid_timestamp', () => {
    expect(verifySlackRequest({
      signature: 'v0=x', timestamp: 'abc', rawBody: '', signingSecret: SECRET,
    })).toEqual({ valid: false, reason: 'invalid_timestamp' });
  });

  test('timestamp が 5分以上前 → stale_timestamp (replay 防止)', () => {
    const oldTs = String(NOW_SEC - 600);
    const body = 'x';
    const sig = signRequest(oldTs, body);
    expect(verifySlackRequest({
      signature: sig, timestamp: oldTs, rawBody: body, signingSecret: SECRET,
    })).toEqual({ valid: false, reason: 'stale_timestamp' });
  });

  test('timestamp が 5分以上未来 → stale_timestamp', () => {
    const futureTs = String(NOW_SEC + 600);
    const body = 'x';
    const sig = signRequest(futureTs, body);
    expect(verifySlackRequest({
      signature: sig, timestamp: futureTs, rawBody: body, signingSecret: SECRET,
    })).toEqual({ valid: false, reason: 'stale_timestamp' });
  });

  test('署名長が違う → length_mismatch', () => {
    const ts = String(NOW_SEC);
    expect(verifySlackRequest({
      signature: 'v0=tooshort', timestamp: ts, rawBody: 'x', signingSecret: SECRET,
    })).toEqual({ valid: false, reason: 'length_mismatch' });
  });

  test('署名が改ざんされている → signature_mismatch', () => {
    const ts = String(NOW_SEC);
    const body = 'payload=%7B%22type%22%3A%22block_actions%22%7D';
    // ダミーで正しい長さの違う署名を作る
    const wrongSig = 'v0=' + 'a'.repeat(64);
    expect(verifySlackRequest({
      signature: wrongSig, timestamp: ts, rawBody: body, signingSecret: SECRET,
    })).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  test('body が改ざんされている → signature_mismatch', () => {
    const ts = String(NOW_SEC);
    const validBody = 'payload=%7B%22a%22%3A1%7D';
    const sig = signRequest(ts, validBody);
    const tamperedBody = 'payload=%7B%22a%22%3A2%7D';
    expect(verifySlackRequest({
      signature: sig, timestamp: ts, rawBody: tamperedBody, signingSecret: SECRET,
    })).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  test('signing_secret が違う → signature_mismatch', () => {
    const ts = String(NOW_SEC);
    const body = 'x';
    const sig = signRequest(ts, body, 'wrong-secret');
    expect(verifySlackRequest({
      signature: sig, timestamp: ts, rawBody: body, signingSecret: SECRET,
    })).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  test('maxAgeSec カスタム指定（短く）', () => {
    const oldTs = String(NOW_SEC - 30);
    const body = 'x';
    const sig = signRequest(oldTs, body);
    expect(verifySlackRequest({
      signature: sig, timestamp: oldTs, rawBody: body, signingSecret: SECRET, maxAgeSec: 10,
    })).toEqual({ valid: false, reason: 'stale_timestamp' });
  });

  test('signingSecret 引数で env を上書き', () => {
    process.env.SLACK_SIGNING_SECRET = 'env-secret';
    const ts = String(NOW_SEC);
    const body = 'x';
    const sig = signRequest(ts, body, 'override-secret');
    expect(verifySlackRequest({
      signature: sig, timestamp: ts, rawBody: body, signingSecret: 'override-secret',
    })).toEqual({ valid: true });
  });
});
