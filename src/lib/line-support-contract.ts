import { z } from 'zod';
export const supportConversationSchema = z.object({ id:z.uuid(),mode:z.enum(['automatic','human','closed']),revision:z.number().int().nonnegative(),blocked:z.boolean(),updated_at:z.string() });
export const supportStoredListSchema = z.object({
  settings:z.object({rollout:z.enum(['off','observe','live']),recipient_verified:z.boolean(),recipient_version:z.number().int(),pair_pending:z.boolean()}),
  conversations:z.array(supportConversationSchema).max(50),
});
export const supportReadinessSchema=z.object({configured:z.boolean(),missing:z.array(z.enum(['enabled','line','drafts','quota','processing','version'])).max(6)});
export const supportListSchema=supportStoredListSchema.extend({readiness:supportReadinessSchema});
export const supportStoredDetailSchema = z.object({
  conversation:supportConversationSchema,
  events:z.array(z.object({event_id:z.string(),revision:z.number().int(),message_type:z.string(),body:z.string(),withdrawn:z.boolean(),occurred_at:z.string(),received_at:z.string()})).max(30),
  drafts:z.array(z.object({id:z.uuid(),conversation_revision:z.number().int(),knowledge_revision:z.string(),model_version:z.string(),body:z.string(),created_at:z.string()})).max(5),
  deliveries:z.array(z.object({id:z.uuid(),conversation_revision:z.number().int(),kind:z.string(),state:z.string(),attempts:z.number().int(),created_at:z.string(),preview:z.string().max(5000).nullable()})).max(10),
});
export const supportDetailSchema=supportStoredDetailSchema.extend({currentKnowledgeRevision:z.string().regex(/^[a-f0-9]{64}$/)});
export const supportCommandSchema = z.discriminatedUnion('action',[
  z.object({action:z.literal('pair_start')}).strict(),
  z.object({action:z.literal('pair_confirm')}).strict(),
  z.object({action:z.literal('unbind')}).strict(),
  z.object({action:z.literal('recover')}).strict(),
  z.object({action:z.literal('rollout'),mode:z.enum(['off','observe','live'])}).strict(),
  z.object({action:z.literal('mode'),conversationId:z.uuid(),revision:z.number().int().nonnegative(),mode:z.enum(['automatic','human','closed'])}).strict(),
]);
