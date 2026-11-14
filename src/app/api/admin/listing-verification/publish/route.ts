import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requirePlatformAdminApi } from '@/lib/platform-admin';
import { publishVerifiedFacilityIfReady } from '@/lib/listing-auto-publish';
import { mutationRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute } from '@/lib/with-route';

export const dynamic = 'force-dynamic';
const inputSchema = z.object({ facilityId:z.uuid() }).strict();
const noStore = { 'Cache-Control':'no-store' };

/** 書類を承認済みで公開を待っている店舗の公開を、運営がやり直す（承認直後の公開が一時的な障害で失敗したとき等）。
 * 公開するかどうかは、承認時と同じ規則（アプリの公開の規則 → DB の最後の条件と公開ゲート）で決める。 */
export const POST = withRoute(async request => {
  const user = await requirePlatformAdminApi({ headers: noStore, body: { state: 'forbidden' } });
  if (user instanceof NextResponse) return user;
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ state:'invalid' },{ status:400,headers:noStore });
  const publication = await publishVerifiedFacilityIfReady(createServiceRoleClient() as SupabaseClient, input.data.facilityId, user.id);
  return NextResponse.json({ state:'done',publication },{ status:publication === 'unavailable' ? 503 : 200,headers:noStore });
}, { csrf:true,rateLimit:{ limiter:mutationRateLimit,limit:20,windowMs:60_000,prefix:'listing-verification-publish' },sentryTag:'listing-verification-publish' });
