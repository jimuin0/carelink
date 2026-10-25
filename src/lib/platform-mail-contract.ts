import { z } from 'zod';

export const PLATFORM_MAIL_FROM = 'CareLink <support@carelink-jp.com>';
export const PLATFORM_MAIL_REPLY_TO = 'support@carelink-jp.com';
export const platformMailContactSchema = z.object({
  id: z.uuid(), name: z.string(), email: z.string().nullable(), message: z.string().nullable(),
  inquiry_type: z.string().nullable(), created_at: z.iso.datetime({ offset: true }).nullable(),
}).strip();
export type PlatformMailContact = z.infer<typeof platformMailContactSchema>;
export const platformMailState = z.enum(['draft', 'pending', 'scheduled', 'sent', 'cancelling', 'cancelled']);
export const platformMailDraftSchema = z.object({
  id: z.uuid(), revision: z.number().int().nonnegative(),
  contactId: z.uuid().nullable(),
  to: z.string().trim().max(254), subject: z.string().trim().max(200), body: z.string().max(10000),
  scheduledAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();
export const platformMailEnvelopeSchema = z.object({
  from: z.literal(PLATFORM_MAIL_FROM), replyTo: z.literal(PLATFORM_MAIL_REPLY_TO),
  to: z.email().max(254), subject: z.string().min(1).max(200).regex(/^[^\r\n]+$/),
  text: z.string().min(1).max(10000).refine(value => value.trim().length > 0),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
}).strict();
export const platformMailRecordSchema = z.object({
  id: z.uuid(), revision: z.number().int().positive(), contact_id: z.uuid().nullable(),
  recipient: z.string(), subject: z.string(), body: z.string(), state: platformMailState,
  scheduled_at: z.iso.datetime({ offset: true }).nullable(),
  reserved_at: z.iso.datetime({ offset: true }).nullable(),
  accepted_at: z.iso.datetime({ offset: true }).nullable(),
  provider_message_id: z.uuid().nullable(), delivery_status: z.string().nullable(),
  envelope: platformMailEnvelopeSchema.nullable(),
  created_at: z.iso.datetime({ offset: true }), updated_at: z.iso.datetime({ offset: true }),
}).strip();
export type PlatformMailRecord = z.infer<typeof platformMailRecordSchema>;
export type PlatformMailDraft = z.infer<typeof platformMailDraftSchema>;
export type PlatformMailEnvelope = z.infer<typeof platformMailEnvelopeSchema>;

/** All composed customer mail has a fixed, verified business identity. */
export function buildPlatformMailEnvelope(input: PlatformMailDraft, now = Date.now()): PlatformMailEnvelope {
  const draft = platformMailDraftSchema.parse(input);
  const schedule = draft.scheduledAt;
  if (schedule !== null) {
    const time = Date.parse(schedule);
    if (!Number.isFinite(time) || time < now + 60000 || time > now + 30 * 86400000) {
      throw new Error('送信日時は1分後から30日以内で指定してください。');
    }
  }
  return platformMailEnvelopeSchema.parse({
    from: PLATFORM_MAIL_FROM, replyTo: PLATFORM_MAIL_REPLY_TO,
    to: draft.to, subject: draft.subject, text: draft.body,
    ...(schedule === null ? {} : { scheduledAt: schedule }),
  });
}

/** datetime-local is explicitly interpreted as Japan time, never the host timezone. */
export function mailJapanTime(value: string): string | null {
  if (value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('送信日時を確認してください。');
  const date = new Date(value + ':00+09:00');
  if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 16) !== value) {
    throw new Error('送信日時を確認してください。');
  }
  return date.toISOString();
}

export function mailTimeLabel(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
