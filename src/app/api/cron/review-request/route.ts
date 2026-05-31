/**
 * 来店後レビュー依頼 Cron（v8.6）
 * GET /api/cron/review-request
 * 完了予約の24時間後にメール+LINEでレビュー依頼を送信
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { sendLineText } from '@/lib/line';
import { escSubject, esc } from '@/lib/email';
import { logCronRun } from '@/lib/cron-logger';
import { checkCronAuth } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  // 遅延初期化: モジュールスコープで createClient を呼ぶとビルド時の
  // page data 収集フェーズで env 未設定環境（Vercel preview 等）が
  // "supabaseUrl is required" で落ちるため、リクエスト時に生成する。
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const startedAt = new Date();
  try {
    // 24-48時間前に完了した予約を取得（重複送信防止のため review_request_sent_at IS NULL でフィルタ）
    const now = new Date();
    const h48ago = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const h24ago = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, email, customer_name, user_id, facility_id, updated_at')
      .eq('status', 'completed')
      .gte('updated_at', h48ago)
      .lte('updated_at', h24ago)
      .is('review_request_sent_at', null)
      .limit(500);

    if (!bookings || bookings.length === 0) {
      await logCronRun('review-request', 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ processed: 0, skipped: 0, status: 'ok', sent: 0 });
    }

    let sent = 0;
    let skipped = 0;

    for (const booking of bookings) {
      // Claim this booking before sending — prevents duplicate send on double-fire.
      // The .is('review_request_sent_at', null) condition acts as a CAS guard:
      // only one concurrent invocation can update a given row.
      const { data: claimed } = await supabase
        .from('bookings')
        .update({ review_request_sent_at: new Date().toISOString() })
        .eq('id', booking.id)
        .is('review_request_sent_at', null)
        .select('id');

      if (!claimed || claimed.length === 0) { skipped++; continue; } // Another invocation already claimed this booking

      // 施設名取得
      const { data: facility } = await supabase
        .from('facility_profiles')
        .select('name, slug')
        .eq('id', booking.facility_id)
        .maybeSingle();

      if (!facility) { skipped++; continue; }

      const reviewUrl = `https://carelink-jp.com/facility/${facility.slug}#review`;

      // メール送信
      if (booking.email && process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: process.env.EMAIL_FROM || 'CareLink <noreply@carelink-jp.com>',
          to: booking.email,
          subject: escSubject(`【${facility.name}】ご来店ありがとうございました`),
          html: `<p>${esc(booking.customer_name || 'お客')}様</p><p>先日は<strong>${esc(facility.name)}</strong>にご来店いただきありがとうございました。</p><p>よろしければ、口コミを投稿していただけると嬉しいです。</p><p><a href="${reviewUrl}" style="display:inline-block;padding:12px 24px;background:#0284C7;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">口コミを書く</a></p><p style="color:#999;font-size:12px;">口コミを投稿すると50ポイントがもらえます！</p>`,
        }).catch((err) => console.error('[review-request] email send failed', { bookingId: booking.id, err }));
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
          ).catch((err) => console.error('[review-request] LINE send failed', { bookingId: booking.id, err }));
        }
      }

      sent++;
    }

    await logCronRun('review-request', 'success', startedAt, { processed: sent, skipped });
    return NextResponse.json({ processed: sent, skipped });
  } catch (e) {
    console.error('[review-request] Error:', e);
    await logCronRun('review-request', 'error', startedAt, { error_msg: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
