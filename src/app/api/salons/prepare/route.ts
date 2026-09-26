import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withRoute } from '@/lib/with-route';
import { mutationRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { verifyRecaptcha } from '@/lib/recaptcha';
import { prepareSalonIntent } from '@/lib/salon-submission-intent';
import { salonIntentCookieName, SALON_INTENT_TTL_SECONDS } from '@/lib/salon-submission-proof';

export const dynamic = 'force-dynamic';
const input = z.object({ recaptcha_token: z.string().max(8192).optional() }).strict();
const headers = { 'Cache-Control': 'no-store' };

export const POST = withRoute(async request => {
  // Activation requires photo/claim consumers and deployed schema together.
  // No browser caller is switched over while this release gate remains closed.
  if (process.env.SALON_REGISTRATION_V2_ENABLED !== 'true') {
    return NextResponse.json({ code: 'NOT_ENABLED' }, { status: 404, headers });
  }
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 400, headers });
  if (process.env.RECAPTCHA_SECRET_KEY) {
    if (!parsed.data.recaptcha_token || !(await verifyRecaptcha(parsed.data.recaptcha_token, 'salons', 0.4)).success) {
      return NextResponse.json({ code: 'BOT_VERIFICATION_FAILED' }, { status: 403, headers });
    }
  }
  const prepared = await prepareSalonIntent(createServiceRoleClient());
  if (prepared.state !== 'prepared') {
    return NextResponse.json({ code: 'PREPARATION_UNAVAILABLE' }, { status: 503, headers });
  }
  const cookieName = salonIntentCookieName(prepared.intentId);
  if (!cookieName) return NextResponse.json({ code: 'PREPARATION_UNAVAILABLE' }, { status: 503, headers });
  const response = NextResponse.json({ state: 'prepared', intentId: prepared.intentId, expiresAt: prepared.expiresAt }, { status: 201, headers });
  response.cookies.set(cookieName, prepared.proof, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
    path: '/', maxAge: SALON_INTENT_TTL_SECONDS,
  });
  return response;
}, { csrf: true, rateLimit: { limiter: mutationRateLimit, limit: 5, windowMs: 60_000, prefix: 'salon-prepare' }, sentryTag: 'salon-prepare' });
