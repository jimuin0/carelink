import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash,randomUUID } from 'node:crypto';

/** Seed only isolated CI data through the same DB gates used for real listings. */
export async function approveSyntheticListing(db:SupabaseClient,facilityId:string,ownerId?:string,publish=true) {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const app=process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
  const ciLocal=process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true'
    && url === 'https://localhost:54330' && app === 'https://localhost:3000';
  const local=['http://127.0.0.1:54321','http://localhost:54321','http://[::1]:54321'].includes(url ?? '')
    && ['http://localhost:3000','http://127.0.0.1:3000','http://[::1]:3000'].includes(app);
  if (!ciLocal && !local) throw new Error('Synthetic review requires isolated localhost');
  if (!ownerId) {
    const owner=await db.auth.admin.createUser({ email:`synthetic-owner-${randomUUID()}@example.invalid`,password:randomUUID(),email_confirm:true });
    if (owner.error || !owner.data.user) throw new Error('Synthetic owner unavailable');
    ownerId=owner.data.user.id;
    const member=await db.from('facility_members').insert({ user_id:ownerId,facility_id:facilityId,role:'owner' });
    if (member.error) throw new Error('Synthetic owner membership unavailable');
  }
  const operator=await db.auth.admin.createUser({ email:`synthetic-review-${randomUUID()}@example.invalid`,password:randomUUID(),email_confirm:true });
  if (operator.error || !operator.data.user) throw new Error('Synthetic reviewer unavailable');
  const actor=operator.data.user.id;
  const promoted=await db.from('profiles').update({ is_platform_admin:true }).eq('id',actor).select('id').single();
  if (promoted.error || !promoted.data) throw new Error('Synthetic reviewer role unavailable');
  const docId=randomUUID(); const bytes=Buffer.from('%PDF-synthetic');
  const prep=await db.rpc('prepare_listing_verification_document',{ p_actor_id:ownerId,p_facility_id:facilityId,
    p_document_id:docId,p_document_type:'other',p_mime_type:'application/pdf',p_byte_size:bytes.length,
    p_sha256:createHash('sha256').update(bytes).digest('hex') });
  if (prep.error || prep.data?.length !== 1 || prep.data[0].outcome !== 'prepared') throw new Error('Synthetic document preparation failed');
  const uploaded=await db.storage.from('listing-verification').upload(prep.data[0].object_path,bytes,{ contentType:'application/pdf',upsert:false });
  if (uploaded.error) throw new Error('Synthetic document upload failed');
  const facility=await db.from('facility_profiles').select('name,prefecture,city,address').eq('id',facilityId).single();
  if (facility.error || !facility.data) throw new Error('Synthetic facility unavailable');
  const approved=await db.rpc('approve_listing_verification',{ p_actor_id:actor,p_facility_id:facilityId,p_document_ids:[docId],
    p_expected_identity:facility.data,p_document_verified:true,p_authority_verified:true });
  if (approved.error || approved.data !== true) throw new Error('Synthetic review failed');
  if (publish) {
    const published=await db.from('facility_profiles').update({ status:'published' }).eq('id',facilityId).select('id').single();
    if (published.error || !published.data) throw new Error('Synthetic publication failed');
  }
  return ownerId;
}
