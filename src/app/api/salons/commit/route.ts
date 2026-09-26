import { NextRequest, NextResponse } from 'next/server';
import { withRoute } from '@/lib/with-route';
import { mutationRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { commitSalonSubmission, salonCommitInput } from '@/lib/salon-submission-commit';
import { isSalonIntentProof, salonIntentCookieName } from '@/lib/salon-submission-proof';
import { salonFieldErrors } from '@/lib/salon-field-errors';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export const POST = withRoute(async request => {
  if (process.env.SALON_REGISTRATION_V2_ENABLED !== 'true') {
    return NextResponse.json({ code: 'NOT_ENABLED' }, { status: 404, headers });
  }
  const parsed = salonCommitInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const fieldErrors = salonFieldErrors(parsed.error.issues
      .filter(issue => issue.path[0] === 'registration').map(issue => ({ path: issue.path.slice(1) })));
    return NextResponse.json({ state: 'invalid', fieldErrors }, { status: 400, headers });
  }
  const name = salonIntentCookieName(parsed.data.intentId)!;
  const proof = new NextRequest(request.url, { headers: request.headers }).cookies.get(name)?.value;
  if (!isSalonIntentProof(proof)) return NextResponse.json({ state: 'unverified' }, { status: 403, headers });
  const result = await commitSalonSubmission(createServiceRoleClient(), parsed.data, proof);
  const status = { invalid: 400, unverified: 403, expired: 410, conflict: 409,
    unavailable: 503, photo_unverified: 409, unknown: 202, committed: 201, replay: 200 }[result.state];
  // Keep the same HttpOnly capability for response-loss reconciliation. Do not
  // create an unbound legacy claim cookie from a public receipt identifier.
  return NextResponse.json(result, { status, headers });
}, { csrf: true, rateLimit: { limiter: mutationRateLimit, limit: 10, windowMs: 60_000, prefix: 'salon-commit' }, sentryTag: 'salon-commit' });
