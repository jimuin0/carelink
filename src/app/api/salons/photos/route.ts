import { NextRequest, NextResponse } from 'next/server';
import { withRoute } from '@/lib/with-route';
import { mutationRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { salonPhotoInput } from '@/lib/salon-photo-contract';
import { prepareSalonPhoto } from '@/lib/salon-photo-preparation';
import { isSalonIntentProof, salonIntentCookieName } from '@/lib/salon-submission-proof';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export const POST = withRoute(async request => {
  if (process.env.SALON_REGISTRATION_V2_ENABLED !== 'true') {
    return NextResponse.json({ code: 'NOT_ENABLED' }, { status: 404, headers });
  }
  const parsed = salonPhotoInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ state: 'invalid' }, { status: 400, headers });
  const cookieName = salonIntentCookieName(parsed.data.intentId)!;
  const proof = new NextRequest(request.url, { headers: request.headers }).cookies.get(cookieName)?.value;
  if (!isSalonIntentProof(proof)) return NextResponse.json({ state: 'unverified' }, { status: 403, headers });
  const result = await prepareSalonPhoto(createServiceRoleClient(), parsed.data, proof);
  const status = { invalid: 400, unverified: 403, unavailable: 503, expired: 410,
    committed: 409, conflict: 409, limit: 409, uploaded: 200, upload: 200 }[result.state];
  return NextResponse.json(result, { status, headers });
}, { csrf: true, rateLimit: { limiter: mutationRateLimit, limit: 40, windowMs: 60_000, prefix: 'salon-photo' }, sentryTag: 'salon-photo' });
