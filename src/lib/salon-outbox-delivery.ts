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
  notification_kind: z.enum(['receipt', 'internal', 'approval', 'approval_sent']),
}).refine(job => job.target_id === job.registration_id
  && (job.webhook_type === 'salon_registration_email'
    ? job.notification_kind === 'receipt' || job.notification_kind === 'approval'
    : job.notification_kind === 'internal' || job.notification_kind === 'approval_sent'));

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
    // approval_sent は、承認のお知らせメールを申込者へ送信できた後にだけ積まれる（下の approval を参照）。
    const text = job.notification_kind === 'approval_sent'
      ? `CareLink ${T.application}の承認メールを申込者へ送信しました\n店舗名：${name}\n確認先：${SITE_URL}/admin/registrations`
      : `CareLink ${T.application}の受付\n店舗名：${name}\n確認先：${SITE_URL}/admin/registrations`;
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
  if (job.notification_kind === 'approval') {
    // 文面は送る時点の状態で決める（承認から送信まで最大 15 分あり、その間に状態が変わり得る）。
    // 承認が取り消されていたら送らない（取り消し時に DB が止めるが、送信の直前にも確かめる）。
    const current = await db.from('salons').select('status,claimed_facility_id').eq('id', job.registration_id).maybeSingle();
    const state = z.object({ status: z.string().nullable(), claimed_facility_id: z.uuid().nullable() }).safeParse(current.data);
    if (current.error || !state.success) throw new Error('Registration approval state unavailable');
    if (state.data.status !== 'approved') throw new Error('Registration is no longer approved');
    // 「書類は後から」（2026-11-03 本人決定）が付いた申込には、先に公開・書類は公開後、と案内する。
    const deferral = await db.from('listing_verification_deferrals').select('deferred').eq('salon_id', job.registration_id).maybeSingle();
    const checked = z.object({ deferred: z.boolean() }).nullable().safeParse(deferral.data);
    if (deferral.error || !checked.success) throw new Error('Registration document deferral unavailable');
    let published = false;
    if (state.data.claimed_facility_id) {
      const facility = await db.from('facility_profiles').select('status').eq('id', state.data.claimed_facility_id).maybeSingle();
      const facilityState = z.object({ status: z.string() }).nullable().safeParse(facility.data);
      if (facility.error || !facilityState.success) throw new Error('Registration facility state unavailable');
      published = facilityState.data?.status === 'published';
    }
    const stage = published ? 'published' : checked.data?.deferred === true ? 'deferred' : 'documents';
    return prepareApprovalEmail(db, job.registration_id, receipt.data, resend, stage, checked.data?.deferred === true);
  }
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
    text: `CareLinkへの${T.application}をいただき、ありがとうございます。\n\n${T.shopName}：${receipt.data.facility_name}\n受付番号：${job.registration_id}\n\n掲載申込の受付が完了しました。一般公開は、店舗情報の設定と、運営による確認書類の確認が済んだ後に反映されます。\n\n【次の手順】申込の続き（店舗情報の確認・設定）へ進むには、このメールを受け取ったメールアドレス（${receipt.data.email}）で${T.account}を作成してください。別のメールアドレスで作成すると、この申込を引き継げません。スマートフォンや別のブラウザからでも続けられます。\n${SITE_URL}${salonRecoveryAuthPath('signup')}\n\nすでに同じメールアドレスでアカウントをお持ちの場合は、こちらからログインしてください。\n${SITE_URL}${salonRecoveryAuthPath('login')}\n\n受付を確認できない場合は、新たに送信せず受付番号を添えてお問い合わせください。\n${SITE_URL}/contact\n\nこのメールに心当たりがない場合は破棄してください。`,
  };
  return () => sendResendForReconciliation(resend.emails.send(email, {
    idempotencyKey: `salon-receipt-v1-${job.registration_id}`,
  }));
}

/**
 * 運営が掲載申込を「承認」したときのお知らせ（2026-11-03 本人決定）。
 * ジョブは申込の状態が approved に変わったときに DB のトリガが 1 件だけ積む
 * （supabase/migrations/20261103090000_registration_approval_notice.sql）。
 * 承認は公開ではないので、公開までに申込者がすることを書く。送信できたら、運営の Slack へ
 * 「送信しました」を知らせるジョブ（approval_sent）を積む。積めなかったときだけ直接 Slack へ送る。
 */
