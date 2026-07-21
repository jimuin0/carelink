/**
 * 来店後レビュー依頼 Cron（v8.6）
 * GET /api/cron/review-request
 * 完了予約の24時間後にメール+LINEでレビュー依頼を送信
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { sendLineText } from '@/lib/line';
import { resolveLineUserIdForUser } from '@/lib/line-link';
import { escSubject, esc } from '@/lib/email';
import { logCronRun } from '@/lib/cron-logger';
import { checkCronAuth } from '@/lib/cron-auth';
import { alertDeliveryFailures } from '@/lib/alert';
import { fetchAllPaged } from '@/lib/paginate';

export const dynamic = 'force-dynamic';
// 全プラン安全な明示値（Hobby 上限60s / Pro 上限300s のいずれでも有効）。
// 既定の低い値（プランによっては 10s）を上書きして、下の SEND_BUDGET_MS による
// 予算ガードが確実に発火する既知の上限を与える（タイムアウトをプラン非依存で不可能にする）。
export const maxDuration = 60;

// 完了からこの時間以上経過した予約のみ対象（直後の送信を避ける）。
const MIN_AGE_MS = 24 * 60 * 60 * 1000;
// 未送信のまま「retry 可能」として扱う上限（これを超えた古い予約には今さら送らない＝陳腐化防止）。
// 旧実装は下限 48h の固定窓だったため、1 日の窓内で .limit(500) を超えた分が翌日 48h を過ぎて
// gte(h48ago) から外れ、永久に送られなかった（silent な恒久 miss）。下限を 7 日に広げ、
// 未送信(sent_at IS NULL)のまま日次 run で繰り返し対象に乗せることで恒久 miss を構造的に無くす。
const STALE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
// 1 回の run で「考慮」する最大行数（メモリ上限・送信上限ではない）。到達したら警告ログを出す（silent 根絶）。
const CONSIDER_LIMIT = 2000;
// 送信ループの実時間予算。maxDuration(60s) 未満に設定し、超えたら新規送信を止めて残りを翌 run へ回す。
// 打ち切られた分は claim していない（=sent_at IS NULL のまま）ので次回必ず再処理される（恒久 miss なし）。
const SEND_BUDGET_MS = 50 * 1000;

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
    // 完了24時間〜7日前の予約を取得（重複送信防止のため review_request_sent_at IS NULL でフィルタ）。
    // 古い順（updated_at 昇順）= staleness 期限が近いものから優先処理する。
    const now = new Date();
    const staleAfter = new Date(now.getTime() - STALE_LOOKBACK_MS).toISOString();
    const minAgeBefore = new Date(now.getTime() - MIN_AGE_MS).toISOString();

    // PostgREST の実 db-max-rows(1000) は .limit(2000) より小さく、常に1000件で
    // 打ち切られる（バックログが1000件を超える恒久取りこぼし）。加えて後続の
    // 「bookings.length === CONSIDER_LIMIT」検知も 2000 に到達し得ず死んでいた。
    // 他 cron(booking-reminder 等)と同じ fetchAllPaged でページングし、真に CONSIDER_LIMIT
    // まで取得することで取りこぼしと検知ロジックの両方を根治する。
    type BookingRow = { id: string; email: string | null; customer_name: string | null; user_id: string | null; facility_id: string; updated_at: string };
    const { rows: bookings, error: bookingsErr } = await fetchAllPaged<BookingRow>(
      async (offset, limit) => {
        const { data, error } = await supabase
          .from('bookings')
          .select('id, email, customer_name, user_id, facility_id, updated_at')
          .eq('status', 'completed')
          .gte('updated_at', staleAfter)
          .lte('updated_at', minAgeBefore)
          .is('review_request_sent_at', null)
          .order('updated_at', { ascending: true })
          .range(offset, offset + limit - 1);
        return { data: data as BookingRow[] | null, error };
      },
      { maxRows: CONSIDER_LIMIT },
    );

    // 主クエリの一過性障害を「0件=skipped(成功)」に偽装しない（他 cron と対称）。error は 500+error ログで
    // 可視化し、cron-logger の error 経路経由で alert を発火させる。これをしないと DB 障害でレビュー依頼が
    // 全停止しても status='skipped'(正常)で記録され完全無音になる（H-2）。
    if (bookingsErr) {
      const msg = bookingsErr instanceof Error
        ? bookingsErr.message
        : (bookingsErr as { message?: string })?.message ?? String(bookingsErr);
      console.error('[review-request] bookings query failed', { err: bookingsErr });
      await logCronRun('review-request', 'error', startedAt, { error_msg: msg });
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }

    if (bookings.length === 0) {
      await logCronRun('review-request', 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ processed: 0, skipped: 0, status: 'ok', sent: 0 });
    }

    if (bookings.length === CONSIDER_LIMIT) {
      // 考慮上限に到達 = 未送信が大量。古い順に処理しているので今回分は最古から消化されるが、
      // 残りが翌 run に持ち越されている可能性を可視化する（silent な取りこぼしを作らない）。
      console.warn('[review-request] consider limit reached', { limit: CONSIDER_LIMIT });
    }

    const loopStart = Date.now();
    let sent = 0;
    let skipped = 0;
    let deferred = 0;
    let deliveryFailures = 0;

    for (let i = 0; i < bookings.length; i++) {
      const booking = bookings[i];

      // 実時間予算ガード: 残りは claim せず翌 run へ回す（sent_at IS NULL のままなので恒久 miss なし）。
      if (Date.now() - loopStart > SEND_BUDGET_MS) {
        deferred = bookings.length - i;
        console.warn('[review-request] time budget exceeded, deferring rest to next run', { deferred });
        break;
      }

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
      const { data: facility, error: facErr } = await supabase
        .from('facility_profiles')
        .select('name, slug')
        .eq('id', booking.facility_id)
        .maybeSingle();

      // claim 済みなので、facility 取得が一過性 error のときは claim を解放して翌 run で再処理する
      // （解放しないと sent_at が立ったまま二度と対象に乗らず恒久 miss になる・H-3）。
      if (facErr) {
        await supabase.from('bookings').update({ review_request_sent_at: null }).eq('id', booking.id);
        skipped++;
        continue;
      }
      if (!facility) { skipped++; continue; } // 施設が実在しない(削除済み)＝再送不要・claim 維持

      const reviewUrl = `https://carelink-jp.com/facility/${facility.slug}#review`;

      // 送信を試みたチャネルと、実際に届いたチャネルを記録する。
      // claim を先に立てる方式は二重送信を防ぐ一方、送信が一過性失敗すると sent_at が
      // 立ったまま二度と再送されない（silent な恒久 miss）。そこで「試行したが 1 つも
      // 届かなかった」場合は claim を解放（sent_at→null）し、翌 run で再送できるようにする。
      let attempted = false;
      let delivered = false;

      // メール送信
      if (booking.email && process.env.RESEND_API_KEY) {
        attempted = true;
        const resend = new Resend(process.env.RESEND_API_KEY);
        try {
          await resend.emails.send({
            from: process.env.EMAIL_FROM || 'CareLink <noreply@carelink-jp.com>',
            to: booking.email,
            subject: escSubject(`【${facility.name}】ご来店ありがとうございました`),
            html: `<p>${esc(booking.customer_name || 'お客')}様</p><p>先日は<strong>${esc(facility.name)}</strong>にご来店いただきありがとうございました。</p><p>よろしければ、口コミを投稿していただけると嬉しいです。</p><p><a href="${reviewUrl}" style="display:inline-block;padding:12px 24px;background:#0284C7;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">口コミを書く</a></p><p style="color:#999;font-size:12px;">口コミを投稿すると50ポイントがもらえます！</p>`,
          });
          delivered = true;
        } catch (err) {
          console.error('[review-request] email send failed', { bookingId: booking.id, err });
        }
      }

      // LINE通知
      if (booking.user_id && process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) {
        // 【監査C2】連携の単一ソース profiles.line_user_id で解決（line_user_links.user_id は常にNULL）。
        const customerLineUserId = await resolveLineUserIdForUser(supabase, booking.user_id);

        if (customerLineUserId) {
          attempted = true;
          try {
            // sendLineText はリトライ上限到達時に throw せず false を返す。戻り値を無視して
            // delivered=true に固定すると、配信失敗でも claim 解放（再送）が発火せず sent_at が
            // 立ったまま二度と再送されない（silent な恒久 miss）。戻り値で delivered を確定する。
            const ok = await sendLineText(
              customerLineUserId,
              `✨ ${facility.name}へのご来店ありがとうございました！\n\n口コミを投稿すると50ポイントプレゼント🎁\n\n👇 口コミを書く\n${reviewUrl}`
            );
            if (ok) delivered = true;
          } catch (err) {
            console.error('[review-request] LINE send failed', { bookingId: booking.id, err });
          }
        }
      }

      // 試行した全チャネルが失敗 → claim を解放して翌 run で再送（恒久 miss を防ぐ）。
      // 連絡先が無い（attempted=false）場合は再送しても無意味なので claim 維持（done 扱い）。
      if (attempted && !delivered) {
        deliveryFailures++;
        const { error: releaseErr } = await supabase
          .from('bookings')
          .update({ review_request_sent_at: null })
          .eq('id', booking.id);
        if (releaseErr) {
          // 解放に失敗するとこの 1 件は claim されたまま残る（次回再送不可）。可視化のみ行う。
          console.error('[review-request] claim release failed', { bookingId: booking.id, err: releaseErr });
        }
        skipped++;
        continue;
      }

      sent++;
    }

    alertDeliveryFailures('review-request', deliveryFailures, { sent, skipped });
    await logCronRun('review-request', 'success', startedAt, { processed: sent, skipped, meta: { deferred } });
    return NextResponse.json({ processed: sent, skipped, deferred });
  } catch (e) {
    console.error('[review-request] Error:', e);
    await logCronRun('review-request', 'error', startedAt, { error_msg: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
