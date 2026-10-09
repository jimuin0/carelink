import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { bookingSchema, bookingReplaySchema } from '@/lib/validations-booking';
import { checkCsrf } from '@/lib/csrf';
import { bookingRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { serverError, authUnavailable } from '@/lib/with-route';
import { verifyAuthUser } from '@/lib/auth-verification';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { calculateCouponDiscountedTotal } from '@/lib/coupon-pricing';
import { buildMenuStaffMap, isStaffCompatibleWithMenus } from '@/lib/menu-staff';
import { todayJst } from '@/lib/admin-date';
import { UUID_REGEX } from '@/lib/constants';
import { BOOKING_CREATE_COOKIE, newBookingGuestScope, bookingGuestScopeHash, bookingPayloadHash, acceptedBookingResponse } from '@/lib/booking-create-receipt';
import { dispatchBookingCreationNotifications } from '@/lib/booking-create-dispatch';
import { buildBookingCreateNotifications, BookingNotificationPlanError } from '@/lib/booking-create-notifications';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
  try {
    const csrfError = checkCsrf(request); if (csrfError) return csrfError;
    const action = request.headers.get('X-Booking-Action') ?? 'create';
    if (!['context','prepare','create','status','close'].includes(action)) return json({ error: '受付操作が無効です' }, 400);
    const ip = getClientIp(request);
    if (await checkRateLimit(bookingRateLimit, ip, action === 'create' ? 3 : 30, 300_000, `booking-${action}`))
      return json({ error: '短時間に多くのリクエストがありました。しばらくお待ちください。' }, 429);
    const cookieStore = await cookies();
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: { getAll() { return cookieStore.getAll(); }, setAll(values) { try { values.forEach(({name,value,options}) => cookieStore.set(name,value,options)); } catch {} } },
    });
    const verification = await verifyAuthUser(supabase.auth);
    if (verification.state === 'unavailable') return authUnavailable('booking-auth', '/api/booking');
    const user = verification.state === 'verified' ? verification.user : null;
    const currentScope = cookieStore.get(BOOKING_CREATE_COOKIE)?.value;
    if (action === 'context') {
      const response = json({ state: 'context_ready' });
      if (!bookingGuestScopeHash(currentScope)) response.cookies.set(BOOKING_CREATE_COOKIE, newBookingGuestScope(), {
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7 * 86400,
      });
      return response;
    }
    const suppliedId = request.headers.get('Idempotency-Key');
    if (!suppliedId || !UUID_REGEX.test(suppliedId)) return json({ error: '予約画面を更新して受付番号を確認してください。入力内容は保持されています。', code: 'BOOKING_CREATE_KEY_REQUIRED' }, 428);
    const operationId = suppliedId.toLowerCase();
    const guestHash = user ? null : bookingGuestScopeHash(currentScope);
    if (!user && !guestHash) return json({ error: '同じブラウザの受付情報を確認できません。Cookieを有効にして受付状況を照合してください。', code: 'BOOKING_CREATE_CONTEXT_REQUIRED' }, 428);
    const rpcClient = createServiceRoleClient();
    const scope = { p_id: operationId, p_actor_id: user?.id ?? null, p_guest_hash: guestHash };
    const inspect = async (close: boolean) => {
      const result = await rpcClient.rpc('inspect_booking_create_operation', { ...scope, p_close: close });
      if (result.error) throw result.error;
      const row = result.data?.length === 1 ? result.data[0] : null;
      if (!row || !['committed','prepared','closed','missing','retired'].includes(row.state)) throw new Error('BOOKING_CREATE_RECEIPT_INVALID');
      if (row.state === 'committed') {
        const accepted = acceptedBookingResponse(row.response_payload, operationId);
        if (!accepted) throw new Error('BOOKING_CREATE_RECEIPT_INVALID');
        return { state: 'accepted', accepted };
      }
      return { state: row.state, accepted: null };
    };
    const reject = async (error: string, status: number) => {
      const receipt = await inspect(true);
      return receipt.accepted ? json(receipt.accepted) : json({ state: receipt.state, operationId, error }, status);
    };
    if (action === 'status' || action === 'close') {
      const receipt = await inspect(action === 'close');
      return json(receipt.accepted ?? { state: receipt.state, operationId });
    }
    const body = await request.json().catch(() => null);
    const replayParsed = bookingReplaySchema.safeParse(body);
    if (!replayParsed.success) return reject(replayParsed.error.issues[0]!.message, 400);
    const payloadHash = bookingPayloadHash(replayParsed.data);
    // Prepare checks payload equality before replay, without repeating time/price/point/slot checks on an accepted operation.
    const prepared = await rpcClient.rpc('prepare_booking_create_operation', { ...scope, p_facility_id: replayParsed.data.facility_id, p_payload_hash: payloadHash });
    if (prepared.error) {
      if (prepared.error.code === 'P0001' && prepared.error.message === 'BOOKING_CREATE_CLOSED') return json({ state: 'closed', operationId, error: 'この受付番号は終了しています。内容を確認して再度予約してください。' }, 409);
      throw prepared.error;
    }
    const receipt = prepared.data?.length === 1 ? prepared.data[0] : null;
    if (!receipt || !['prepared','committed'].includes(receipt.state)) throw new Error('BOOKING_CREATE_RECEIPT_INVALID');
    if (receipt.state === 'committed') {
      const accepted = acceptedBookingResponse(receipt.response_payload, operationId);
      if (!accepted) throw new Error('BOOKING_CREATE_RECEIPT_INVALID');
      return json(accepted);
    }
    if (action === 'prepare') return json({ state: 'prepared', operationId });
    const parsed = bookingSchema.safeParse(body);
    if (!parsed.success) return reject(parsed.error.issues[0]!.message, 400);
    if (parsed.data.start_time >= parsed.data.end_time) return reject('開始時間は終了時間より前にしてください', 400);
  // 競合チェック（早期 fast-fail）は【指名あり（staff_id 指定）】のときだけ実行する（監査M1・恒久根治）。
  // 指名なし（おまかせ=staff_id null）で施設全体の単純重複を 409 にすると容量を 1 とみなすことになり、
  // 権威側 RPC(create_booking_atomic) の G2 容量モデル（勤務中 is_active スタッフ数まで同時予約を許可）
  // と非対称になる（複数スタッフ在籍施設で正当な2件目のおまかせ予約を誤って 409 拒否していた）。
  // おまかせの容量判定は RPC の権威的判定（advisory lock 下で原子的に競合検知）へ一元化するため、
  // ここでは結果を使わない＝おまかせでは SELECT 自体を発行しない（無駄クエリを完全に排除）。
  // 指名ありは当該スタッフの二重予約を早期に弾く正当な fast-fail のため実行・維持する。
  if (parsed.data.staff_id) {
    const { data: conflicts } = await supabase
      .from('bookings')
      .select('id')
      .eq('facility_id', parsed.data.facility_id)
      .eq('booking_date', parsed.data.booking_date)
      // cancel_fee_paid（キャンセル料決済済・席は空く）も終了扱いで除外し RPC 側と揃える。
      .not('status', 'in', '("cancelled","no_show","cancel_fee_paid")')
      .lt('start_time', parsed.data.end_time)
      .gt('end_time', parsed.data.start_time)
      .eq('staff_id', parsed.data.staff_id);
    if (conflicts && conflicts.length > 0) {
      return reject('この時間帯は既に予約が入っています', 409);
    }
  }

  // Server-side price calculation (do not trust client total_price)
  // Use menu_ids for multi-menu total; fall back to menu_id for single-menu.
  // メニューは bookingSchema の refine で必須化済み（無メニュー予約は parse 時点で 400）。よって
  // menuIdsToPrice は常に非空で、serverTotalPrice は常に数値になる（null 価格前提の分岐は持たない）。
  // menu_ids が非空ならそれを使い、無ければ menu_id を単一要素にする。zod の refine で
  // 「menu_id か menu_ids のいずれか必須」が保証されるため、menu_ids が空のときは menu_id が
  // 必ず非 null になる（両方欠落は parse 時点で 400 済み・ここには到達しない）。
  const menuIdsToPrice: string[] = parsed.data.menu_ids && parsed.data.menu_ids.length > 0
    ? parsed.data.menu_ids
    : [parsed.data.menu_id!];

  const { data: menuRows, error:menuLookupError } = await supabase
    .from('facility_menus')
    .select('id, price')
    .in('id', menuIdsToPrice)
    .eq('facility_id', parsed.data.facility_id)
    // 非公開(is_published=false)メニューは予約不可。見つからない扱いになり下の allValid で 400。
    .or('is_published.is.null,is_published.eq.true');

  if (menuLookupError) return serverError('booking-menu-lookup',menuLookupError,'/api/booking');

  // Only count menus that actually belong to this facility (prevent foreign-facility injection)
  const validIds = new Set((menuRows ?? []).map((r: { id: string }) => r.id));
  const allValid = menuIdsToPrice.every((id) => validIds.has(id));
  if (!allValid) {
    return reject('メニューが見つかりません', 400);
  }

  // 【監査L1】RPC(create_booking_atomic)へ渡す primary menu_id は必ず施設所属検証済みの値にする。
  // menuIdsToPrice は全要素が allValid（facility_id + is_published）検証済みのため、その先頭を
  // primary とする。旧実装は menu_ids 使用時も別途 parsed.data.menu_id をそのまま p_menu_id として
  // 渡しており、検証集合の外だった。手組みリクエストで menu_id=他施設・menu_ids=[自施設] を送ると
  // 価格は自施設から算出される一方 bookings.menu_id に未検証の他施設 menu_id が保存され、
  // customer_visits.menu_name への越境混入も起き得た（正常UIは menu_id=menu_ids[0] のため無影響）。
  // menuIdsToPrice は zod refine（menu_id か menu_ids 必須）＋フォールバック [menu_id!] により
  // 常に非空が保証されるため [0] は常に string（`?? null` は到達不能分岐になるため置かない）。
  const primaryMenuId: string = menuIdsToPrice[0]!;

  // menuRows が null の場合は上の validIds チェックで 400 返却済みのため非 null が保証される
  const menuTotal = menuRows!.reduce((sum: number, r: { price: number | null }) => sum + (r.price ?? 0), 0);
  let serverTotalPrice: number = menuTotal;

  // Apply coupon discount if provided
  if (parsed.data.coupon_id) {
    // Coupon validity is stored as DATE and includes the final JST business day.
    const businessDate = todayJst();
    const { data: coupon, error:couponLookupError } = await supabase
      .from('coupons')
      .select('discount_type, discount_value, special_price, is_active, valid_from, valid_until')
      .eq('id', parsed.data.coupon_id)
      .eq('facility_id', parsed.data.facility_id)
      .single();
    if (couponLookupError) return serverError('booking-coupon-lookup',couponLookupError,'/api/booking');
    // Validate coupon is active and within its validity window server-side
    const couponValid = coupon &&
      coupon.is_active === true &&
      (coupon.valid_from == null || coupon.valid_from <= businessDate) &&
      (coupon.valid_until == null || coupon.valid_until >= businessDate);
    if (couponValid) {
      // クーポン×メニュー適合チェック（金銭経路の穴の恒久予防・2026年7月15日追加）。
      // coupon_menus に行が無いクーポンは全メニュー適用（本番は現在全クーポン0行のため、
      // ここでの挙動変化はゼロ＝発症前予防）。行がある場合はそのクーポンは対象メニュー限定で、
      // 選択中のメニュー(menuIdsToPrice)のいずれかが対象に含まれることを要求する。含まれない
      // 場合や取得自体が失敗した場合は無言で割引を適用せず fail-closed（400/500）で拒否する。
      const { data: couponMenuRows, error: couponMenuErr } = await supabase
        .from('coupon_menus')
        .select('menu_id')
        .eq('coupon_id', parsed.data.coupon_id);
      if (couponMenuErr) {
        return serverError('booking-coupon-menus', couponMenuErr, '/api/booking', 'クーポンの確認に失敗しました');
      }
      // 【2026年7月15日 HPB準拠仕様】coupon_menus に行があるクーポンは「対象メニューにのみ」
      // 効く（対象外メニューは定価のまま加算）。行が無いクーポンは従来どおり全メニュー適用。
      // 計算そのものは calculateCouponDiscountedTotal（src/lib/coupon-pricing.ts）に一本化し、
      // クライアント(BookingFlow)とサーバーでドリフトしないようにする（サーバーが権威）。
      let allowedMenuIds: string[] | undefined;
      if (couponMenuRows && couponMenuRows.length > 0) {
        allowedMenuIds = couponMenuRows.map((r: { menu_id: string }) => r.menu_id);
        const allowedSet = new Set(allowedMenuIds);
        const hasMatchingMenu = menuIdsToPrice.some((id) => allowedSet.has(id));
        if (!hasMatchingMenu) {
          return reject('クーポンの対象メニューが選択されていません', 400);
        }
      }
      // special_price 型は専用列 special_price に実額が入る（discount_value は null）。
      // 旧実装は discount_value を読み serverTotalPrice=null となり金額/売上/会計/ポイントが
      // 全壊していた。special_price が数値の時のみ採用（万一 null の場合はメニュー定価を維持し
      // NULL 伝播を防ぐ）＝ calculateCouponDiscountedTotal 内で担保。
      serverTotalPrice = calculateCouponDiscountedTotal(menuRows!, coupon, allowedMenuIds);
    } else {
      // coupon_id 設定済み（このブロック内は常に真）かつ couponValid = false → 無効クーポン
      return reject('クーポンが無効または期限切れです', 400);
    }
  }
  // Add nomination fee if staff is designated
  if (parsed.data.staff_id) {
    const { data: staffRow, error:staffLookupError } = await supabase
      .from('staff_profiles')
      .select('nomination_fee')
      .eq('id', parsed.data.staff_id)
      .eq('facility_id', parsed.data.facility_id)
      .maybeSingle();
    if (staffLookupError) return serverError('booking-staff-lookup',staffLookupError,'/api/booking');
    if (staffRow?.nomination_fee) {
      serverTotalPrice += staffRow.nomination_fee;
    }

    // メニュー担当スタッフ制(menu_staff・HPB準拠・2026年7月15日導入・本番0行のため挙動変化
    // ゼロで段階導入)。行があるメニューは担当スタッフのみ予約可能・行が無いメニューは従来どおり
    // 全スタッフ対応。クエリ失敗は無言で予約を通さずfail-closed（500）で拒否する。
    const { data: menuStaffRows, error: menuStaffErr } = await supabase
      .from('menu_staff')
      .select('menu_id, staff_id')
      .in('menu_id', menuIdsToPrice);
    if (menuStaffErr) {
      return serverError('booking-menu-staff', menuStaffErr, '/api/booking');
    }
    const menuStaffMap = buildMenuStaffMap(menuStaffRows ?? []);
    if (!isStaffCompatibleWithMenus(menuStaffMap, menuIdsToPrice, parsed.data.staff_id)) {
      return reject('指名されたスタッフは選択したメニューを担当していません', 400);
    }
  }

  // Handle points deduction
  const requestedPoints = parsed.data.points_used || 0;
  if (requestedPoints > 0 && !user) {
    return reject('ポイント利用には認証が必要です', 401);
  }
  // 価格を超えるポイントは利用できない（クライアントが価格変更後の stale な points_used を送ると、
  // 請求は Math.max(0,...) で 0 に丸まる一方ポイントは full 控除され、超過分が消失する＝金銭損失）。
  // メニュー必須化により serverTotalPrice は常に権威的な数値のため、その価格でクランプする。
  const pointsUsed = Math.min(requestedPoints, serverTotalPrice);
  // Early UX check only. The transaction locks the account and validates again.
  if (pointsUsed > 0 && user) {
    const { data: pointRows, error: pointsError } = await supabase.from('user_points').select('points').eq('user_id', user.id);
    if (pointsError) return serverError('booking-points-balance', pointsError, '/api/booking');
    const pointsBalanceSnapshot = (pointRows ?? []).reduce((sum: number, r: { points: number }) => sum + r.points, 0);
    if (pointsBalanceSnapshot < pointsUsed) {
      return reject('ポイント残高が不足しています', 400);
    }
  }

  // ポイント値引き反映
  const finalPrice = pointsUsed > 0
    ? Math.max(0, serverTotalPrice - pointsUsed)
    : serverTotalPrice;

  // 施設の即時確定モード取得
  const { data: facilitySettings, error:settingsLookupError } = await supabase
    .from('facility_profiles')
    .select('booking_auto_confirm')
    .eq('id', parsed.data.facility_id)
    .single();
  if (settingsLookupError) return serverError('booking-settings-lookup',settingsLookupError,'/api/booking');
  const bookingStatus = facilitySettings?.booking_auto_confirm ? 'confirmed' : 'pending';


    const notifications = await buildBookingCreateNotifications(rpcClient, parsed.data, user?.id ?? null, primaryMenuId, finalPrice, bookingStatus);
    const { data: result, error } = await rpcClient.rpc('create_booking_with_receipt_atomic', {
      ...scope, p_payload_hash: payloadHash, p_facility_id: parsed.data.facility_id, p_staff_id: parsed.data.staff_id ?? null,
      p_menu_id: primaryMenuId, p_coupon_id: parsed.data.coupon_id ?? null, p_booking_date: parsed.data.booking_date,
      p_start_time: parsed.data.start_time, p_end_time: parsed.data.end_time, p_customer_name: parsed.data.customer_name,
      p_email: parsed.data.email, p_phone: parsed.data.phone ?? null, p_note: parsed.data.note ?? null, p_total_price: finalPrice,
      p_points_used: pointsUsed, p_status: bookingStatus, p_menu_ids: menuIdsToPrice, p_notifications: notifications,
    });
    if (error) {
      if(error.code==='P0001' && error.message==='WEBHOOK_DISPATCH_V2_UNAVAILABLE')return json({error:'現在この予約を安全に処理できません。時間をおいて同じ受付番号で再確認してください。',code:'BOOKING_DISPATCH_UNAVAILABLE'},503);
      const known: Record<string, string> = {
        POINTS_INSUFFICIENT: 'ポイント残高が不足しています', BOOKING_NOT_READY: 'この店舗のネット予約は準備中です。店舗へ直接お問い合わせください',
        BOOKING_MENU_UNAVAILABLE: '選択したメニューは現在受付していません', BOOKING_CONFLICT: 'この時間帯は既に予約が入っています',
        STAFF_NOT_IN_FACILITY: '指定されたスタッフはこの施設で予約できません', BOOKING_CLOSED_DAY: 'この日は定休日のため予約できません',
        BOOKING_OUTSIDE_HOURS: '営業時間外のため予約できません', STAFF_NOT_WORKING: '指名されたスタッフはこの日時には勤務していません',
        COUPON_LIMIT: 'このクーポンは利用上限に達しています', COUPON_ALREADY_USED: 'このクーポンは既に利用済みです',
      };
      if (error.code === 'P0001' && known[error.message]) return reject(known[error.message], 409);
      throw error;
    }
    const row = result?.length === 1 ? result[0] : null;
    const accepted = row && typeof row.replayed === 'boolean' ? acceptedBookingResponse(row.response_payload, operationId) : null;
    if (!accepted) throw new Error('BOOKING_CREATE_RECEIPT_INVALID');
    const delivery = await dispatchBookingCreationNotifications(operationId);
    return json({ ...accepted, delivery });
  } catch (error) {
    if(error instanceof BookingNotificationPlanError)return json({error:'予約の通知準備を確認できません。同じ受付番号で再確認してください。',code:'BOOKING_NOTIFICATION_UNAVAILABLE'},503);
    // An unconfirmed response must retain the original key. A follow-up status/close operation resolves it.
    return serverError('booking-create-unconfirmed', error, '/api/booking', '予約の受付結果を確認できません。同じ受付番号で照合してください。');
  }
}
