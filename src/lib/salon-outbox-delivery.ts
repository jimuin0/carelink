import { z } from 'zod';
import type { Resend } from 'resend';
import type { createServiceRoleClient } from './supabase-server';
import { UUID_REGEX, SITE_URL } from './constants';
import { fromEnv } from './email-from';
import { postToSlack } from './slack';
import { sendResendForReconciliation, type ResendDeliveryOutcome } from './resend-result';
import { salonRecoveryAuthPath } from './salon-browser-context';
import { REGISTRATION_TERMS as T } from './registration-glossary';

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
const internalSchema = z.object({ source: sourceSchema, facility_name: z.string().trim().min(1).max(200) });
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
    const { data, error } = await db.from('salons').select('source,facility_name').eq('id', job.registration_id).maybeSingle();
    const registration = internalSchema.safeParse(data);
    if (error || !registration.success) {
      throw new Error('Registration internal reference unavailable');
    }
    // Escape Slack markup and line breaks in applicant-supplied names.
    const name = registration.data.facility_name.replace(/[\r\n\t]+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const text = `CareLink ${T.application}の受付\n店舗名：${name}\n確認先：${SITE_URL}/admin/registrations`;
    return async () => {
      const result = await postToSlack({ text, unfurl_links: false, unfurl_media: false });
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
    // 用語は掲載申込の導線と同じ（registration-glossary.ts）。以前は件名が「掲載申し込み」、
    // 本文の欄名が「施設名」で、受付画面（掲載申込・店舗名）と別の手続きに見えた。
    subject: `【CareLink】${T.application}を受け付けました`,
    // Plain text deliberately avoids any interpretation of applicant-controlled
    // content as HTML. No proof, applicant name or address goes into the URL.
    // 🔴 以前は「申込時のタブに戻って次のURLを開いてください」と案内していたが、スマホのメールアプリからは
    // 申込時のタブに戻れない（2026年10月23日）。リンク先は、確認済みのログインメールで申込を選び直せる
    // /register/recover へ進む登録画面にする（タブ・ブラウザに依存しない唯一の入口）。
    text: `CareLinkへの${T.application}をいただき、ありがとうございます。\n\n${T.shopName}：${receipt.data.facility_name}\n受付番号：${job.registration_id}\n\n掲載申込の受付が完了しました。一般公開は、店舗情報の設定と公開操作の後に反映されます。\n\n【次の手順】申込の続き（店舗情報の確認・設定）へ進むには、このメールを受け取ったメールアドレス（${receipt.data.email}）で${T.account}を作成してください。別のメールアドレスで作成すると、この申込を引き継げません。スマートフォンや別のブラウザからでも続けられます。\n${SITE_URL}${salonRecoveryAuthPath('signup')}\n\nすでに同じメールアドレスでアカウントをお持ちの場合は、こちらからログインしてください。\n${SITE_URL}${salonRecoveryAuthPath('login')}\n\n受付を確認できない場合は、新たに送信せず受付番号を添えてお問い合わせください。\n${SITE_URL}/contact\n\nこのメールに心当たりがない場合は破棄してください。`,
  };
  return () => sendResendForReconciliation(resend.emails.send(email, {
    idempotencyKey: `salon-receipt-v1-${job.registration_id}`,
  }));
}
