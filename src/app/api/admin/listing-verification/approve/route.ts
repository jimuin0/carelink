import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { approveListingEvidence, listingFacilityIdentity } from '@/lib/listing-verification-review';
import { mutationRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute } from '@/lib/with-route';

export const dynamic = 'force-dynamic';
const inputSchema = z.object({ facilityId:z.uuid(),documentIds:z.array(z.uuid()).min(1).max(5)
  .refine(ids => new Set(ids).size === ids.length),expectedIdentity:listingFacilityIdentity,
  documentVerified:z.literal(true),authorityVerified:z.literal(true) }).strict();
const noStore = { 'Cache-Control':'no-store' };

export const POST = withRoute(async request => {
  const user = await requirePlatformAdmin();
  if (user instanceof NextResponse) return user;
  if (!user) return NextResponse.json({ state:'forbidden' },{ status:403,headers:noStore });
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ state:'invalid' },{ status:400,headers:noStore });
  // The transaction re-checks the operator's current role under a DB lock.
  const result = await approveListingEvidence(createServiceRoleClient() as SupabaseClient, { ...input.data,actorId:user.id });
  const status = { invalid:400,forbidden:403,not_found:404,invalid_document:422,unavailable:503,approved:200 }[result.state];
  return NextResponse.json(result,{ status,headers:noStore });
}, { csrf:true,rateLimit:{ limiter:mutationRateLimit,limit:20,windowMs:60_000,prefix:'listing-verification-approve' },sentryTag:'listing-verification-approve' });
