import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getAdminApiContext } from '@/lib/admin-api-context';
import { listingEvidenceInputSchema } from '@/lib/listing-verification-evidence';
import { prepareListingEvidence } from '@/lib/listing-verification-preparation';
import { mutationRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute } from '@/lib/with-route';

export const dynamic = 'force-dynamic';
const inputSchema = listingEvidenceInputSchema.extend({ documentId: z.uuid(),sha256:z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const noStore = { 'Cache-Control': 'no-store' };

export const POST = withRoute(async request => {
  const req = new NextRequest(request.url, { headers: request.headers });
  const context = await getAdminApiContext(req);
  if (context instanceof NextResponse) return context;
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ state:'invalid' }, { status:400,headers:noStore });
  // The database validates the membership again while creating the manifest.
  // Temporary generic typing covers the new RPC until local types are generated.
  const db = createServiceRoleClient() as SupabaseClient;
  const result = await prepareListingEvidence(db, { ...input.data,actorId:context.userId,facilityId:context.facilityId });
  const status = { invalid:400,unverified:403,conflict:409,limit:409,unavailable:503,uploaded:200,upload:200 }[result.state];
  return NextResponse.json(result, { status,headers:noStore });
}, { csrf:true,rateLimit:{ limiter:mutationRateLimit,limit:30,windowMs:60_000,prefix:'listing-evidence-prepare' },sentryTag:'listing-evidence-prepare' });
