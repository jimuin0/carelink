import { createServiceRoleClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { safeCaptureException } from '@/lib/safe';
import { logCronRun } from '@/lib/cron-logger';
import { checkCronAuth } from '@/lib/cron-auth';
import { alertDeliveryFailures } from '@/lib/alert';
import { fetchAllPaged } from '@/lib/paginate';
import { getEntitlementsByFacility, type EntitlementsClient } from '@/lib/entitlements';

// Vercel Cron: runs daily at 9:00 JST (0:00 UTC)
export const dynamic = 'force-dynamic';
// 全プラン安全な明示値（Hobby 上限60s / Pro 上限300s のいずれでも有効）。
// 既定の低い値を上書きし、下の SEND_BUDGET_MS による予算ガードが確実に発火する既知の上限を与える。
export const maxDuration = 60;

// 1 回の run で「考慮」する最大予約数（メモリ上限）。到達したら警告ログを出す（silent 根絶）。
const CONSIDER_LIMIT = 5000;
// 送信ループの実時間予算。maxDuration(60s) 未満に設定し、超えたら残りを翌 run へ回す。
const SEND_BUDGET_MS = 50 * 1000;
// .in() を chunk するサイズ（PostgREST の URL 長制限回避）。
const IN_CHUNK = 500;

// リマインド対象（予約日まで何日か）。1=前日（無料・無条件、従来挙動）。
// 7=7日前（無料・施設設定で ON）。3=3日前（有料オプション）。LINE は 3/7 とも有料オプション。
const REMINDER_DAYS = [1, 3, 7] as const;

type ReminderKind = 'email_1d' | 'email_3d' | 'email_7d' | 'line_3d' | 'line_7d';

type BookingRow = {
  id: string; customer_name: string | null; email: string | null;
  booking_date: string; start_time: string; end_time: string;
  facility_id: string; total_price: number | null;
  user_id: string | null; menu_id: string | null;
};

type ReminderSettings = {
  facility_id: string;
  remind_7d_email: boolean; remind_3d_email: boolean;
  remind_7d_line: boolean; remind_3d_line: boolean;
};

export async function GET(request: Request) {
  // Verify cron secret (timing-safe)
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const startedAt = new Date();
  try {
    // Use service role client to bypass RLS (cron has no auth context)
    const supabase = createServiceRoleClient();

    // JST（UTC+9）基準で対象日を算出（1日後/3日後/7日後）
    const now = new Date();
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const dateToDays = new Map<string, (typeof REMINDER_DAYS)[number]>();
    for (const d of REMINDER_DAYS) {
      const target = new Date(jstNow.getTime() + d * 24 * 60 * 60 * 1000);
      dateToDays.set(target.toISOString().split('T')[0], d);
    }
    const targetDates = Array.from(dateToDays.keys());

    // 対象3日付の confirmed 予約を全件取得（id 昇順・決定的）。
    // 旧実装は .limit(200) silent miss の教訓から fetchAllPaged + 実時間予算ガード。
    const { rows: bookings, error: bookingsErr } = await fetchAllPaged<BookingRow>(
      async (offset, limit) => {
        const { data, error } = await supabase
          .from('bookings')
          .select('id, customer_name, email, booking_date, start_time, end_time, facility_id, total_price, user_id, menu_id')
          .in('booking_date', targetDates)
          .eq('status', 'confirmed')
          .order('id', { ascending: true })
          .range(offset, offset + limit - 1);
        return { data: data as BookingRow[] | null, error };
      },
      { maxRows: CONSIDER_LIMIT },
    );

    // fail-safe: 予約一覧が取れない時は中止（部分処理での誤集計を避ける）。
    if (bookingsErr) {
      safeCaptureException(bookingsErr, 'booking-reminder');
      await logCronRun('booking-reminder', 'error', startedAt, { error_msg: 'bookings query failed' });
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
    if (bookings.length === 0) {
      await logCronRun('booking-reminder', 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ processed: 0, skipped: 0, sent: 0 });
    }
    if (bookings.length === CONSIDER_LIMIT) {
      console.warn('[booking-reminder] consider limit reached', { limit: CONSIDER_LIMIT });
    }

    const facilityIds = Array.from(new Set(bookings.map((b) => b.facility_id)));

    // 施設名（chunked .in）
    const facilityMap = new Map<string, string | null>();
    for (let i = 0; i < facilityIds.length; i += IN_CHUNK) {
      const idChunk = facilityIds.slice(i, i + IN_CHUNK);
      const { data: facilities } = await supabase
        .from('facility_profiles')
        .select('id, name')
        .in('id', idChunk);
      for (const f of facilities ?? []) facilityMap.set(f.id, f.name);
    }

    // リマインダー設定（chunked .in）。取得エラーは fail-safe（設定なし=任意リマインド送らない・
    // 前日メールは従来どおり送る）。silent にしない（Sentry 可視化）。
    const settingsMap = new Map<string, ReminderSettings>();
    for (let i = 0; i < facilityIds.length; i += IN_CHUNK) {
      const idChunk = facilityIds.slice(i, i + IN_CHUNK);
      const { data: settingsRows, error: settingsErr } = await supabase
        .from('facility_reminder_settings')
        .select('facility_id, remind_7d_email, remind_3d_email, remind_7d_line, remind_3d_line')
        .in('facility_id', idChunk);
      if (settingsErr) {
        safeCaptureException(settingsErr, 'booking-reminder-settings');
        continue;
      }
      for (const s of (settingsRows ?? []) as ReminderSettings[]) settingsMap.set(s.facility_id, s);
    }

    // エンタイトルメント（有料オプション購入状態）。エラーは fail-safe=未購入扱い（安全側）。
    // 完全型付きクライアントを構造的型へ明示キャストし TS2589（深い型インスタンス化）を回避（実体同一）。
    const { map: entMap, errors: entErrors } = await getEntitlementsByFacility(supabase as unknown as EntitlementsClient, facilityIds);
    for (const e of entErrors) safeCaptureException(e, 'booking-reminder-entitlements');

    // LINE 連携（user_id → line_user_id）。LINE 送信が有効になり得る予約の user_id のみ解決。
    const lineCandidateUserIds = Array.from(new Set(
      bookings
        .filter((b) => {
          if (!b.user_id) return false;
          const days = dateToDays.get(b.booking_date);
          const s = settingsMap.get(b.facility_id);
          const ent = entMap.get(b.facility_id);
          if (!s || !ent || !ent.has('reminder_line')) return false;
          return (days === 7 && s.remind_7d_line) || (days === 3 && s.remind_3d_line);
        })
        .map((b) => b.user_id as string),
    ));
    const lineMap = new Map<string, string>();
    for (let i = 0; i < lineCandidateUserIds.length; i += IN_CHUNK) {
      const idChunk = lineCandidateUserIds.slice(i, i + IN_CHUNK);
      const { data: links, error: linksErr } = await supabase
        .from('line_user_links')
        .select('user_id, line_user_id')
        .in('user_id', idChunk);
      if (linksErr) {
        safeCaptureException(linksErr, 'booking-reminder-line-links');
        continue;
      }
      for (const l of links ?? []) {
        if (l.user_id) lineMap.set(l.user_id, l.line_user_id);
      }
    }

    // メニュー名（LINE 文面用・chunked .in）。エラーは fail-safe=「ご予約」表記。
    const menuIds = Array.from(new Set(bookings.map((b) => b.menu_id).filter((m): m is string => !!m)));
    const menuMap = new Map<string, string>();
    for (let i = 0; i < menuIds.length; i += IN_CHUNK) {
      const idChunk = menuIds.slice(i, i + IN_CHUNK);
      const { data: menus, error: menusErr } = await supabase
        .from('facility_menus')
        .select('id, name')
        .in('id', idChunk);
      if (menusErr) {
        safeCaptureException(menusErr, 'booking-reminder-menus');
        continue;
      }
      for (const m of menus ?? []) menuMap.set(m.id, m.name);
    }

    // 送信プランを組み立て（booking × kind）。
    const plan: { booking: BookingRow; kind: ReminderKind; days: number }[] = [];
    for (const booking of bookings) {
      const days = dateToDays.get(booking.booking_date);
      const s = settingsMap.get(booking.facility_id);
      const ent = entMap.get(booking.facility_id);
      const lineId = booking.user_id ? lineMap.get(booking.user_id) : undefined;

      if (days === 1) {
        // 前日メール: 従来挙動（無料・無条件）
        if (booking.email) plan.push({ booking, kind: 'email_1d', days: 1 });
      } else if (days === 7) {
        if (s?.remind_7d_email && booking.email) plan.push({ booking, kind: 'email_7d', days: 7 });
        if (s?.remind_7d_line && ent?.has('reminder_line') && lineId) plan.push({ booking, kind: 'line_7d', days: 7 });
      } else if (days === 3) {
        if (s?.remind_3d_email && ent?.has('reminder_email_3d') && booking.email) plan.push({ booking, kind: 'email_3d', days: 3 });
        if (s?.remind_3d_line && ent?.has('reminder_line') && lineId) plan.push({ booking, kind: 'line_3d', days: 3 });
      }
    }

    // Dynamic import to avoid loading Resend/LINE unnecessarily
    const { sendBookingReminder: sendEmailReminder } = await import('@/lib/email');
    const { sendBookingReminder: sendLineReminder } = await import('@/lib/line');

    let sent = 0;
    let skipped = 0;
    let deferred = 0;
    let deliveryFailures = 0;
    const loopStart = Date.now();
    for (let pi = 0; pi < plan.length; pi++) {
      const { booking, kind, days } = plan[pi];
      // 実時間予算ガード: 残りは未処理（sent_reminders 未 claim）のまま翌 run へ。
      if (Date.now() - loopStart > SEND_BUDGET_MS) {
        deferred = plan.length - pi;
        console.warn('[booking-reminder] time budget exceeded, deferring rest to next run', { deferred });
        break;
      }

      // Idempotency: claim this (booking_id, reminder_date, kind) slot atomically.
      // PostgREST 仕様: ignoreDuplicates:true の upsert に .select() を付けると、
      // レスポンスには実際に INSERT された行だけが含まれる（競合で無視された行は含まれない）。
      // つまり戻り data の有無（1 行 or 0 行）がそのまま原子的な勝敗判定になり、追加の
      // SELECT や時間ヒューリスティックは不要。旧実装は claim 後に別クエリで sent_at を
      // 読み直し「30秒より新しければ自分が勝ち」と判定していたが、cron 三重化
      // （GitHub Actions + pg_cron + Render が同一スケジュールで数秒差発火）では
      // 両 invocation の sent_at がともに 30 秒未満に見え、両方が「勝ち」と誤判定し
      // リマインダーを二重送信し得た（非原子的・レースあり）。この upsert().select() の
      // 戻り件数のみで判定する方式は DB 側で原子的に解決されるため、その穴が構造的に無い。
      const { data: claimedRows, error: claimError } = await supabase
        .from('sent_reminders')
        .upsert({ booking_id: booking.id, reminder_date: booking.booking_date, kind }, {
          onConflict: 'booking_id,reminder_date,kind',
          ignoreDuplicates: true,
        })
        .select('sent_at');

      if (claimError) {
        // Unexpected DB error — skip rather than risk duplicate send
        safeCaptureException(claimError, 'booking-reminder');
        skipped++;
        continue;
      }

      // INSERT された行が 0 件 = 他 invocation が既にこの slot を claim 済み（自分の負け）。
      if (!claimedRows || claimedRows.length === 0) {
        skipped++;
        continue;
      }

      // 送信が失敗した場合、claim（sent_reminders 行）を握ったままにすると、翌 run の
      // upsert(ignoreDuplicates) は既存行と衝突して INSERT 0 件（=負け判定）になり、
      // 当該リマインダーは恒久 miss になる。送信失敗時は claim を解放（削除）して
      // 同種 run での再送を可能にする（favorites-digest / review-request 等の恒久 miss 防止と同方針）。
      const releaseClaim = async () => {
        const { error: releaseErr } = await supabase
          .from('sent_reminders')
          .delete()
          .eq('booking_id', booking.id)
          .eq('reminder_date', booking.booking_date)
          .eq('kind', kind);
        if (releaseErr) {
          // 解放失敗はログのみ（本体は継続）。次回 run で再送されないリスクは残るが握り潰さず可視化。
          console.error('[booking-reminder] claim release failed', { bookingId: booking.id, kind, err: releaseErr });
        }
      };

      try {
        if (kind === 'email_1d' || kind === 'email_3d' || kind === 'email_7d') {
          const ok = await sendEmailReminder({
            customerName: booking.customer_name as string,
            customerEmail: booking.email as string,
            facilityName: facilityMap.get(booking.facility_id) || '',
            bookingDate: booking.booking_date,
            startTime: booking.start_time,
            endTime: booking.end_time,
            totalPrice: booking.total_price ?? undefined,
            bookingId: booking.id,
          }, days);
          if (ok) {
            sent++;
          } else {
            // メール送信が送達不可（safeSend が false）→ claim 解放して翌 run で再送可能にする。
            // 従来は戻り値を無視し無条件 sent++ していたため、送信失敗が無音＋claim 保持で恒久 miss だった。
            await releaseClaim();
            deliveryFailures++;
            skipped++;
          }
        } else {
          const lineId = lineMap.get(booking.user_id as string) as string;
          const ok = await sendLineReminder(lineId, {
            facilityName: facilityMap.get(booking.facility_id) || '',
            menuName: (booking.menu_id && menuMap.get(booking.menu_id)) || 'ご予約',
            date: booking.booking_date,
            time: booking.start_time,
            daysBefore: days,
          });
          if (ok) {
            sent++;
          } else {
            // LINE 送信が送達不可（safeSend が false）→ claim 解放して翌 run で再送可能にする。
            await releaseClaim();
            deliveryFailures++;
            skipped++;
          }
        }
      } catch (e) {
        safeCaptureException(e, 'booking-reminder');
        // メール送信例外時も claim を解放し恒久 miss を防ぐ。
        await releaseClaim();
        skipped++;
      }
    }

    alertDeliveryFailures('booking-reminder', deliveryFailures, { sent, skipped });
    await logCronRun('booking-reminder', 'success', startedAt, {
      processed: sent,
      skipped,
      meta: { total_bookings: bookings.length, planned: plan.length, deferred },
    });
    return NextResponse.json({ processed: sent, skipped, total: bookings.length, planned: plan.length, deferred });
  } catch (e) {
    safeCaptureException(e, 'booking-reminder-cron');
    await logCronRun('booking-reminder', 'error', startedAt, {
      error_msg: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
