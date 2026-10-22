import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {buildFavoritesDigestEnvelope,buildReviewRequestEnvelope} from './email';
import {eventEmailEnvelopeSchema} from './event-email-delivery';

export type ScheduledEmailResult='queued'|'existing'|'accepted'|'skipped'|'legacy_uncertain'|'uncertain'|'failed';
// userId: the booking's user_id captured by reserve_scheduled_email_atomic (null = guest booking).
// Review points are only for members, so the template promises them only when it is a member's booking.
const reviewSnapshot=z.object({email:z.email(),customerName:z.string().nullable(),facilityName:z.string(),facilitySlug:z.string(),userId:z.string().nullable().optional()});
const digestSnapshot=z.object({email:z.email(),userName:z.string().nullable(),unsubscribeToken:z.string().min(32),
 facilities:z.array(z.object({name:z.string(),slug:z.string(),newCoupons:z.number().int().nonnegative(),hasNewMenus:z.boolean()})).min(1).max(200)});

/** Reserve the source-owned operation before rendering. Retry uses the same
 * immutable snapshot and unsubscribe token; publishing commits queue+tombstone. */
export async function queueScheduledEmail(db:SupabaseClient,kind:'review_request'|'favorites_digest',sourceId:string,email:string|null=null):Promise<ScheduledEmailResult> {
 const reserve=await db.rpc('reserve_scheduled_email_atomic',{p_kind:kind,p_source_id:sourceId,p_email:email});
 const row=z.array(z.object({state:z.enum(['reserved','accepted','not_eligible','legacy_uncertain']),operation_id:z.uuid().nullable(),snapshot:z.unknown()})).length(1).safeParse(reserve.data);
 if(reserve.error || !row.success) throw new Error('Scheduled email reservation not confirmed');
 const op=row.data[0];
 if(op.state==='accepted') return 'accepted';
 if(op.state==='not_eligible') return 'skipped';
 if(op.state==='legacy_uncertain') return 'legacy_uncertain';
 if(!op.operation_id) throw new Error('Scheduled email identity missing');
 const envelope=eventEmailEnvelopeSchema.parse(kind==='review_request'
  ? buildReviewRequestEnvelope(reviewSnapshot.parse(op.snapshot))
  : (()=>{const snap=digestSnapshot.parse(op.snapshot);return buildFavoritesDigestEnvelope({userEmail:snap.email,userName:snap.userName??undefined,facilities:snap.facilities,unsubscribeToken:snap.unsubscribeToken});})());
 const prepare=await db.rpc('prepare_scheduled_email_atomic',{p_operation_id:op.operation_id,p_envelope:envelope});
 const receipt=z.array(z.object({id:z.literal(op.operation_id),status:z.enum(['pending','processing','success','failed','uncertain','superseded']),created:z.boolean()})).length(1).safeParse(prepare.data);
 if(prepare.error || !receipt.success) throw new Error('Scheduled email publication not confirmed');
 const saved=receipt.data[0];
 if(saved.status==='success') return 'accepted';
 if(saved.status==='superseded') return 'skipped';
 if(saved.status==='uncertain') return 'uncertain';
 if(saved.status==='failed') return 'failed';
 return saved.created ? 'queued' : 'existing';
}

const reviewCandidate=z.object({id:z.uuid(),updated_at:z.iso.datetime({offset:true})});
const digestCandidate=z.object({user_id:z.uuid()});
export async function scheduledLegacyHolds(db:SupabaseClient,kind:'review_request'|'favorites_digest'):Promise<number> {
 const response=await db.rpc('scheduled_email_legacy_holds');
 const counts=z.object({review_request:z.number().int().nonnegative(),favorites_digest:z.number().int().nonnegative()}).safeParse(response.data);
 if(response.error || !counts.success) throw new Error('Legacy scheduled delivery observation unavailable');
 return counts.data[kind];
}

/** Read the complete bounded candidate batch BEFORE publishing any message.
 * Keyset paging avoids PostgREST's 1000-row cap and mutable offset pages. */
export async function reviewEmailCandidates(db:SupabaseClient):Promise<{ids:string[];more:boolean}> {
 const ids:string[]=[];let afterId:string|null=null;let afterDate:string|null=null;
 for(let n=0;n<2;n++) {
  const response=await db.rpc('list_scheduled_review_recipients',{p_after_updated_at:afterDate,p_after_id:afterId,p_limit:1000});
  const page=z.array(reviewCandidate).max(1000).safeParse(response.data);
  if(response.error || !page.success) throw new Error('Review candidates unavailable');
  ids.push(...page.data.map(x=>x.id));if(page.data.length<1000) return {ids,more:false};
  const last=page.data[page.data.length-1];afterId=last.id;afterDate=last.updated_at;
 }
 return {ids,more:true};
}
export async function digestEmailCandidates(db:SupabaseClient):Promise<string[]> {
 const ids:string[]=[];let after:string|null=null;
 for(let n=0;n<100;n++) {
  const response=await db.rpc('list_scheduled_digest_recipients',{p_after:after,p_limit:1000});
  const page=z.array(digestCandidate).max(1000).safeParse(response.data);
  if(response.error || !page.success) throw new Error('Digest candidates unavailable');
  ids.push(...page.data.map(x=>x.user_id));if(page.data.length<1000) return ids;
  after=page.data[page.data.length-1].user_id;
 }
 throw new Error('Digest candidate safety limit reached before dispatch');
}
