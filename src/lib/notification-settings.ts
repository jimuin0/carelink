/**
 * 施設の通知設定（facility_notification_settings）の読み取りヘルパー。
 *
 * 管理画面「設定 → 通知設定」のトグルを各通知送信側で参照し、オン/オフを実際に効かせるための
 * 単一の入口。行が存在しない施設（設定画面を一度も保存していない）には DB 列のデフォルトと同じ値を
 * 返し、既存挙動（無条件送信）と後方互換にする。取得失敗時もデフォルト（送信する方向）へフォール
 * バックし、通知漏れより誤送信を許容する（可用性優先・既存挙動維持）。
 */
import { createServiceRoleClient } from '@/lib/supabase-server';

export type NotificationFlags = {
  pushOnNewBooking: boolean;
  pushOnCancel: boolean;
  pushOnReview: boolean;
  emailDailySummary: boolean;
  emailWeeklyReport: boolean;
};

// DB 列のデフォルト（20260404000002_dashboard_enhancement.sql）に一致させる。
export const DEFAULT_NOTIFICATION_FLAGS: NotificationFlags = {
  pushOnNewBooking: true,
  pushOnCancel: true,
  pushOnReview: true,
  emailDailySummary: false,
  emailWeeklyReport: true,
};

export async function getFacilityNotificationSettings(facilityId: string): Promise<NotificationFlags> {
  try {
    const admin = createServiceRoleClient();
    const { data } = await admin
      .from('facility_notification_settings')
      .select('push_on_new_booking, push_on_cancel, push_on_review, email_daily_summary, email_weekly_report')
      .eq('facility_id', facilityId)
      .maybeSingle();
    if (!data) return DEFAULT_NOTIFICATION_FLAGS;
    return {
      pushOnNewBooking: data.push_on_new_booking ?? DEFAULT_NOTIFICATION_FLAGS.pushOnNewBooking,
      pushOnCancel: data.push_on_cancel ?? DEFAULT_NOTIFICATION_FLAGS.pushOnCancel,
      pushOnReview: data.push_on_review ?? DEFAULT_NOTIFICATION_FLAGS.pushOnReview,
      emailDailySummary: data.email_daily_summary ?? DEFAULT_NOTIFICATION_FLAGS.emailDailySummary,
      emailWeeklyReport: data.email_weekly_report ?? DEFAULT_NOTIFICATION_FLAGS.emailWeeklyReport,
    };
  } catch (e) {
    // 監査X8: 従来は無音でフェイルオープンしており、設定取得障害(DB接続断等)が
    // 誰にも気づかれなかった。可用性優先のフェイルオープン方針は維持しつつ、
    // 障害は可視化する。
    console.error('[notification-settings] 取得失敗・デフォルトへフォールバック', {
      err: e instanceof Error ? e.message : String(e),
    });
    return DEFAULT_NOTIFICATION_FLAGS;
  }
}