function prepareApprovalEmail(
  db: ReturnType<typeof createServiceRoleClient>, registrationId: string,
  receipt: z.infer<typeof receiptSchema>, resend: Resend, stage: 'published' | 'deferred' | 'documents', documentsDeferred: boolean,
): () => Promise<ResendDeliveryOutcome> {
  const createStep = `【1】${T.shop}を作成する（まだの方）\nこのメールを受け取ったメールアドレス（${receipt.email}）でログインし、申込を選んで${T.shop}を作成してください。${T.account}が無い場合は、同じメールアドレスで作成してください。\n`
    + `ログイン：${SITE_URL}${salonRecoveryAuthPath('login')}\n${T.account}の作成：${SITE_URL}${salonRecoveryAuthPath('signup')}\n\n`;
  const body = stage === 'published'
    // 店舗の作成・公開が承認より先に済んでいる（「書類は後から」・書類の確認での公開など）。
    ? `${T.shop}はすでに CareLink に公開されています。\n\n`
      + (documentsDeferred ? `確認書類がまだの場合は、管理画面の施設設定から、${T.shopName}・所在地・運営者を確認できる書類を提出してください。\n\n` : '')
    : `※この時点では、まだ一般公開されていません。公開までに、次の手順をお願いします。\n\n` + createStep + (stage === 'deferred'
    ? `【2】${T.shop}情報を整えて公開する\n所在地・曜日ごとの営業時間（定休日を含む）などを設定し、管理画面から公開できます。\n\n`
      + `【3】確認書類を公開後に提出する\n管理画面の施設設定から、${T.shopName}・所在地・運営者を確認できる書類を提出してください。\n\n`
    : `【2】確認書類を提出する\n${T.shop}の作成後、管理画面の施設設定から、${T.shopName}・所在地・運営者を確認できる書類を提出してください。\n\n`
      + `【3】公開\n運営が書類を確認すると、所在地・曜日ごとの営業時間（定休日を含む）などの設定が済んでいれば、そのまま公開されます。まだの場合は、管理画面で設定を済ませた時点で公開されます。\n\n`);
  const email = {
    from: fromEnv(), to: receipt.email,
    // 受付メールと同じく、申込者が入力した店舗名は件名に入れない（本文だけ）。
    subject: `【CareLink】${T.application}を確認しました`,
    text: `CareLink 運営です。${T.application}を確認しました。\n\n${T.shopName}：${receipt.facility_name}\n受付番号：${registrationId}\n\n`
      + body
      + `ご不明な点は、受付番号を添えてお問い合わせください。\n${SITE_URL}/contact\n\nこのメールに心当たりがない場合は破棄してください。`,
  };
  return async () => {
    const outcome = await sendResendForReconciliation(resend.emails.send(email, {
      idempotencyKey: `salon-approval-v1-${registrationId}`,
    }));
    if (outcome !== 'delivered') return outcome;
    const queued = await db.from('webhook_retry_queue').insert({
      webhook_type: 'salon_registration_internal', target_id: registrationId, payload: {},
      registration_id: registrationId, notification_kind: 'approval_sent', template_version: 1,
    });
    // 23505 は「既に積んである」＝重複送信を防げているので成功と同じ扱い。
    // 応答だけが失われて実は積めていた場合に二重に知らせないよう、直接送る前に積めたかを読み直す。
    const missing = queued.error && queued.error.code !== '23505'
      ? await db.from('webhook_retry_queue').select('id').eq('registration_id', registrationId)
        .eq('notification_kind', 'approval_sent').eq('template_version', 1).maybeSingle()
        .then(found => !found.error && found.data === null, () => false)
      : false;
    if (missing) {
      await postToSlack({
        text: `CareLink ${T.application}の承認メールを申込者へ送信しました\n確認先：${SITE_URL}/admin/registrations`,
        unfurl_links: false, unfurl_media: false,
      }).catch(() => undefined);
    }
    return outcome;
  };
}
