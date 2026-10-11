import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withRoute } from '@/lib/with-route';
import { mutationRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { verifyRecaptcha } from '@/lib/recaptcha';
import { prepareSalonIntent, readSalonIntentStatus } from '@/lib/salon-submission-intent';
import { isSalonIntentProof, salonIntentCookieName, SALON_INTENT_TTL_SECONDS } from '@/lib/salon-submission-proof';
import { readSalonStorageLimits } from '@/lib/salon-storage-limits';

export const dynamic = 'force-dynamic';
const input = z.object({ recaptcha_token: z.string().max(8192).optional(), intentId: z.uuid().optional() }).strict();
const headers = { 'Cache-Control': 'no-store' };

export const POST = withRoute(async request => {
  // Activation requires photo/claim consumers and deployed schema together.
  // No browser caller is switched over while this release gate remains closed.
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 400, headers });
  if (!parsed.data.intentId && process.env.SALON_REGISTRATION_V2_ENABLED !== 'true') {
    return NextResponse.json({ code: 'NOT_ENABLED' }, { status: 404, headers });
  }
  if (!parsed.data.intentId && process.env.RECAPTCHA_SECRET_KEY) {
    if (!parsed.data.recaptcha_token || !(await verifyRecaptcha(parsed.data.recaptcha_token, 'salons', 0.4)).success) {
      return NextResponse.json({ code: 'BOT_VERIFICATION_FAILED' }, { status: 403, headers });
    }
  }
  let existingProof: string | undefined;
  if (parsed.data.intentId) {
    const name = salonIntentCookieName(parsed.data.intentId)!;
    existingProof = new NextRequest(request.url, { headers: request.headers }).cookies.get(name)?.value;
    if (!isSalonIntentProof(existingProof)) return NextResponse.json({ state: 'unverified' }, { status: 403, headers });
  }
  const db = createServiceRoleClient();
  // A bucket read with data+error or an incompatible restriction must fail
  // before issuing a new capability or reserving a manifest/intent.
  const storage = await readSalonStorageLimits(db);
  if (storage.state !== 'ready') return NextResponse.json({ code: 'PHOTO_CONFIGURATION_UNAVAILABLE' }, { status: 503, headers });
  if (parsed.data.intentId) {
    const existing = await readSalonIntentStatus(db, parsed.data.intentId, existingProof);
    if (existing.state !== 'uncommitted') return NextResponse.json(existing, { status: existing.state === 'unavailable' ? 503 : existing.state === 'unverified' ? 403 : 409, headers });
    // Refresh configuration for this same selector; never allocate another
    // intent after a page reload or a malformed/lost handshake response.
    return NextResponse.json({ state: 'prepared', intentId: parsed.data.intentId, consumerVersion: 2, photoLimits: storage.limits }, { status: 200, headers });
  }
  const prepared = await prepareSalonIntent(db);
  if (prepared.state !== 'prepared') {
    return NextResponse.json({ code: 'PREPARATION_UNAVAILABLE' }, { status: 503, headers });
  }
  const cookieName = salonIntentCookieName(prepared.intentId);
  if (!cookieName) return NextResponse.json({ code: 'PREPARATION_UNAVAILABLE' }, { status: 503, headers });
  const response = NextResponse.json({ state: 'prepared', intentId: prepared.intentId, expiresAt: prepared.expiresAt,
    consumerVersion: 2, photoLimits: storage.limits }, { status: 201, headers });
  response.cookies.set(cookieName, prepared.proof, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
    path: '/', maxAge: SALON_INTENT_TTL_SECONDS,
  });
  return response;
}, { csrf: true, rateLimit: { limiter: mutationRateLimit, limit: 5, windowMs: 60_000, prefix: 'salon-prepare' }, sentryTag: 'salon-prepare' });
