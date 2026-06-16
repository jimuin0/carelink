import { logCronRun } from '@/lib/cron-logger';
/**
 * 誕生日クーポン自動送信 Cron（v8.15）
 * GET /api/cron/birthday-coupon
 * 誕生日のユーザーに100ptボーナスとメール通知を送信
 *
 * v8.15 変更: ポイント付与済みでも通知失敗チャネルを翌 run で再送するよう改修。
 *   birthday_notifications テーブルで送達済みチャネルを管理し、
 *   失敗時は記録しないことで次回 run が再送を試みる（恒久 miss 解消）。
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { sendLineText } from '@/lib/line';
import { checkCronAuth } from '@/lib/cron-auth';
import { fetchAllPaged } from '@/lib/paginate';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://carelink-jp.com';
const FROM = process.env.EMAIL_FROM || 'CareLink <noreply@carelink-jp.com>';
const BIRTHDAY_POINTS = 100;

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
    // 今日の日付（月・日のみ）
    const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const month = (jstNow.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = jstNow.getUTCDate().toString().padStart(2, '0');
    const todayMD = `${month}-${day}`;

    // birth_dateが今日（月日一致）のプロフィールを取得
    // PostgreSQLの TO_CHAR で月日を比較
    // 本日が誕生日の profiles を全件ページング取得（旧 .limit(500) は同日誕生日が500人超で501人目以降に
    // ポイント付与・通知漏れ。本番監査）。email_unsubscribed も取得しメール送信のみ抑止する。
    type BirthdayProfile = { id: string; email: string | null; display_name: string | null; email_unsubscribed: boolean | null };
    const { rows: profiles } = await fetchAllPaged<BirthdayProfile>(
      async (offset, limit) => {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, email, display_name, email_unsubscribed')
          .not('birth_date', 'is', null)
          .filter('birth_date', 'like', `%-${todayMD}`)
          .range(offset, offset + limit - 1);
        return { data: data as BirthdayProfile[] | null, error };
      },
    );

    // profiles は fetchAllPaged の戻り（常に配列）なので length 判定のみ（!profiles は到達不能=branch穴になる）。
    // ログ・返却は main 側のリッチ版（processed/skipped/status/sent を全て返す superset）に統一。
    if (profiles.length === 0) {
      await logCronRun('birthday-coupon', 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ processed: 0, skipped: 0, status: 'ok', sent: 0 });
    }

    const birthdayYear = jstNow.getUTCFullYear();
    // Reason includes the year so the partial unique index (user_id, reason WHERE reason LIKE 'birthday_%')
    // atomically prevents double-awarding even if two cron instances run concurrently.
    const birthdayReason = `birthday_${birthdayYear}`;

    // 当年・全プロフィールの通知送達済みチャネルを一括取得してローカル Set に展開。
    // `${userId}:${channel}` 形式のキーで O(1) 検索。
    const profileIds = profiles.map((p) => p.id);
    const { data: existingNotifications } = await supabase
      .from('birthday_notifications')
      .select('user_id, channel')
      .eq('year', birthdayYear)
      .in('user_id', profileIds);
    const notifiedSet = new Set(
      (existingNotifications || []).map((n) => `${n.user_id}:${n.channel}`)
    );

    let sent = 0;
    let skipped = 0;
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

    for (const profile of profiles) {
      const name = profile.display_name || 'お客様';

      // 誕生日ポイント付与（unique index が 23505 を返せばスキップ — TOCTOU対策）
      const { error: insertErr } = await supabase.from('user_points').insert({
        user_id: profile.id,
        points: BIRTHDAY_POINTS,
        reason: birthdayReason,
      });

      if (insertErr) {
        if ((insertErr as { code?: string }).code === '23505') {
          // 既付与済み: ポイントは届いている。通知未送達チャネルがあれば再送するため
          // continue せずにそのまま通知ブロックへ進む。
        } else {
          // DB エラー: 通知も安全に送れないためスキップ。
          console.error('[birthday-coupon] points insert error:', insertErr);
          skipped++;
          continue;
        }
      }

      // メール通知（未送達かつ送信可能な場合のみ）
      if (resend && profile.email && !profile.email_unsubscribed && !notifiedSet.has(`${profile.id}:email`)) {
        try {
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
          });
          // 送信成功: 送達記録を追加（失敗時は記録しないため翌 run で再送される）
          await supabase.from('birthday_notifications').insert({
            user_id: profile.id,
            year: birthdayYear,
            channel: 'email',
          });
          notifiedSet.add(`${profile.id}:email`);
        } catch (err) {
          console.error('[birthday-coupon] email send failed', { userId: profile.id, err });
        }
      }

      // LINE通知（未送達かつ送信可能な場合のみ）
      if (process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK && !notifiedSet.has(`${profile.id}:line`)) {
        const { data: lineLink } = await supabase
          .from('line_user_links')
          .select('line_user_id')
          .eq('user_id', profile.id)
          .maybeSingle();

        if (lineLink?.line_user_id) {
          try {
            await sendLineText(
              lineLink.line_user_id,
              `🎂 ${name}様、お誕生日おめでとうございます！\n\n本日のお誕生日を記念して、${BIRTHDAY_POINTS}ポイントをプレゼントしました🎁\n\n次回の予約にぜひご利用ください！\n${SITE_URL}/mypage/points`
            );
            // 送信成功: 送達記録を追加
            await supabase.from('birthday_notifications').insert({
              user_id: profile.id,
              year: birthdayYear,
              channel: 'line',
            });
            notifiedSet.add(`${profile.id}:line`);
          } catch (err) {
            console.error('[birthday-coupon] LINE send failed', { userId: profile.id, err });
          }
        }
      }

      if (!insertErr) {
        sent++;
      } else {
        // 23505: ポイントは既付与済み（今回は通知のみ再送を試みた）
        skipped++;
      }
    }

    await logCronRun('birthday-coupon', 'success', startedAt, { processed: sent, skipped });
    return NextResponse.json({ processed: sent, skipped, total: profiles.length });
  } catch (e) {
    console.error('[birthday-coupon] Error:', e);
    await logCronRun('birthday-coupon', 'error', startedAt, { error_msg: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
