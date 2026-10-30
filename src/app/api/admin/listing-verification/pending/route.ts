import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute } from '@/lib/with-route';
import { isMissingSalonPhoto } from '@/lib/salon-photo-contract';
import { listingFacilityIdentity } from '@/lib/listing-verification-review';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
const document = z.object({ id:z.uuid(),facility_id:z.uuid(),object_path:z.string(),created_at:z.string(),mime_type:z.string(),byte_size:z.number() }).strict();
const facility = listingFacilityIdentity.extend({ id:z.uuid() }).strict();
const approval = z.object({ facility_id:z.uuid(),facility_identity:listingFacilityIdentity,document_ids:z.array(z.uuid()) }).strict();
const cursor = z.object({ time:z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/), id:z.uuid() }).strict();

/** Only actually uploaded documents appear; a prepared upload is not a submission. */
export const GET = withRoute(async request => {
  const user=await requirePlatformAdmin();
  if (user instanceof NextResponse) return user;
  if (!user) return NextResponse.json({ error:'権限がありません' },{ status:403,headers });
  const params=new URL(request.url).searchParams;
  const rawTime=params.get('time'),rawId=params.get('id');
  const next=rawTime || rawId ? cursor.safeParse({time:rawTime,id:rawId}) : null;
  if (next && !next.success) return NextResponse.json({ error:'一覧を読み直してください' },{ status:400,headers });
  try {
    const db=createServiceRoleClient() as SupabaseClient;
    let query=db.from('listing_verification_documents').select('id,facility_id,object_path,created_at,mime_type,byte_size')
      .order('created_at',{ ascending:false }).order('id',{ ascending:false }).limit(21);
    if (next?.success) query=query.or(`created_at.lt.${next.data.time},and(created_at.eq.${next.data.time},id.lt.${next.data.id})`);
    const documents=await query;
    if (documents.error) throw new Error('unavailable');
    const rows=z.array(document).max(21).parse(documents.data);
    const page=rows.slice(0,20);
    if (!page.length) return NextResponse.json({ facilities:[],next:null },{ headers });
    const ids=[...new Set(page.map(item=>item.facility_id))];
    const [profiles,approvals,objects]=await Promise.all([
      db.from('facility_profiles').select('id,name,prefecture,city,address').in('id',ids),
      db.from('listing_verification_approvals').select('facility_id,facility_identity,document_ids').in('facility_id',ids),
      Promise.all(page.map(item=>db.storage.from('listing-verification').info(item.object_path))),
    ]);
    if (profiles.error || approvals.error) throw new Error('unavailable');
    const facilities=z.array(facility).parse(profiles.data);
    const checked=z.array(approval).parse(approvals.data);
    const result: { id:string;name:string;prefecture:string|null;city:string|null;createdAt:string }[]=[];
    for (let i=0;i<page.length;i++) {
      const item=page[i],object=objects[i],profile=facilities.find(f=>f.id===item.facility_id);
      if (!profile) throw new Error('unavailable');
      if (object.error) { if (isMissingSalonPhoto(object.error)) continue; throw new Error('unavailable'); }
      if (!object.data || object.data.name!==item.object_path || object.data.bucketId!=='listing-verification'
        || object.data.size!==item.byte_size || object.data.contentType!==item.mime_type) throw new Error('unavailable');
      const reviewed=checked.find(a=>a.facility_id===item.facility_id);
      const identity={ name:profile.name,prefecture:profile.prefecture,city:profile.city,address:profile.address };
      if (reviewed && reviewed.document_ids.includes(item.id) && Object.keys(identity).every(key =>
        identity[key as keyof typeof identity]===reviewed.facility_identity[key as keyof typeof identity])) continue;
      if (!result.some(row=>row.id===profile.id)) result.push({ id:profile.id,name:profile.name ?? '',prefecture:profile.prefecture,city:profile.city,createdAt:item.created_at });
    }
    const last=page[page.length-1];
    return NextResponse.json({ facilities:result,next:rows.length>20 ? {time:last.created_at,id:last.id} : null },{headers});
  } catch { return NextResponse.json({ error:'提出書類の一覧を確認できませんでした' },{ status:503,headers }); }
},{ requireAuth:false,sentryTag:'listing-verification-pending' });
