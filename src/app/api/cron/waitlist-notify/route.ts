/**
 * キャンセル待ち通知 Cron（v8.34）
 * GET /api/cron/waitlist-notify
 * 1時間ごとに実行: キャンセルが発生したウェイトリストエントリに通知を送る
 * 通知後48時間で未予約なら expired に遷移
 */

import { createServiceRoleClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { logCronRun } from '@/lib/cron-logger';
import { errorMessage } from '@/lib/err';
import { Resend } from 'resend';
import { checkCronAuth } from '@/lib/cron-auth';
import { todayJst } from '@/lib/admin-date';
import { escSubject, esc } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const startedAt = new Date();
  const supabase = createServiceRoleClient();

  try {
    const now = new Date();

    // 1. 通知から48時間以上経過した waiting→expired 遷移
    // 更新件数を得るには count オプションを .update() 側に渡す（指定しないと count は null）。
    // 旧実装は .select('id') のみで count を取り出していたため expired メタが常に null→0 だった。
    const { count: expiredCount, error: expiredError } = await supabase
      .from('booking_waitlist')
      .update({ status: 'expired' }, { count: 'exact' })
      .eq('status', 'notified')
      .lt('notified_at', new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString())
      .select('id');

    // expired 遷移は副次的クリーンアップ。失敗しても通知本体は続行するが、無音にせず可視化する。
    if (expiredError) {
      console.error('[waitlist-notify] expired transition failed', { err: errorMessage(expiredError) });
    }

    // 2. キャンセルが発生したスロットのウェイトリストを検索
    // キャンセルされた予約に対応するウェイトリストを探す。
    // 検出窓は cron 間隔(1h)より広い 2h にして 1h のオーバーラップを持たせる。
    // 旧実装は 1h 固定窓だったため、ある run で waiters/施設取得が一過性失敗すると、
    // 翌 run では当該キャンセルの updated_at が 1h を超えて窓外になり恒久 miss になっていた。
    // 2h 窓なら同じキャンセルが 2 回の run で拾われ、一過性失敗は次 run で自己修復する。
    // 二重通知は booking_waitlist の CAS(.eq('status','waiting')) が防ぐ（既通知は 'notified' で
    // 除外され、送信失敗で 'waiting' に戻したもののみ再送対象になる）。
    const LOOKBACK_MS = 2 * 60 * 60 * 1000;
    const lookbackFrom = new Date(now.getTime() - LOOKBACK_MS).toISOString();
    const { data: recentCancels, error: cancelsError } = await supabase
      .from('bookings')
      .select('facility_id, booking_date, start_time, end_time, updated_at')
      .eq('status', 'cancelled')
      .gte('updated_at', lookbackFrom)
      .gte('booking_date', todayJst()); // 過去日は無視（JST 暦日基準。UTC だと JST 早朝に前日が混入）

    // 核データの取得失敗を握り潰すと「通知0件＝success」に化け無音スキップになる→error ログ＋500。
    if (cancelsError) {
      await logCronRun('waitlist-notify', 'error', startedAt, { error_msg: errorMessage(cancelsError) });
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

    let notified = 0;

    if (recentCancels && recentCancels.length > 0) {
      const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

      for (const cancel of recentCancels) {
        // 同じ施設・日時のウェイトリスト（waiting 状態のもの）を取得。
        // error を無音で握ると「待ち客なし」と区別できず恒久 miss になるため可視化する
        // （2h オーバーラップ窓により、一過性失敗は次 run で自己修復される）。
        const { data: waiters, error: waitersError } = await supabase
          .from('booking_waitlist')
          .select('id, customer_name, email, line_user_id, date, start_time')
          .eq('facility_id', cancel.facility_id)
          .eq('date', cancel.booking_date)
          .eq('start_time', cancel.start_time)
          .eq('status', 'waiting')
          .order('created_at', { ascending: true })
          .limit(3); // 最大3人に通知（先着順）

        if (waitersError) {
          console.error('[waitlist-notify] waiters query failed', {
            facilityId: cancel.facility_id, date: cancel.booking_date, err: errorMessage(waitersError),
          });
          continue; // 次 run(2h 窓内)で再試行される
        }
        if (!waiters || waiters.length === 0) continue;

        // 施設名取得。error は待ち客ありのケースで通知不能を招くため可視化する。
        const { data: facility, error: facilityError } = await supabase
          .from('facility_profiles')
          .select('name, slug')
          .eq('id', cancel.facility_id)
          .maybeSingle();

        if (facilityError) {
          console.error('[waitlist-notify] facility query failed', {
            facilityId: cancel.facility_id, err: errorMessage(facilityError),
          });
          continue; // 次 run(2h 窓内)で再試行される
        }
        if (!facility) continue;

        for (const waiter of waiters) {
          // 通知手段が無い（email 未登録 or Resend 未設定）待ち客を claim すると、通知が一切
          // 届かないのに status='notified' でスロットを 48h 占有し、次の待ち客へ順番が移らない
          // 恒久 miss になる。さらに notified++ で「通知した」と誤集計される。送れない待ち客は
          // claim せず skip し、本当に送れる次の待ち客へ順番が回るようにする（無音 miss 防止）。
          if (!waiter.email || !resend) {
            continue;
          }

          // Atomic claim: only send if we win the status transition (CAS guard).
          // Two concurrent invocations seeing the same cancellation window will
          // each try to claim; only the first UPDATE matching .eq('status','waiting')
          // will return a row — the second finds status already 'notified' and skips.
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

          // メール通知（claim 後に到達する時点で waiter.email/resend は確定で存在する）
          {
            const bookingUrl = `https://carelink-jp.com/facility/${facility.slug}/booking`;
            try {
              await resend.emails.send({
                from: process.env.EMAIL_FROM || 'CareLink <noreply@carelink-jp.com>',
                to: waiter.email,
                subject: escSubject(`【空きが出ました】${facility.name} ${waiter.date} ${waiter.start_time}〜`),
                html: `<p>${esc(waiter.customer_name)}様</p>
<p>キャンセル待ちしていた<strong>${esc(facility.name)}</strong>の<strong>${esc(waiter.date)} ${esc(waiter.start_time)}〜</strong>に空きが出ました！</p>
<p>お早めにご予約ください。（この通知から48時間以内に予約されない場合、次の方へ順番が移ります）</p>
<p><a href="${bookingUrl}" style="display:inline-block;padding:12px 24px;background:#0284C7;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">今すぐ予約する</a></p>`,
              });
            } catch (err) {
              console.error('[waitlist-notify] email send failed', { waiterId: waiter.id, err });
              // 送信が一過性失敗した場合、claim（status='notified'）を握ったままだと当該待ち客は
              // 通知が届かないのに 48h 後に次の人へ順番が移り恒久 miss になる。status を 'waiting' に
              // 戻し notified_at/expires_at をクリアして翌 run で再送する（恒久 miss 防止）。
              const { error: releaseErr } = await supabase
                .from('booking_waitlist')
                .update({ status: 'waiting', notified_at: null, expires_at: null })
                .eq('id', waiter.id);
              if (releaseErr) console.error('[waitlist-notify] claim release failed', { waiterId: waiter.id, err: releaseErr });
              continue; // 再送対象として残すため notified にはカウントしない
            }
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
