import { z } from 'zod';
import type { Resend } from 'resend';
import type { createServiceRoleClient } from './supabase-server';
import { UUID_REGEX, SITE_URL } from './constants';
import { LISTING_PUBLISH_REQUIREMENT } from './register-photo-policy';
import { fromEnv } from './email-from';
import { sendResendForReconciliation, type ResendDeliveryOutcome } from './resend-result';
import { REGISTRATION_TERMS as T } from './registration-glossary';
import { registrationStepHeading as step } from './registration-flow';

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
      text: `${T.shopName}：${profile.data.name}\n\n店舗の作成が完了しました。この時点では、まだ一般公開されていません。\n\n`
        // 1 段落に詰め込んでいた内容を「4 ステップ」「次にすること」「補足」に分ける。見出しは画面の図と同じ。
        + `■ 一般公開までの4ステップ\n${step('apply', true)}\n${step('account', true)}\n${step('documents')}　← 次はここ\n${step('publish')}\n\n`
        + `■ 次にすること\n1. 管理画面の店舗設定で、住所・営業時間・掲載許可を確認して保存する\n2. 同じ画面から確認書類を提出する\n${SITE_URL}/admin/settings\n\n`
        + `${LISTING_PUBLISH_REQUIREMENT}運営が書類を確認し、設定が揃っていれば自動で公開されます（「書類は後から」と案内された店舗は、設定後に管理画面から公開できます）。\n\n`
        + `■ 補足\n・${T.onlineBooking}は無料掲載とは別です。メニュー・スタッフ・写真を準備して有効にすると受け付けます。\n`
        + `・2店舗目以降も店舗ごとに申し込むと、同じアカウントで切り替えて管理できます。`,
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
