import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { bookingSchema } from '@/lib/validations-booking';
import { checkCsrf } from '@/lib/csrf';
import { sendBookingConfirmation, sendNewBookingNotification } from '@/lib/email';
import { bookingRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { sendPushToFacilityOwners, sendPushToUser } from '@/lib/push';
import { safeCaptureException } from '@/lib/safe';
import { sendBookingConfirmation as sendLineBookingConfirm } from '@/lib/line';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { notifyNewBookingLineWorks, isLineWorksConfigured } from '@/lib/integrations/line-works';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(bookingRateLimit, ip, 3, 300_000, 'booking')) {
    return NextResponse.json({ error: '短時間に多くのリクエストがありました。しばらくお待ちください。' }, { status: 429 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );

  // getUser() before schema parsing (security order: CSRF → RateLimit → getUser → schema)
  const { data: { user } } = await supabase.auth.getUser();

  const body = await request.json().catch(() => ({}));
  const parsed = bookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  // 時間バリデーション
  if (parsed.data.start_time >= parsed.data.end_time) {
    return NextResponse.json({ error: '開始時間は終了時間より前にしてください' }, { status: 400 });
  }

  // 競合チェック（指名あり/なし両方対応）
  {
    let conflictQuery = supabase
      .from('bookings')
      .select('id')
      .eq('facility_id', parsed.data.facility_id)
      .eq('booking_date', parsed.data.booking_date)
      .not('status', 'in', '("cancelled","no_show")')
      .lt('start_time', parsed.data.end_time)
      .gt('end_time', parsed.data.start_time);

    if (parsed.data.staff_id) {
      conflictQuery = conflictQuery.eq('staff_id', parsed.data.staff_id);
    }

    const { data: conflicts } = await conflictQuery;
    if (conflicts && conflicts.length > 0) {
      return NextResponse.json({ error: 'この時間帯は既に予約が入っています' }, { status: 409 });
    }
  }

  // Server-side price calculation (do not trust client total_price)
  // Use menu_ids for multi-menu total; fall back to menu_id for single-menu.
  let serverTotalPrice: number | null = null;
  const menuIdsToPrice = parsed.data.menu_ids && parsed.data.menu_ids.length > 0
    ? parsed.data.menu_ids
    : parsed.data.menu_id ? [parsed.data.menu_id] : [];

  if (menuIdsToPrice.length > 0) {
    const { data: menuRows } = await supabase
      .from('facility_menus')
      .select('id, price')
      .in('id', menuIdsToPrice)
      .eq('facility_id', parsed.data.facility_id)
      // 非公開(is_published=false)メニューは予約不可。見つからない扱いになり下の allValid で 400。
      .or('is_published.is.null,is_published.eq.true');

    // Only count menus that actually belong to this facility (prevent foreign-facility injection)
    const validIds = new Set((menuRows ?? []).map((r: { id: string }) => r.id));
    const allValid = menuIdsToPrice.every((id) => validIds.has(id));
    if (!allValid) {
      return NextResponse.json({ error: 'メニューが見つかりません' }, { status: 400 });
    }

    // menuRows が null の場合は上の validIds チェックで 400 返却済みのため非 null が保証される
    const menuTotal = menuRows!.reduce((sum: number, r: { price: number | null }) => sum + (r.price ?? 0), 0);
    // Use a dummy menuRow shape for the rest of the pricing logic
    const menuRow = { price: menuTotal };
    /* istanbul ignore else */
    if (menuRow) {
      serverTotalPrice = menuRow.price;
      // Apply coupon discount if provided
      if (parsed.data.coupon_id) {
        const nowIso = new Date().toISOString();
        const { data: coupon } = await supabase
          .from('coupons')
          .select('discount_type, discount_value, special_price, is_active, valid_from, valid_until')
          .eq('id', parsed.data.coupon_id)
          .eq('facility_id', parsed.data.facility_id)
          .single();
        // Validate coupon is active and within its validity window server-side
        const couponValid = coupon &&
          coupon.is_active === true &&
          (coupon.valid_from == null || coupon.valid_from <= nowIso) &&
          (coupon.valid_until == null || coupon.valid_until >= nowIso);
        if (couponValid && serverTotalPrice != null) {
          if (coupon.discount_type === 'percentage') {
            serverTotalPrice = Math.round(serverTotalPrice * (1 - coupon.discount_value / 100));
          } else if (coupon.discount_type === 'fixed') {
            serverTotalPrice = Math.max(0, serverTotalPrice - coupon.discount_value);
          } else if (coupon.discount_type === 'special_price') {
            // special_price 型は専用列 special_price に実額が入る（discount_value は null）。
            // 旧実装は discount_value を読み serverTotalPrice=null となり金額/売上/会計/ポイントが全壊していた。
            // special_price が数値の時のみ採用（万一 null の場合はメニュー定価を維持し NULL 伝播を防ぐ）。
            if (typeof coupon.special_price === 'number') {
              serverTotalPrice = coupon.special_price;
            }
          }
        } else {
          // coupon_id 設定済み（このブロック内は常に真）かつ couponValid = false → 無効クーポン
          // serverTotalPrice は menuRow.price で必ず数値のため null ケースは到達不可
          return NextResponse.json({ error: 'クーポンが無効または期限切れです' }, { status: 400 });
        }
      }
      // Add nomination fee if staff is designated
      if (parsed.data.staff_id) {
        const { data: staffRow } = await supabase
          .from('staff_profiles')
          .select('nomination_fee')
          .eq('id', parsed.data.staff_id)
          .eq('facility_id', parsed.data.facility_id)
          .maybeSingle();
        if (staffRow?.nomination_fee && serverTotalPrice != null) {
          serverTotalPrice += staffRow.nomination_fee;
        }
      }
    }
  }

  // Handle points deduction
  const requestedPoints = parsed.data.points_used || 0;
  if (requestedPoints > 0 && !user) {
    return NextResponse.json({ error: 'ポイント利用には認証が必要です' }, { status: 401 });
  }
  // 価格を超えるポイントは利用できない（クライアントが価格変更後の stale な points_used を送ると、
  // 請求は Math.max(0,...) で 0 に丸まる一方ポイントは full 控除され、超過分が消失する＝金銭損失）。
  // 権威的なサーバ計算価格でクランプする。serverTotalPrice 不明時のみ要求値をそのまま用いる。
  const pointsUsed = serverTotalPrice != null ? Math.min(requestedPoints, serverTotalPrice) : requestedPoints;
  // Snapshot current balance for CAS (compare-and-swap) check later
  let pointsBalanceSnapshot = 0;
  if (pointsUsed > 0 && user) {
    const { data: pointRows } = await supabase.from('user_points').select('points').eq('user_id', user.id);
    pointsBalanceSnapshot = (pointRows ?? []).reduce((sum: number, r: { points: number }) => sum + r.points, 0);
    if (pointsBalanceSnapshot < pointsUsed) {
      return NextResponse.json({ error: 'ポイント残高が不足しています' }, { status: 400 });
    }
  }

  // ポイント値引き反映
  const finalPrice = serverTotalPrice != null && pointsUsed > 0
    ? Math.max(0, serverTotalPrice - pointsUsed)
    : serverTotalPrice;

  // 施設の即時確定モード取得
  const { data: facilitySettings } = await supabase
    .from('facility_profiles')
    .select('booking_auto_confirm')
    .eq('id', parsed.data.facility_id)
    .single();
  const bookingStatus = facilitySettings?.booking_auto_confirm ? 'confirmed' : 'pending';

  // Strip non-DB fields before insert
  const { points_used: _pointsUsed, total_price: _clientPrice, menu_ids: _menuIds, ...bookingData } = parsed.data;
  void _pointsUsed; void _clientPrice; void _menuIds;

  // Use atomic RPC that does FOR UPDATE locking + INSERT in one transaction,
  // preventing double-booking race conditions at the DB level.
  const { data: rpcResult, error } = await supabase.rpc('create_booking_atomic', {
    p_facility_id: parsed.data.facility_id,
    p_staff_id: parsed.data.staff_id ?? null,
    p_user_id: user?.id ?? null,
    p_menu_id: parsed.data.menu_id ?? null,
    p_coupon_id: parsed.data.coupon_id ?? null,
    p_booking_date: parsed.data.booking_date,
    p_start_time: parsed.data.start_time,
    p_end_time: parsed.data.end_time,
    p_customer_name: parsed.data.customer_name,
    p_email: /* istanbul ignore next */ parsed.data.email ?? null,
    p_phone: parsed.data.phone ?? null,
    p_note: parsed.data.note ?? null,
    p_total_price: finalPrice ?? null,
    p_points_used: pointsUsed,
    p_status: bookingStatus,
  });
  void bookingData;

  if (error) {
    // BOOKING_CONFLICT raised by the RPC
    if (error.message?.includes('BOOKING_CONFLICT') || error.code === '23505') {
      return NextResponse.json({ error: 'この時間帯は既に予約が入っています' }, { status: 409 });
    }
    return NextResponse.json({ error: '予約に失敗しました' }, { status: 500 });
  }

  const newBookingId: string = rpcResult || '';
  if (!newBookingId) {
    console.error('[booking] create_booking_atomic returned null with no error');
    return NextResponse.json({ error: '予約に失敗しました' }, { status: 500 });
  }

  // Points deduction with CAS (compare-and-swap) to prevent race conditions:
  // Insert the deduction row via service_role (user_points has no INSERT policy for anon client),
  // then verify the running balance is still non-negative.
  // If another concurrent request already deducted points (balance changed since snapshot),
  // roll back and cancel the booking.
  if (pointsUsed > 0 && user && newBookingId) {
    const serviceSupabase = createServiceRoleClient();
    const { data: deductionRow } = await serviceSupabase
      .from('user_points')
      .insert({
        user_id: user.id,
        points: -pointsUsed,
        reason: `予約利用 (${newBookingId.slice(0, 8)})`,
      })
      .select('id')
      .single();

    // Re-verify balance to detect concurrent deductions since our snapshot
    const { data: recheck } = await serviceSupabase.from('user_points').select('points').eq('user_id', user.id);
    const newBalance = (recheck ?? []).reduce((sum: number, r: { points: number }) => sum + r.points, 0);
    if (newBalance < 0) {
      // CAS failed: another concurrent request deducted points between our read and write.
      // Rollback: delete this specific deduction row by ID (not by reason, to avoid ambiguity)
      if (deductionRow?.id) {
        const { error: rollbackPointsErr } = await serviceSupabase.from('user_points').delete().eq('id', deductionRow.id);
        /* istanbul ignore next */
        if (rollbackPointsErr) console.error('[booking] point deduction rollback failed — manual cleanup needed', { deductionId: deductionRow.id, err: rollbackPointsErr });
      }
      // Cancel the booking (service_role bypasses booking RLS for reliable rollback)
      const { error: rollbackBookingErr } = await serviceSupabase.from('bookings').update({ status: 'cancelled' }).eq('id', newBookingId);
      /* istanbul ignore next */
      if (rollbackBookingErr) console.error('[booking] booking rollback failed — manual cleanup needed', { bookingId: newBookingId, err: rollbackBookingErr });
      return NextResponse.json({ error: 'ポイント残高が不足しています（競合が発生しました）' }, { status: 400 });
    }
  }

  // Send email notifications (non-blocking)
  try {
    const [facilityResult, menuResult, staffResult, ownerResult] = await Promise.all([
      supabase.from('facility_profiles').select('name, phone').eq('id', parsed.data.facility_id).single(),
      parsed.data.menu_id
        ? supabase.from('facility_menus').select('name').eq('id', parsed.data.menu_id).eq('facility_id', parsed.data.facility_id).single()
        : Promise.resolve({ data: null }),
      parsed.data.staff_id
        ? supabase.from('staff_profiles').select('name').eq('id', parsed.data.staff_id).eq('facility_id', parsed.data.facility_id).single()
        : Promise.resolve({ data: null }),
      supabase.from('facility_members').select('user_id').eq('facility_id', parsed.data.facility_id).eq('role', 'owner').single(),
    ]);

    const emailData = {
      customerName: parsed.data.customer_name,
      customerEmail: parsed.data.email,
      facilityName: facilityResult.data?.name || '',
      bookingDate: parsed.data.booking_date,
      startTime: parsed.data.start_time,
      endTime: parsed.data.end_time,
      menuName: menuResult.data?.name,
      staffName: staffResult.data?.name,
      totalPrice: finalPrice ?? undefined,
      bookingId: newBookingId,
    };

    sendBookingConfirmation(emailData).catch((e) => safeCaptureException(e, 'booking-email'));

    // Notify facility owner
    if (ownerResult.data) {
      const { data: ownerProfile } = await supabase.from('profiles').select('email').eq('id', ownerResult.data.user_id).single();
      if (ownerProfile?.email) {
        sendNewBookingNotification({ ...emailData, facilityEmail: ownerProfile.email }).catch((e) => safeCaptureException(e, 'booking-email-owner'));
      }
    }
  } catch (e) {
    safeCaptureException(e, 'booking-email-setup');
  }

  // Push notifications (non-blocking)
  try {
    sendPushToFacilityOwners(parsed.data.facility_id, {
      title: '新規予約',
      body: `${parsed.data.customer_name}様から${parsed.data.booking_date} ${parsed.data.start_time}〜の予約が入りました`,
      url: '/admin/bookings',
      tag: `booking-${newBookingId}`,
    }).catch((e) => safeCaptureException(e, 'booking-push-owner'));

    if (user) {
      sendPushToUser(user.id, {
        title: '予約を受け付けました',
        body: `${parsed.data.booking_date} ${parsed.data.start_time}〜のご予約を承りました`,
        url: `/mypage/bookings/${newBookingId}`,
        tag: `booking-confirm-${newBookingId}`,
      }).catch((e) => safeCaptureException(e, 'booking-push-user'));
    }
  } catch (e) {
    safeCaptureException(e, 'booking-push-setup');
  }

  // LINE notification (non-blocking)
  try {
    if (user && process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) {
      const adminSupabase = createServiceRoleClient();
      const { data: lineLink } = await adminSupabase
        .from('line_user_links')
        .select('line_user_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (lineLink?.line_user_id) {
        const { data: facilityForLine } = await supabase
          .from('facility_profiles')
          .select('name')
          .eq('id', parsed.data.facility_id)
          .maybeSingle();

        let lineMenuName = '';
        if (parsed.data.menu_id) {
          const { data: menuForLine } = await supabase.from('facility_menus').select('name').eq('id', parsed.data.menu_id).maybeSingle();
          lineMenuName = menuForLine?.name || '';
        }

        sendLineBookingConfirm(lineLink.line_user_id, {
          facilityName: facilityForLine?.name || '',
          menuName: lineMenuName,
          date: parsed.data.booking_date,
          time: parsed.data.start_time,
        }).catch((e) => safeCaptureException(e, 'booking-line'));
      }
    }
  } catch (e) {
    safeCaptureException(e, 'booking-line-setup');
  }

  // LINE Works staff notification (non-blocking)
  if (isLineWorksConfigured()) {
    try {
      const adminSupabase = createServiceRoleClient();
      // Fetch staff with LINE Works channel IDs: assigned staff + all-notify staff
      const { data: staffList } = await adminSupabase
        .from('staff_profiles')
        .select('line_works_channel_id, line_works_notify_all, id')
        .eq('facility_id', parsed.data.facility_id)
        .not('line_works_channel_id', 'is', null);

      if (staffList && staffList.length > 0) {
        const [menuRow, staffRow, facilityRow] = await Promise.all([
          parsed.data.menu_id
            ? adminSupabase.from('facility_menus').select('name').eq('id', parsed.data.menu_id).maybeSingle()
            : Promise.resolve({ data: null }),
          parsed.data.staff_id
            ? adminSupabase.from('staff_profiles').select('name').eq('id', parsed.data.staff_id).maybeSingle()
            : Promise.resolve({ data: null }),
          adminSupabase.from('facility_profiles').select('name').eq('id', parsed.data.facility_id).maybeSingle(),
        ]);

        const bookingInfo = {
          customerName: parsed.data.customer_name,
          menuName: menuRow.data?.name || '',
          bookingDate: parsed.data.booking_date,
          startTime: parsed.data.start_time,
          staffName: staffRow.data?.name,
        };

        for (const staff of staffList) {
          if (!staff.line_works_channel_id) continue;
          const isAssigned = staff.id === parsed.data.staff_id;
          if (isAssigned || staff.line_works_notify_all) {
            notifyNewBookingLineWorks(staff.line_works_channel_id, bookingInfo).catch((e) =>
              safeCaptureException(e, 'booking-lineworks')
            );
          }
        }
        void facilityRow;
      }
    } catch (e) {
      safeCaptureException(e, 'booking-lineworks-setup');
    }
  }

  return NextResponse.json({ success: true, bookingId: newBookingId });
  } catch (e) {
    safeCaptureException(e, 'booking');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
