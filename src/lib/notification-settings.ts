/**
 * 施設の通知設定（facility_notification_settings）の読み取りヘルパー。
 *
 * 管理画面「設定 → 通知設定」のトグルを各通知送信側で参照し、オン/オフを実際に効かせるための
 * 単一の入口。行が存在しない施設（設定画面を一度も保存していない）には DB 列のデフォルトと同じ値を
 * 返す。取得失敗や不正な応答は「設定なし」と区別し、送信を許可せず例外を返す。
 * 呼び出し側は保存済みの予約・口コミを再実行せず、通知準備の失敗として記録する。
 *
 * push_on_* は Push だけ、email_* はメールだけを制御する（1 つのトグルで両方を止めない）。
 * 以前は口コミのメールが push_on_review に相乗りしており、『口コミ投稿（Push通知）』を
 * OFF にするとメールまで黙って止まった（2026年10月23日 email_on_review を分離）。
 */
import { createServiceRoleClient } from '@/lib/supabase-server';
import { isMissingColumnError, warnMissingColumnFallback } from '@/lib/db-fallback';
import { z } from 'zod';

export type NotificationFlags = {
  pushOnNewBooking: boolean;
  pushOnCancel: boolean;
  pushOnReview: boolean;
  emailOnReview: boolean;
  emailDailySummary: boolean;
  emailWeeklyReport: boolean;
};

// DB 列のデフォルト（20260404000002_dashboard_enhancement.sql・20261023100000）に一致させる。
export const DEFAULT_NOTIFICATION_FLAGS: NotificationFlags = {
  pushOnNewBooking: true,
  pushOnCancel: true,
  pushOnReview: true,
  emailOnReview: true,
  emailDailySummary: false,
  emailWeeklyReport: true,
};

const settingsSchema = z.object({
  push_on_new_booking: z.boolean().nullable(),
  push_on_cancel: z.boolean().nullable(),
  push_on_review: z.boolean().nullable(),
  email_on_review: z.boolean(),
  email_daily_summary: z.boolean().nullable(),
  email_weekly_report: z.boolean().nullable(),
});

// email_on_review を除いた形（20261023100000 が未適用の DB を読むときだけ使う）。
const settingsWithoutReviewEmailSchema = settingsSchema.omit({ email_on_review: true });

type SettingsRow = z.infer<typeof settingsWithoutReviewEmailSchema>;

function toFlags(row: SettingsRow, emailOnReview: boolean): NotificationFlags {
  return {
    pushOnNewBooking: row.push_on_new_booking ?? DEFAULT_NOTIFICATION_FLAGS.pushOnNewBooking,
    pushOnCancel: row.push_on_cancel ?? DEFAULT_NOTIFICATION_FLAGS.pushOnCancel,
    pushOnReview: row.push_on_review ?? DEFAULT_NOTIFICATION_FLAGS.pushOnReview,
    emailOnReview,
    emailDailySummary: row.email_daily_summary ?? DEFAULT_NOTIFICATION_FLAGS.emailDailySummary,
    emailWeeklyReport: row.email_weekly_report ?? DEFAULT_NOTIFICATION_FLAGS.emailWeeklyReport,
  };
}

export async function getFacilityNotificationSettings(facilityId: string): Promise<NotificationFlags> {
  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('facility_notification_settings')
    .select('push_on_new_booking, push_on_cancel, push_on_review, email_on_review, email_daily_summary, email_weekly_report')
    .eq('facility_id', facilityId)
    .maybeSingle();
  // 🔴 アプリが migration 20261023100000 より先にデプロイされた場合（Vercel は main へのマージで自動デプロイ）、
  // 列が無いだけで設定の読み取りが失敗し、この変更と無関係の口コミ Push まで止まってしまう。
  // そのときだけ列を除いて読み直し、口コミのメールは migration の既定値（true）で扱う。
  if (isMissingColumnError(error)) return readWithoutReviewEmailColumn(admin, facilityId);
  if (error) throw new Error('facility notification settings read failed');
  if (data === null) return { ...DEFAULT_NOTIFICATION_FLAGS };
  const parsed = settingsSchema.safeParse(data);
  if (!parsed.success) throw new Error('facility notification settings response invalid');
  return toFlags(parsed.data, parsed.data.email_on_review);
}

async function readWithoutReviewEmailColumn(
  admin: ReturnType<typeof createServiceRoleClient>,
  facilityId: string,
): Promise<NotificationFlags> {
  warnMissingColumnFallback('facility_notification_settings.email_on_review');
  const { data, error } = await admin
    .from('facility_notification_settings')
    .select('push_on_new_booking, push_on_cancel, push_on_review, email_daily_summary, email_weekly_report')
    .eq('facility_id', facilityId)
    .maybeSingle();
  if (error) throw new Error('facility notification settings read failed');
  if (data === null) return { ...DEFAULT_NOTIFICATION_FLAGS };
  const parsed = settingsWithoutReviewEmailSchema.safeParse(data);
  if (!parsed.success) throw new Error('facility notification settings response invalid');
  return toFlags(parsed.data, DEFAULT_NOTIFICATION_FLAGS.emailOnReview);
}
