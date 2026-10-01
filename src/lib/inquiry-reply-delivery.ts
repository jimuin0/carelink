import { z } from 'zod';
import type { Resend } from 'resend';
import { UUID_REGEX } from './constants';

export const inquiryReplyEnvelopeSchema = z.object({
  from: z.string().min(1).max(320), to: z.email().max(254),
  replyTo: z.string().min(1).max(320), subject: z.string().min(1).max(200),
  html: z.string().min(1).max(40000),
}).strict();
export type InquiryReplyEnvelope = z.infer<typeof inquiryReplyEnvelopeSchema>;
export type InquiryReplyAcceptance = { state: 'accepted'; messageId: string } | { state: 'unknown' };

async function bounded<T>(call: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([call, new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), 10000);
    })]);
  } catch { return null; }
  finally { clearTimeout(timer); }
}

// The envelope is reserved in the DB before dispatch. No fallback queue, new
// operation, or "rejected" state can unlock an earlier uncertain dispatch.
export async function sendInquiryReplyEnvelope(
  client: Resend | null, envelope: InquiryReplyEnvelope, operationId: string,
): Promise<InquiryReplyAcceptance> {
  if (!client || !UUID_REGEX.test(operationId) || !inquiryReplyEnvelopeSchema.safeParse(envelope).success) return { state: 'unknown' };
  // resend-checked: bounded may time out without cancelling dispatch; below we require error-free provider UUID evidence and otherwise retain unknown, never mark sent.
  const result = await bounded(Promise.resolve().then(() => client.emails.send({ ...envelope,
    tags: [{ name: 'carelink_reply_operation', value: operationId }],
  }, { idempotencyKey: operationId })));
  if (result?.error || typeof result?.data?.id !== 'string' || !UUID_REGEX.test(result.data.id)) return { state: 'unknown' };
  return { state: 'accepted', messageId: result.data.id };
}

// Read only at the provider: an ID or 404 alone is not acceptance evidence.
// Check our reserved immutable payload and opaque operation tag, not today's
// mutable contact profile. This operation never sends an email.
export async function verifyInquiryReplyAcceptance(
  client: Resend | null, envelope: InquiryReplyEnvelope, operationId: string, messageId: string, reservedAt: string,
): Promise<InquiryReplyAcceptance> {
  if (!client || !UUID_REGEX.test(operationId) || !UUID_REGEX.test(messageId)
    || !inquiryReplyEnvelopeSchema.safeParse(envelope).success || !Number.isFinite(Date.parse(reservedAt))) return { state: 'unknown' };
  const result = await bounded(Promise.resolve().then(() => client.emails.get(messageId)));
  if (result?.error || !result?.data) return { state: 'unknown' };
  const message = result.data;
  const createdAt = Date.parse(message.created_at);
  if (message.id !== messageId || message.from !== envelope.from || message.subject !== envelope.subject
    || message.html !== envelope.html || !Array.isArray(message.to) || message.to.length !== 1 || message.to[0] !== envelope.to
    || !Array.isArray(message.reply_to) || message.reply_to.length !== 1 || message.reply_to[0] !== envelope.replyTo
    || !Array.isArray(message.tags) || !message.tags.some(tag => tag?.name === 'carelink_reply_operation' && tag.value === operationId)
    || !Number.isFinite(createdAt) || createdAt < Date.parse(reservedAt) - 300000 || createdAt > Date.now() + 300000) return { state: 'unknown' };
  return { state: 'accepted', messageId };
}
