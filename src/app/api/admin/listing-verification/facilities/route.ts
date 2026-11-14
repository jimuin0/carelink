import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute } from '@/lib/with-route';

export const dynamic='force-dynamic';
const headers={ 'Cache-Control':'no-store' };
const query=z.string().trim().min(2).max(100).refine(value => !value.includes('\0'));
const row=z.object({ id:z.uuid(),name:z.string(),prefecture:z.string().nullable(),city:z.string().nullable(),status:z.string().nullable() }).strict();

/** Find existing listings too; only the platform operator may use this endpoint. */
export const GET=withRoute(async request => {
  const user=await requirePlatformAdmin();
  if (user instanceof NextResponse) return user;
  if (!user) return NextResponse.json({ error:'権限がありません' },{ status:403,headers });
  const input=query.safeParse(new URL(request.url).searchParams.get('q'));
  if (!input.success) return NextResponse.json({ error:'施設名を2文字以上入力してください' },{ status:400,headers });
  try {
    const term=input.data.replace(/[%_\\]/g,'\\$&');
    const result=await createServiceRoleClient().from('facility_profiles').select('id,name,prefecture,city,status')
      .ilike('name',`%${term}%`).order('name').order('id').limit(21);
    if (result.error) throw new Error('unavailable');
    const rows=z.array(row).max(21).parse(result.data);
    return NextResponse.json({ facilities:rows.slice(0,20),hasMore:rows.length>20 },{ headers });
  } catch {
    return NextResponse.json({ error:'施設を検索できませんでした' },{ status:503,headers });
  }
},{ requireAuth:false,sentryTag:'listing-verification-facility-search' });
