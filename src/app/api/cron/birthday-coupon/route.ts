/**
 * 誕生日クーポン自動送信 Cron（v8.14）
 * GET /api/cron/birthday-coupon
 * 誕生日のユーザーに100ptボーナスとメール通知を送信
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { sendLineText } from '@/lib/line';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://carelink-jp.com';
const FROM = process.env.EMAIL_FROM || 'CareLink <noreply@carelink-jp.com>';
const BIRTHDAY_POINTS = 100;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 今日の日付（月・日のみ）
    const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const month = (jstNow.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = jstNow.getUTCDate().toString().padStart(2, '0');
    const todayMD = `${month}-${day}`;

    // birth_dateが今日（月日一致）のプロフィールを取得
    // PostgreSQLの TO_CHAR で月日を比較
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .not('birth_date', 'is', null)
      .filter('birth_date', 'like', `%-${todayMD}`);

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ status: 'ok', sent: 0 });
    }

    let sent = 0;
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

    for (const profile of profiles) {
      const name = profile.display_name || 'お客様';

      // 重複送信防止: 今日既にポイント付与済みか確認
      const todayStart = new Date(jstNow);
      todayStart.setUTCHours(0, 0, 0, 0);
      const todayStartStr = new Date(todayStart.getTime() - 9 * 60 * 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from('user_points')
        .select('id')
        .eq('user_id', profile.id)
        .eq('reason', 'birthday')
        .gte('created_at', todayStartStr)
        .limit(1);
      if (existing && existing.length > 0) continue;

      // 誕生日ポイント付与
      await supabase.from('user_points').insert({
        user_id: profile.id,
        points: BIRTHDAY_POINTS,
        reason: 'birthday',
      });

      // メール送信
      if (resend && profile.email) {
        await resend.emails.send({
          from: FROM,
          to: profile.email,
          subject: '🎂 お誕生日おめでとうございます！CareLink より',
          html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;line-height:1.6;max-width:600px;margin:0 auto;padding:20px;">
            <div style="text-align:center;margin-bottom:24px;"><strong style="color:#0ea5e9;font-size:20px;">CareLink</strong></div>
            <div style="text-align:center;padding:32px;background:linear-gradient(135deg,#fef9c3,#fff);border-radius:16px;margin-bottom:24px;">
              <p style="font-size:32px;margin:0 0 8px;">🎂</p>
              <p style="font-size:24px;font-weight:bold;color:#0ea5e9;margin:0;">${name}様、お誕生日おめでとうございます！</p>
            </div>
            <p>本日のお誕生日を記念して、<strong>${BIRTHDAY_POINTS}ポイント</strong>をプレゼントしました🎁</p>
            <p>ポイントは次回の予約時にお使いいただけます。ぜひお気に入りの施設を予約してお楽しみください！</p>
            <p style="text-align:center;margin-top:24px;">
              <a href="${SITE_URL}/mypage/points" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;">ポイントを確認する</a>
            </p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0 16px;" />
            <p style="font-size:12px;color:#94a3b8;text-align:center;">このメールは <a href="${SITE_URL}" style="color:#0ea5e9;">CareLink</a> から自動送信されています。</p>
          </body></html>`,
        }).catch(() => {});
      }

      // LINE通知
      if (process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) {
        const { data: lineLink } = await supabase
          .from('line_user_links')
          .select('line_user_id')
          .eq('user_id', profile.id)
          .maybeSingle();

        if (lineLink?.line_user_id) {
          await sendLineText(
            lineLink.line_user_id,
            `🎂 ${name}様、お誕生日おめでとうございます！\n\n本日のお誕生日を記念して、${BIRTHDAY_POINTS}ポイントをプレゼントしました🎁\n\n次回の予約にぜひご利用ください！\n${SITE_URL}/mypage/points`
          ).catch(() => {});
        }
      }

      sent++;
    }

    return NextResponse.json({ status: 'ok', sent, total: profiles.length });
  } catch (e) {
    console.error('[birthday-coupon] Error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
