/**
 * Slack 署名検証（Phase 7b interactivity 用）
 *
 * Slack からの POST には以下のヘッダが含まれる:
 *  - X-Slack-Signature: 'v0=<HMAC-SHA256>'
 *  - X-Slack-Request-Timestamp: '<unix epoch seconds>'
 *
 * 検証手順（Slack 公式）:
 *  1. timestamp が現在から 5 分以上ずれていたら reject（replay attack 防止）
 *  2. signing_basestring = `v0:${timestamp}:${raw_body}`
 *  3. expected = `v0=` + HMAC-SHA256(SLACK_SIGNING_SECRET, basestring) を hex 化
 *  4. expected === X-Slack-Signature を timingSafeEqual で比較
 */

import { createHmac, timingSafeEqual } from 'crypto';

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

export function verifySlackRequest(opts: {
  signature: string | null;
  timestamp: string | null;
  rawBody: string;
  signingSecret?: string;
  /** 許容する timestamp の差（秒）。既定 300（Slack 公式値） */
  maxAgeSec?: number;
}): VerifyResult {
  const { signature, timestamp, rawBody } = opts;
  const signingSecret = opts.signingSecret ?? process.env.SLACK_SIGNING_SECRET;
  const maxAgeSec = opts.maxAgeSec ?? 300;

  if (!signingSecret) return { valid: false, reason: 'no_signing_secret' };
  if (!signature) return { valid: false, reason: 'missing_signature' };
  if (!timestamp) return { valid: false, reason: 'missing_timestamp' };

  // 1. timestamp の鮮度（replay 防止）
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return { valid: false, reason: 'invalid_timestamp' };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > maxAgeSec) {
    return { valid: false, reason: 'stale_timestamp' };
  }

  // 2-3. HMAC 計算
  const basestring = `v0:${timestamp}:${rawBody}`;
  const computed = 'v0=' + createHmac('sha256', signingSecret).update(basestring).digest('hex');

  // 4. 定数時間比較
  const aBuf = Buffer.from(computed, 'utf8');
  const bBuf = Buffer.from(signature, 'utf8');
  if (aBuf.length !== bBuf.length) return { valid: false, reason: 'length_mismatch' };
  const ok = timingSafeEqual(aBuf, bBuf);
  return ok ? { valid: true } : { valid: false, reason: 'signature_mismatch' };
}
