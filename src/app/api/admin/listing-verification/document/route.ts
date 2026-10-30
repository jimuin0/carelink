import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { readListingEvidence } from '@/lib/listing-verification-review';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute } from '@/lib/with-route';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

export const dynamic = 'force-dynamic';
const ids = z.object({ facilityId:z.uuid(),documentId:z.uuid() }).strict();
const noStore = { 'Cache-Control':'no-store' };

export const GET = withRoute(async request => {
  const user = await requirePlatformAdmin();
  if (user instanceof NextResponse) return user;
  if (!user) return NextResponse.json({ error:'権限がありません' },{ status:403,headers:noStore });
  const query = new URL(request.url).searchParams;
  const input = ids.safeParse({ facilityId:query.get('facility_id'),documentId:query.get('document_id') });
  if (!input.success) return NextResponse.json({ error:'書類を確認できません' },{ status:400,headers:noStore });
  const result = await readListingEvidence(createServiceRoleClient() as SupabaseClient,input.data.facilityId,input.data.documentId);
  if (result.state !== 'ready') return NextResponse.json({ error:'書類を確認できません' },
    { status:result.state === 'not_found' ? 404 : result.state === 'invalid_document' ? 422 : 503,headers:noStore });
  const { ip,ua } = getRequestContext(request);
  void writeAuditLog({ userId:user.id,facilityId:input.data.facilityId,action:'export',tableName:'listing_verification_documents',
    recordId:input.data.documentId,ipAddress:ip,userAgent:ua });
  const extension = result.mimeType === 'application/pdf' ? 'pdf' : result.mimeType === 'image/png' ? 'png' : 'jpg';
  return new NextResponse(new Uint8Array(result.bytes).buffer, { headers:{ ...noStore,
    'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="listing-document.${extension}"`,
    'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox" } });
}, { requireAuth:false,rateLimit:{ limiter:null,limit:30,windowMs:60_000,prefix:'listing-evidence-view' },sentryTag:'listing-evidence-view' });
