/**
 * 来店後レビュー依頼 Cron（v8.5）
 * GET /api/cron/review-request
 * 完了予約の24時間後にメール+LINEでレビュー依頼を送信
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { sendLineText } from '@/lib/line';
import { logCronRun } from '@/lib/cron-logger';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = new Date();
  try {
    // 24-48時間前に完了した予約を取得（重複送信防止のため48h上限）
    const now = new Date();
    const h48ago = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const h24ago = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, email, customer_name, user_id, facility_id, updated_at')
      .eq('status', 'completed')
      .gte('updated_at', h48ago)
      .lte('updated_at', h24ago);

    if (!bookings || bookings.length === 0) {
      return NextResponse.json({ status: 'ok', sent: 0 });
    }

    let sent = 0;

    for (const booking of bookings) {
      // 施設名取得
      const { data: facility } = await supabase
        .from('facility_profiles')
        .select('name, slug')
        .eq('id', booking.facility_id)
        .maybeSingle();

      if (!facility) continue;

      const reviewUrl = `https://carelink-jp.com/facility/${facility.slug}#review`;

      // メール送信
      if (booking.email && process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: process.env.EMAIL_FROM || 'CareLink <noreply@carelink-jp.com>',
          to: booking.email,
          subject: `【${facility.name}】ご来店ありがとうございました`,
          html: `<p>${booking.customer_name || 'お客'}様</p><p>先日は<strong>${facility.name}</strong>にご来店いただきありがとうございました。</p><p>よろしければ、口コミを投稿していただけると嬉しいです。</p><p><a href="${reviewUrl}" style="display:inline-block;padding:12px 24px;background:#0284C7;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">口コミを書く</a></p><p style="color:#999;font-size:12px;">口コミを投稿すると50ポイントがもらえます！</p>`,
        }).catch(() => {});
      }

      // LINE通知
      if (booking.user_id && process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) {
        const { data: lineLink } = await supabase
          .from('line_user_links')
          .select('line_user_id')
          .eq('user_id', booking.user_id)
          .maybeSingle();

        if (lineLink?.line_user_id) {
          await sendLineText(
            lineLink.line_user_id,
            `✨ ${facility.name}へのご来店ありがとうございました！\n\n口コミを投稿すると50ポイントプレゼント🎁\n\n👇 口コミを書く\n${reviewUrl}`
          );
        }
      }

      sent++;
    }

    await logCronRun('review-request', 'success', startedAt, { processed: sent });
    return NextResponse.json({ status: 'ok', sent });
  } catch (e) {
    console.error('[review-request] Error:', e);
    await logCronRun('review-request', 'error', startedAt, { error_msg: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
