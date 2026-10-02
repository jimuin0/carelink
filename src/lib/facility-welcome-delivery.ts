import { z } from 'zod';
import type { Resend } from 'resend';
import type { createServiceRoleClient } from './supabase-server';
import { UUID_REGEX, SITE_URL } from './constants';
import { fromEnv } from './email-from';
import { sendResendForReconciliation, type ResendDeliveryOutcome } from './resend-result';

const reference = z.object({
  webhook_type: z.literal('facility_welcome'), target_id: z.string().regex(UUID_REGEX),
  payload: z.object({ user_id: z.string().regex(UUID_REGEX), template_version: z.literal(1) }).strict(),
});
const owner = z.object({ id: z.string().regex(UUID_REGEX), email: z.string().email(),
  email_confirmed_at: z.string().datetime({ offset: true }),
});
const facility = z.object({ name: z.string().min(1).max(200), status: z.enum(['draft', 'published']) });

/** The queue contains only a user/facility reference. Resolve the current owner
 * before delivery_started_at; don't send to deleted/removed or synthetic users.
 * Ineligible references fail before sending and use the worker's bounded
 * three-attempt/dead-letter path, never an infinite retry or a false success. */
export async function prepareFacilityWelcomeDelivery(
  db: ReturnType<typeof createServiceRoleClient>, input: unknown, resend: Resend | null,
): Promise<() => Promise<ResendDeliveryOutcome>> {
  const parsed = reference.safeParse(input);
  if (!parsed.success) throw new Error('Invalid facility welcome reference');
  if (!resend) throw new Error('Facility welcome email is not configured');
  const job = parsed.data;
  try {
    const membership = await db.from('facility_members').select('user_id,facility_id,role')
      .eq('facility_id', job.target_id).eq('user_id', job.payload.user_id).eq('role', 'owner').maybeSingle();
    if (membership.error || membership.data?.user_id !== job.payload.user_id
      || membership.data.facility_id !== job.target_id || membership.data.role !== 'owner') {
      throw new Error('Facility welcome owner unavailable');
    }
    const profileResult = await db.from('facility_profiles').select('name,status').eq('id', job.target_id).maybeSingle();
    const profile = facility.safeParse(profileResult.data);
    if (profileResult.error || !profile.success) throw new Error('Facility welcome profile unavailable');
    const userResult = await db.auth.admin.getUserById(job.payload.user_id);
    const user = owner.safeParse(userResult.data?.user);
    if (userResult.error || !user.success || user.data.id !== job.payload.user_id
      || user.data.email.toLowerCase().endsWith('@line.carelink.local')) {
      throw new Error('Facility welcome recipient unavailable');
    }
    const email = {
      from: fromEnv(), to: user.data.email, subject: '【CareLink】店舗アカウントを作成しました',
      text: `施設名：${profile.data.name}\n\n店舗アカウントの作成が完了しました。\nこの時点では一般公開の完了を意味しません。無料掲載とオンライン予約は別の設定です。管理画面で都道府県・市区町村・住所と掲載許可を確認し、公開操作を行ってください。オンライン予約はメニュー・スタッフ・写真などの準備を完了し、有効化するまで受付しません。\n${SITE_URL}/admin\n\n掲載申込は店舗ごとに必要です。別店舗の申込を重複として統合しないでください。現行の新規オーナー登録は1アカウント1店舗です。既に複数店舗の管理権限がある場合は管理画面で店舗を選択してください。`,
    };
    return () => sendResendForReconciliation(resend.emails.send(email, {
      idempotencyKey: `facility-welcome-v1-${job.target_id}`,
    }));
  } catch {
    // Auth/provider exceptions may contain raw personal details. Persist only a
    // fixed pre-send failure label; no provider error or record is logged here.
    throw new Error('Facility welcome reference unavailable');
  }
}
