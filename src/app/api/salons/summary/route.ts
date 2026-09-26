import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withRoute } from '@/lib/with-route';
import { mutationRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { readSalonRegistrationSummary } from '@/lib/salon-registration-summary';
import { isSalonIntentProof, salonIntentCookieName } from '@/lib/salon-submission-proof';

export const dynamic = 'force-dynamic';
const input = z.object({ intentId: z.uuid() }).strict();
const headers = { 'Cache-Control': 'no-store' };
// POST body + per-intent HttpOnly cookie. Neither the receipt nor the intent is
// forwarded through login/OAuth URLs, analytics query strings or Referer.
export const POST = withRoute(async request => {
  if (process.env.SALON_REGISTRATION_V2_ENABLED !== 'true') {
    return NextResponse.json({ code: 'NOT_ENABLED' }, { status: 404, headers });
  }
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ state: 'invalid' }, { status: 400, headers });
  const proof = new NextRequest(request.url, { headers: request.headers }).cookies
    .get(salonIntentCookieName(parsed.data.intentId)!)?.value;
  if (!isSalonIntentProof(proof)) return NextResponse.json({ state: 'unverified' }, { status: 403, headers });
  const result = await readSalonRegistrationSummary(createServiceRoleClient(), parsed.data.intentId, proof);
  return NextResponse.json(result, { status: result.state === 'unavailable' ? 503 : result.state === 'unverified' ? 403 : 200, headers });
}, { csrf: true, rateLimit: { limiter: mutationRateLimit, limit: 20, windowMs: 60_000, prefix: 'salon-summary' }, sentryTag: 'salon-summary' });
