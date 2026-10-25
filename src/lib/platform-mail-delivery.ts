import { Resend } from 'resend';
import { UUID_REGEX } from './constants';
import { platformMailEnvelopeSchema, type PlatformMailEnvelope } from './platform-mail-contract';

type Acceptance = { state: 'accepted'; id: string } | { state: 'unknown' };
export type MailObservation = { id: string; event: string } | null;
const events: Readonly<Record<string, string>> = {
  scheduled: 'scheduled', sent: 'sent', delivered: 'delivered', delivery_delayed: 'delayed',
  bounced: 'bounced', complained: 'complained', canceled: 'cancelled', failed: 'failed',
  queued: 'accepted', opened: 'delivered', clicked: 'delivered', suppressed: 'failed',
};
export function platformMailProvider(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}
async function bounded<T>(call: () => Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(call), new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), 10000);
    })]);
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export async function dispatchPlatformMail(client: Resend | null, envelope: PlatformMailEnvelope, id: string): Promise<Acceptance> {
  if (!client || !UUID_REGEX.test(id) || !platformMailEnvelopeSchema.safeParse(envelope).success) return { state: 'unknown' };
  // resend-checked: the DB freezes the full envelope before any dispatch. An unknown outcome stays locked and reuses the same provider idempotency key.
  const response = await bounded(() => client.emails.send({ ...envelope,
    tags: [{ name: 'carelink_operator_mail', value: id }],
  }, { idempotencyKey: id }));
  if (response?.error || typeof response?.data?.id !== 'string' || !UUID_REGEX.test(response.data.id)) return { state: 'unknown' };
  return { state: 'accepted', id: response.data.id };
}

/** A provider ID alone is never evidence: match the immutable message and opaque operation tag. */
export async function inspectPlatformMail(client: Resend | null, envelope: PlatformMailEnvelope, id: string, providerId: string, reservedAt: string): Promise<MailObservation> {
  if (!client || !UUID_REGEX.test(id) || !UUID_REGEX.test(providerId)
    || !platformMailEnvelopeSchema.safeParse(envelope).success || !Number.isFinite(Date.parse(reservedAt))) return null;
  const response = await bounded(() => client.emails.get(providerId));
  if (response?.error || !response?.data) return null;
  const message = response.data;
  const created = Date.parse(message.created_at);
  if (message.id !== providerId || message.from !== envelope.from || message.subject !== envelope.subject
    || message.text !== envelope.text || !Array.isArray(message.to) || message.to.length !== 1 || message.to[0] !== envelope.to
    || !Array.isArray(message.reply_to) || message.reply_to.length !== 1 || message.reply_to[0] !== envelope.replyTo
    || !Array.isArray(message.tags) || !message.tags.some(tag => tag.name === 'carelink_operator_mail' && tag.value === id)
    || !Number.isFinite(created) || created < Date.parse(reservedAt) - 300000 || created > Date.now() + 300000
    || (message.last_event === 'scheduled' && (!envelope.scheduledAt || !message.scheduled_at || Date.parse(message.scheduled_at) !== Date.parse(envelope.scheduledAt)))) return null;
  const event = events[message.last_event];
  return event ? { id: providerId, event } : null;
}

export async function cancelPlatformMail(client: Resend | null, envelope: PlatformMailEnvelope, id: string, providerId: string, reservedAt: string): Promise<MailObservation> {
  const observed = await inspectPlatformMail(client, envelope, id, providerId, reservedAt);
  if (!client || observed?.event !== 'scheduled') return observed;
  // Resend cancellation addresses this exact immutable message, never a newly created operation.
  const result = await bounded(() => client.emails.cancel(providerId));
  if (!result?.error && result?.data?.id === providerId) return { id: providerId, event: 'cancelled' };
  return inspectPlatformMail(client, envelope, id, providerId, reservedAt);
}
