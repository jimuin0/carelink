import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withRoute } from '@/lib/with-route';
import { mutationRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { readSalonIntentStatus } from '@/lib/salon-submission-intent';
import { isSalonIntentProof, salonIntentCookieName } from '@/lib/salon-submission-proof';

export const dynamic = 'force-dynamic';
const input = z.object({ intentId: z.uuid() }).strict();
const headers = { 'Cache-Control': 'no-store' };

// POST keeps intent selectors out of analytics, Referer and URL access logs.
export const POST = withRoute(async request => {
  if (process.env.SALON_REGISTRATION_V2_ENABLED !== 'true') {
    return NextResponse.json({ code: 'NOT_ENABLED' }, { status: 404, headers });
  }
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: 'INVALID_REQUEST' }, { status: 400, headers });
  const name = salonIntentCookieName(parsed.data.intentId)!;
  const proof = new NextRequest(request.url, { headers: request.headers }).cookies.get(name)?.value;
  if (!isSalonIntentProof(proof)) return NextResponse.json({ state: 'unverified' }, { status: 403, headers });
  const result = await readSalonIntentStatus(createServiceRoleClient(), parsed.data.intentId, proof);
  const status = result.state === 'unavailable' ? 503 : result.state === 'unverified' ? 403 : 200;
  return NextResponse.json(result, { status, headers });
}, { csrf: true, rateLimit: { limiter: mutationRateLimit, limit: 20, windowMs: 60_000, prefix: 'salon-status' }, sentryTag: 'salon-status' });
