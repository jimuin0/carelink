import { createServiceRoleClient } from './supabase-server';
import type { Json,Database } from '@/types/database.types';
import { z } from 'zod';

type SupportRpcName = 'accept_line_support_event' | 'accept_line_support_events' | 'claim_line_support_event' | 'prepare_line_support_delivery'
  | 'claim_line_support_delivery' | 'finish_line_support_delivery' | 'manage_line_support'
  | 'confirm_line_support_pair_candidate' | 'read_line_support' | 'line_support_work' | 'line_support_history' | 'line_support_job_status' | 'line_support_delivery_context';
type SupportRpcArgs=Database['public']['Functions'][SupportRpcName]['Args'];

/** One narrow migration-backed boundary; parse every receipt before using it. */
export async function lineSupportRpc<T>(name: SupportRpcName, values: Record<string, Json | undefined>, receipt: z.ZodType<T>): Promise<T> {
  const db = createServiceRoleClient();
  const result = await db.rpc(name, values as SupportRpcArgs).abortSignal(AbortSignal.timeout(8000));
  if (result.error) {
    const error = new Error('LINE support storage unavailable') as Error & { code?: string };
    error.code = result.error.code;
    throw error;
  }
  return receipt.parse(result.data);
}

export const supportOperationSchema = z.object({ status: z.string(), conversation_id: z.uuid().optional(), revision: z.number().int().optional(), delivery_id: z.uuid().optional(), draft_id: z.uuid().optional() });
export const supportEventSchema = z.object({
  event_id: z.string().min(1).max(128), conversation_id: z.uuid(), revision: z.number().int().positive(),
  message_type: z.enum(['text','image','file','audio','video','sticker','location','unfollow','unsend','follow']), body: z.string().max(5000),
  occurred_at:z.string(),reply_token:z.string().max(2048).nullable(),reply_expires_at:z.string().nullable(),
  reply_fallback_reason:z.enum(['expired','failed','unknown','policy']).nullable(),
});
export const supportLeaseSchema = z.object({ event: supportEventSchema, mode: z.enum(['automatic','human','closed']) }).nullable();
export const supportDeliverySchema = z.object({
  id: z.uuid(), recipient_id: z.string().regex(/^U[0-9a-f]{32}$/), body: z.string().min(1).max(5000), retry_key: z.uuid(),
  proposal_body:z.string().min(1).max(2400).nullable(),
  kind:z.enum(['customer_reply','operator_draft']),reply_token:z.string().max(2048).nullable(),reply_expires_at:z.string().nullable(),
}).nullable();
export const supportDeliveryContextSchema=z.object({kind:z.enum(['customer_reply','operator_draft']),question:z.string().max(5000).nullable(),message_type:z.string(),mode:z.enum(['automatic','human','closed'])}).nullable();
export const supportJobSchema=z.object({state:z.enum(['pending','processing','done','superseded']),rollout:z.enum(['off','observe','live']),delivery_id:z.uuid().nullable()}).nullable();
