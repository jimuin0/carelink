import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { bookingSchema, getTodayString } from '@/lib/validations-booking';
import { checkCsrf } from '@/lib/csrf';
import { sendBookingConfirmation, sendNewBookingNotification } from '@/lib/email';
import { bookingRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { sendPushToFacilityOwners, sendPushToUser } from '@/lib/push';
import { safeCaptureException } from '@/lib/safe';
import { sendBookingConfirmation as sendLineBookingConfirm } from '@/lib/line';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { notifyNewBookingLineWorks, isLineWorksConfigured } from '@/lib/integrations/line-works';
import { NON_OCCUPYING_STATUS_FILTER } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
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
      .not('status', 'in', NON_OCCUPYING_STATUS_FILTER)
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
      .eq('facility_id', parsed.data.facility_id);

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
        // valid_from/valid_until は DATE 列('YYYY-MM-DD')。日付粒度・JST で比較する
        // （UTCタイムスタンプ文字列と比較すると当日が常に期限切れ判定になり、JST午前は前日にずれるため）。
        const today = getTodayString();
        const { data: coupon } = await supabase
          .from('coupons')
          // special_price 種別の金額は special_price 列に入る（discount_value は null）。必ず取得する（round3 #04/#05）
          // coupon_type は対象者限定（新規/リピート）の確定層検証に使う（round4 #B）
          .select('discount_type, discount_value, special_price, coupon_type, is_active, valid_from, valid_until')
          .eq('id', parsed.data.coupon_id)
          .eq('facility_id', parsed.data.facility_id)
          .single();
        // Validate coupon is active and within its validity window server-side
        const couponValid = coupon &&
          coupon.is_active === true &&
          (coupon.valid_from == null || coupon.valid_from <= today) &&
          (coupon.valid_until == null || coupon.valid_until >= today);
        if (couponValid && serverTotalPrice != null) {
          if (coupon.discount_type === 'percentage') {
            // 値欠落クーポンで NaN/null 価格が確定するのを防ぐ（欠落時は割引せず元価格を維持）
            if (coupon.discount_value == null) return NextResponse.json({ error: 'クーポン設定が不正です' }, { status: 400 });
            serverTotalPrice = Math.round(serverTotalPrice * (1 - coupon.discount_value / 100));
          } else if (coupon.discount_type === 'fixed') {
            if (coupon.discount_value == null) return NextResponse.json({ error: 'クーポン設定が不正です' }, { status: 400 });
            serverTotalPrice = Math.max(0, serverTotalPrice - coupon.discount_value);
          } else if (coupon.discount_type === 'special_price') {
            // special_price 列を優先（旧データ互換で discount_value もフォールバック）。両方 null は不正設定で 400
            const sp = coupon.special_price ?? coupon.discount_value;
            if (sp == null) return NextResponse.json({ error: 'クーポン設定が不正です' }, { status: 400 });
            serverTotalPrice = sp;
          }
          // クーポン適用条件のサーバ検証（表示層を信頼しない）。
          // #A メニュー限定: coupon_menus に行があれば、予約メニューが全てその許可集合に含まれること。
          const { data: cmRows, error: cmErr } = await supabase
            .from('coupon_menus')
            .select('menu_id')
            .eq('coupon_id', parsed.data.coupon_id);
          if (cmErr) return NextResponse.json({ error: 'クーポンの確認に失敗しました' }, { status: 500 });
          const allowedMenuIds = new Set((cmRows ?? []).map((r: { menu_id: string }) => r.menu_id));
          if (allowedMenuIds.size > 0 && !menuIdsToPrice.every((id) => allowedMenuIds.has(id))) {
            return NextResponse.json({ error: 'このクーポンは選択されたメニューには利用できません' }, { status: 400 });
          }
          // #B 種別限定: new_customer=ご来店履歴なし限定 / repeat=履歴あり限定。
          // 履歴は施設単位の有効予約(キャンセル系=cancelled/no_show/cancel_fee_paid を除く)有無で判定。ログイン時は user_id、
          // 未ログイン時は email（bookingSchema で email は必須のため guest でも常に突合可能）。
          // RLS(顧客は他予約を読めない)に依存せず確実に読むためサービスロールを使用。
          if (coupon.coupon_type === 'new_customer' || coupon.coupon_type === 'repeat') {
            const eligClient = createServiceRoleClient();
            const histQuery = eligClient
              .from('bookings')
              .select('id')
              .eq('facility_id', parsed.data.facility_id)
              .not('status', 'in', NON_OCCUPYING_STATUS_FILTER)
              .eq(user ? 'user_id' : 'email', user ? user.id : parsed.data.email)
              .limit(1);
            const { data: histRows, error: histErr } = await histQuery;
            if (histErr) return NextResponse.json({ error: 'クーポンの確認に失敗しました' }, { status: 500 });
            const hasHistory = (histRows ?? []).length > 0;
            if (coupon.coupon_type === 'new_customer' && hasHistory) {
              return NextResponse.json({ error: 'このクーポンは新規のお客様限定です' }, { status: 400 });
            }
            if (coupon.coupon_type === 'repeat' && !hasHistory) {
              return NextResponse.json({ error: 'このクーポンはご来店履歴のあるお客様限定です' }, { status: 400 });
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
  const pointsUsed = parsed.data.points_used || 0;
  if (pointsUsed > 0 && !user) {
    return NextResponse.json({ error: 'ポイント利用には認証が必要です' }, { status: 401 });
  }
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
    // 確定層ゲート（時間帯停止 #03/#09/#10・日別受付上限 #05/#46）。表示とのレースでも DB レベルで拒否される。
    if (error.message?.includes('SUSPENDED')) {
      return NextResponse.json({ error: 'この時間帯はネット予約の受付を停止しています' }, { status: 409 });
    }
    if (error.message?.includes('CAPACITY_FULL')) {
      return NextResponse.json({ error: '本日のネット予約受付は上限に達しました' }, { status: 409 });
    }
    // 施設が非公開(draft/suspended)→ネット予約不可（確定層ゲート #03）
    if (error.message?.includes('FACILITY_NOT_BOOKABLE')) {
      return NextResponse.json({ error: 'この施設は現在ネット予約を受け付けていません' }, { status: 409 });
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
    const { data: deductionRow, error: deductionErr } = await serviceSupabase
      .from('user_points')
      .insert({
        user_id: user.id,
        points: -pointsUsed,
        reason: `予約利用 (${newBookingId.slice(0, 8)})`,
      })
      .select('id')
      .single();

    // 控除 insert が失敗したら、値引きは確定済み(finalPrice/points_used 保存済み)なのに台帳が減らず
    // 「値引き＋ポイント据え置き」の二重特典になる。予約を取消して整合を保つ（発症前の根本対策 round6）。
    if (deductionErr) {
      const { error: cancelErr } = await serviceSupabase.from('bookings').update({ status: 'cancelled' }).eq('id', newBookingId);
      /* istanbul ignore next */
      if (cancelErr) console.error('[booking] points deduction insert failed AND booking cancel failed — manual cleanup', { bookingId: newBookingId, err: cancelErr });
      console.error('[booking] points deduction insert failed — booking cancelled', { bookingId: newBookingId, err: deductionErr });
      return NextResponse.json({ error: '予約に失敗しました（ポイント処理エラー）' }, { status: 500 });
    }

    // Re-verify balance to detect concurrent deductions since our snapshot
    const { data: recheck, error: recheckErr } = await serviceSupabase.from('user_points').select('points').eq('user_id', user.id);
    // 残高検証クエリ自体が失敗したら recheck=null→newBalance=0 でガードが空振りするため、安全側で巻き戻す。
    if (recheckErr) {
      // deductionErr 時は上で早期 return 済みのため、ここでは deductionRow は常に存在（?. は防御的・false側は到達不可）
      /* istanbul ignore next */
      if (deductionRow?.id) await serviceSupabase.from('user_points').delete().eq('id', deductionRow.id);
      await serviceSupabase.from('bookings').update({ status: 'cancelled' }).eq('id', newBookingId);
      console.error('[booking] points recheck failed — rolled back deduction and booking', { bookingId: newBookingId, err: recheckErr });
      return NextResponse.json({ error: '予約に失敗しました（ポイント処理エラー）' }, { status: 500 });
    }
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
