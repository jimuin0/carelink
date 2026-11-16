import { NextResponse } from 'next/server';
import { withRoute } from '@/lib/with-route';
import { lineSupportKnowledge } from '@/lib/line-support-knowledge';

export const dynamic = 'force-dynamic';

/** Only already-public facts are exposed. Customer records never enter this endpoint. */
export const GET = withRoute(async () => NextResponse.json(
  lineSupportKnowledge(process.env.VERCEL_GIT_COMMIT_SHA ?? null),
  { headers: { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' } },
), { csrf: false });
