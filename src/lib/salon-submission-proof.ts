import { createHash, createHmac, hkdfSync } from 'node:crypto';
import { UUID_REGEX } from './constants';

export const SALON_HMAC_SCHEME = 'proof-hkdf-sha256-v1';
export const SALON_INTENT_TTL_SECONDS = 3 * 24 * 60 * 60;

export function isSalonIntentProof(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function salonIntentCookieName(intentId: string): string | null {
  return UUID_REGEX.test(intentId) ? `carelink_salon_intent_${intentId.toLowerCase()}` : null;
}

function proofBytes(proof: string): Buffer {
  if (!isSalonIntentProof(proof)) throw new Error('Invalid registration proof');
  return Buffer.from(proof, 'hex');
}

/** Hash only the random 256-bit capability, never an email, phone or payload. */
export function salonIntentProofHash(proof: string): string {
  return createHash('sha256').update(proofBytes(proof)).digest('hex');
}

/** The opaque browser proof is the key source; no PII digest is logged or returned. */
export function salonPayloadHmac(proof: string, canonicalPayload: string): string {
  const key = hkdfSync('sha256', proofBytes(proof), 'carelink:salon-intent:v1', 'payload-comparison', 32);
  return createHmac('sha256', Buffer.from(key)).update(canonicalPayload, 'utf8').digest('hex');
}
