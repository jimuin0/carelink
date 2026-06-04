/**
 * キャンセル待ち通知 Cron（v8.34）
 * GET /api/cron/waitlist-notify
 * 1時間ごとに実行: キャンセルが発生したウェイトリストエントリに通知を送る
 * 通知後48時間で未予約なら expired に遷移
 */

import { createServiceRoleClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { logCronRun } from '@/lib/cron-logger';
import { Resend } from 'resend';
import { checkCronAuth } from '@/lib/cron-auth';
import { escSubject, esc } from '@/lib/email';
import { sendLineText } from '@/lib/line';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const startedAt = new Date();
  const supabase = createServiceRoleClient();

  try {
    const now = new Date();

    // 1. 通知から48時間以上経過した waiting→expired 遷移
    const { count: expiredCount } = await supabase
      .from('booking_waitlist')
      .update({ status: 'expired' })
      .eq('status', 'notified')
      .lt('notified_at', new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString())
      .select('id');

    // 2. キャンセルが発生したスロットのウェイトリストを検索
    // キャンセルされた予約（過去1時間以内にキャンセル）に対応するウェイトリストを探す
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const { data: recentCancels } = await supabase
      .from('bookings')
      .select('facility_id, booking_date, start_time, end_time, updated_at')
      .eq('status', 'cancelled')
      .gte('updated_at', oneHourAgo)
      .gte('booking_date', now.toISOString().split('T')[0]); // 過去日は無視

    let notified = 0;

    if (recentCancels && recentCancels.length > 0) {
      const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

      for (const cancel of recentCancels) {
        // 同じ施設・日時のウェイトリスト（waiting 状態のもの）を取得
        const { data: waiters } = await supabase
          .from('booking_waitlist')
          .select('id, customer_name, email, line_user_id, date, start_time')
          .eq('facility_id', cancel.facility_id)
          .eq('date', cancel.booking_date)
          .eq('start_time', cancel.start_time)
          .eq('status', 'waiting')
          .order('created_at', { ascending: true })
          .limit(3); // 最大3人に通知（先着順）

        if (!waiters || waiters.length === 0) continue;

        // 施設名取得
        const { data: facility } = await supabase
          .from('facility_profiles')
          .select('name, slug')
          .eq('id', cancel.facility_id)
          .maybeSingle();

        if (!facility) continue;

        const bookingUrl = `https://carelink-jp.com/facility/${facility.slug}/booking`;
        for (const waiter of waiters) {
          // 通知手段が無い待機者は claim しない（旧実装は email/LINE 無しでも notified に claim し、
          // 送信せず notified++ していたため、客は未受信のまま 48h で expired し順番を失っていた）。
          // email（resend設定時）または LINE（line_user_id＋トークン設定時）のいずれかで通知できる場合のみ claim する。
          const canEmail = !!(waiter.email && resend);
          const canLine = !!(waiter.line_user_id && process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK);
          if (!canEmail && !canLine) continue;

          // Atomic claim: only send if we win the status transition (CAS guard).
          const { data: claimed } = await supabase
            .from('booking_waitlist')
            .update({
              status: 'notified',
              notified_at: now.toISOString(),
              expires_at: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
            })
            .eq('id', waiter.id)
            .eq('status', 'waiting')
            .select('id');

          if (!claimed || claimed.length === 0) continue;

          // メール優先、失敗/不可なら LINE。いずれかで配信できたら notified++。
          // 全チャネル失敗時は claim を 'waiting' に戻し次回 cron で再通知する（順番喪失を防ぐ）。
          let delivered = false;
          if (canEmail) {
            try {
              await resend!.emails.send({
                from: process.env.EMAIL_FROM || 'CareLink <noreply@carelink-jp.com>',
                to: waiter.email,
                subject: escSubject(`【空きが出ました】${facility.name} ${waiter.date} ${waiter.start_time}〜`),
                html: `<p>${esc(waiter.customer_name)}様</p>
<p>キャンセル待ちしていた<strong>${esc(facility.name)}</strong>の<strong>${esc(waiter.date)} ${esc(waiter.start_time)}〜</strong>に空きが出ました！</p>
<p>お早めにご予約ください。（この通知から48時間以内に予約されない場合、次の方へ順番が移ります）</p>
<p><a href="${bookingUrl}" style="display:inline-block;padding:12px 24px;background:#0284C7;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">今すぐ予約する</a></p>`,
              });
              delivered = true;
            } catch (err) {
              console.error('[waitlist-notify] email send failed', { waiterId: waiter.id, err });
            }
          }
          if (!delivered && canLine) {
            try {
              await sendLineText(waiter.line_user_id as string,
                `【空きが出ました】${facility.name}\n${waiter.date} ${waiter.start_time}〜 に空きが出ました。\n48時間以内にご予約ください。\n${bookingUrl}`);
              delivered = true;
            } catch (err) {
              console.error('[waitlist-notify] LINE send failed', { waiterId: waiter.id, err });
            }
          }

          if (!delivered) {
            // 全チャネル失敗 → claim を巻き戻し（waiting）。次回 cron で再通知。
            console.error('[waitlist-notify] all channels failed — reverting claim to waiting', { waiterId: waiter.id });
            await supabase
              .from('booking_waitlist')
              .update({ status: 'waiting', notified_at: null, expires_at: null })
              .eq('id', waiter.id);
            continue; // notified++ しない
          }

          notified++;
        }
      }
    }

    await logCronRun('waitlist-notify', 'success', startedAt, {
      processed: notified,
      meta: { expired: expiredCount ?? 0 },
    });

    return NextResponse.json({ processed: notified, skipped: 0, expired: expiredCount ?? 0 });
  } catch (e) {
    await logCronRun('waitlist-notify', 'error', startedAt, {
      error_msg: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
