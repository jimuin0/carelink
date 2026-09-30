import { z } from 'zod';
import type { Resend } from 'resend';
import type { createServiceRoleClient } from './supabase-server';
import { UUID_REGEX, SITE_URL } from './constants';
import { fromEnv } from './email-from';
import { postToSlack } from './slack';
import { sendResendForReconciliation, type ResendDeliveryOutcome } from './resend-result';

const jobSchema = z.object({
  registration_id: z.string().regex(UUID_REGEX),
  target_id: z.string(),
  template_version: z.literal(1),
  payload: z.object({}).strict(),
  webhook_type: z.enum(['salon_registration_email', 'salon_registration_internal']),
  notification_kind: z.enum(['receipt', 'internal']),
}).refine(job => job.target_id === job.registration_id
  && (job.webhook_type === 'salon_registration_email'
    ? job.notification_kind === 'receipt' : job.notification_kind === 'internal'));

const sourceSchema = z.enum(['register', 'recruit']);
const receiptSchema = z.object({
  source: z.literal('register'), email: z.string().email(), facility_name: z.string().min(1).max(200),
});

/**
 * Resolve a typed, non-PII queue reference before persisting delivery_started_at.
 * The returned function is the only external effect. It never queues a second
 * job, retries a send, or treats an uncertain provider response as delivered.
 */
export async function prepareSalonOutboxDelivery(
  db: ReturnType<typeof createServiceRoleClient>, input: unknown, resend: Resend | null,
): Promise<() => Promise<ResendDeliveryOutcome>> {
  const parsed = jobSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid registration outbox reference');
  const job = parsed.data;
  if (job.webhook_type === 'salon_registration_internal') {
    if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_DEFAULT_CHANNEL) {
      throw new Error('Registration internal notification is not configured');
    }
    const { data, error } = await db.from('salons').select('source').eq('id', job.registration_id).maybeSingle();
    if (error || !sourceSchema.safeParse(data?.source).success) {
      throw new Error('Registration internal reference unavailable');
    }
    // Version 1 projection: receipt reference and authenticated management URL
    // only. Applicant names, email, phone and free text never reach Slack.
    const text = `【施設掲載申込の受付】\n受付番号：${job.registration_id}\n確認先：${SITE_URL}/admin/registrations`;
    return async () => {
      const result = await postToSlack({ text });
      return result.ok && typeof result.ts === 'string' && result.ts.length > 0 ? 'delivered' : 'uncertain';
    };
  }
  if (!resend) throw new Error('Registration email is not configured');
  const { data, error } = await db.from('salons').select('source,email,facility_name')
    .eq('id', job.registration_id).maybeSingle();
  const receipt = receiptSchema.safeParse(data);
  if (error || !receipt.success) throw new Error('Registration email reference unavailable');
  const email = {
    from: fromEnv(), to: receipt.data.email,
    subject: '【CareLink】掲載申し込みを受け付けました',
    // Plain text deliberately avoids any interpretation of applicant-controlled
    // content as HTML. No proof, applicant name or address goes into the URL.
    text: `CareLinkへの掲載申し込みをいただき、ありがとうございます。\n\n施設名：${receipt.data.facility_name}\n受付番号：${job.registration_id}\n\n掲載申込の受付が完了しました。一般公開は、店舗情報の設定と公開操作の後に反映されます。\n申し込みに使用したブラウザーで、アカウント作成・店舗情報の設定へお進みください。\n${SITE_URL}/admin/onboarding\n\n受付を確認できない場合は、新たに送信せず受付番号を添えてお問い合わせください。\n${SITE_URL}/contact\n\nこのメールに心当たりがない場合は破棄してください。`,
  };
  return () => sendResendForReconciliation(resend.emails.send(email, {
    idempotencyKey: `salon-receipt-v1-${job.registration_id}`,
  }));
}
