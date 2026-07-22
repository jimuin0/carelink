import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { bookingSchema } from '@/lib/validations-booking';
import { zodErrorResponse } from '@/lib/api-validation';
import { checkCsrf } from '@/lib/csrf';
import { sendBookingConfirmation, sendBookingConfirmed, sendNewBookingNotification } from '@/lib/email';
import { bookingRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { sendPushToFacilityOwners, sendPushToUser } from '@/lib/push';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { getFacilityNotificationSettings } from '@/lib/notification-settings';
import { sendBookingConfirmation as sendLineBookingConfirm } from '@/lib/line';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { resolveLineUserIdForUser } from '@/lib/line-link';
import { notifyNewBookingLineWorks, isLineWorksConfigured } from '@/lib/integrations/line-works';
import { calculateCouponDiscountedTotal } from '@/lib/coupon-pricing';
import { buildMenuStaffMap, isStaffCompatibleWithMenus } from '@/lib/menu-staff';

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
    return zodErrorResponse(parsed.error);
  }

  // 時間バリデーション
  if (parsed.data.start_time >= parsed.data.end_time) {
    return NextResponse.json({ error: '開始時間は終了時間より前にしてください' }, { status: 400 });
  }

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
      return NextResponse.json({ error: 'この時間帯は既に予約が入っています' }, { status: 409 });
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
        return NextResponse.json({ error: 'クーポンの確認に失敗しました' }, { status: 500 });
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
          return NextResponse.json({ error: 'クーポンの対象メニューが選択されていません' }, { status: 400 });
        }
      }
      // special_price 型は専用列 special_price に実額が入る（discount_value は null）。
      // 旧実装は discount_value を読み serverTotalPrice=null となり金額/売上/会計/ポイントが
      // 全壊していた。special_price が数値の時のみ採用（万一 null の場合はメニュー定価を維持し
      // NULL 伝播を防ぐ）＝ calculateCouponDiscountedTotal 内で担保。
      serverTotalPrice = calculateCouponDiscountedTotal(menuRows!, coupon, allowedMenuIds);
    } else {
      // coupon_id 設定済み（このブロック内は常に真）かつ couponValid = false → 無効クーポン
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
      return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    }
    const menuStaffMap = buildMenuStaffMap(menuStaffRows ?? []);
    if (!isStaffCompatibleWithMenus(menuStaffMap, menuIdsToPrice, parsed.data.staff_id)) {
      return NextResponse.json({ error: '指名されたスタッフは選択したメニューを担当していません' }, { status: 400 });
    }
  }

  // Handle points deduction
  const requestedPoints = parsed.data.points_used || 0;
  if (requestedPoints > 0 && !user) {
    return NextResponse.json({ error: 'ポイント利用には認証が必要です' }, { status: 401 });
  }
  // 価格を超えるポイントは利用できない（クライアントが価格変更後の stale な points_used を送ると、
  // 請求は Math.max(0,...) で 0 に丸まる一方ポイントは full 控除され、超過分が消失する＝金銭損失）。
  // メニュー必須化により serverTotalPrice は常に権威的な数値のため、その価格でクランプする。
  const pointsUsed = Math.min(requestedPoints, serverTotalPrice);
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
  const finalPrice = pointsUsed > 0
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
  // DB-2: create_booking_atomic は p_user_id / p_total_price / p_status を検証せず全入力を信頼する
  // ため、anon/authenticated が PostgREST から直接呼ぶとサーバ側の認証・価格計算を迂回して
  // total_price=0・任意 user_id・status 捏造の予約を作れてしまう。RPC は必ず service_role で呼び、
  // migration 側で anon/authenticated の EXECUTE を撤回して直接呼び出し経路を塞ぐ。ここで渡す値は
  // すべて上流でサーバ側検証・算出済み（user は auth.getUser()、finalPrice はサーバ側計算）。
  const rpcClient = createServiceRoleClient();
  const { data: rpcResult, error } = await rpcClient.rpc('create_booking_atomic', {
    p_facility_id: parsed.data.facility_id,
    p_staff_id: parsed.data.staff_id ?? null,
    p_user_id: user?.id ?? null,
    p_menu_id: primaryMenuId,
    p_coupon_id: parsed.data.coupon_id ?? null,
    p_booking_date: parsed.data.booking_date,
    p_start_time: parsed.data.start_time,
    p_end_time: parsed.data.end_time,
    p_customer_name: parsed.data.customer_name,
    p_email: /* istanbul ignore next */ parsed.data.email ?? null,
    p_phone: parsed.data.phone ?? null,
    p_note: parsed.data.note ?? null,
    p_total_price: finalPrice,
    p_points_used: pointsUsed,
    p_status: bookingStatus,
    // 公開経路は営業時間・定休日・指名スタッフ勤務窓ゲートを RPC 側で強制する（get_available_slots
    // が UI に出さない枠を API 直叩きで確定できた非対称の根治・2026年7月16日）。admin の手動予約
    // （電話受付等）は意図的にゲート対象外＝パラメータ省略（DEFAULT FALSE）。
    p_enforce_schedule: true,
  });
  void bookingData;

  if (error) {
    // BOOKING_CONFLICT raised by the RPC
    if (error.message?.includes('BOOKING_CONFLICT') || error.code === '23505') {
      return NextResponse.json({ error: 'この時間帯は既に予約が入っています' }, { status: 409 });
    }
    // 指名スタッフが当該施設に属さない（create_booking_atomic が G1 ガードで RAISE）。
    // 他施設スタッフの割り当て＝マルチテナント違反を fail-closed で拒否する。
    if (error.message?.includes('STAFF_NOT_IN_FACILITY')) {
      return NextResponse.json({ error: '指定されたスタッフはこの施設で予約できません' }, { status: 400 });
    }
    // スケジュールゲート（p_enforce_schedule=true で RPC が RAISE・2026年7月16日）。
    // UI(get_available_slots) が出さない枠の API 直叩きを、時間帯利用不可＝BOOKING_CONFLICT と
    // 同じ流儀の 409 で拒否する。
    if (error.message?.includes('BOOKING_CLOSED_DAY')) {
      return NextResponse.json({ error: 'この日は定休日のため予約できません' }, { status: 409 });
    }
    if (error.message?.includes('BOOKING_OUTSIDE_HOURS')) {
      return NextResponse.json({ error: '営業時間外のため予約できません' }, { status: 409 });
    }
    if (error.message?.includes('STAFF_NOT_WORKING')) {
      return NextResponse.json({ error: '指名されたスタッフはこの日時には勤務していません' }, { status: 409 });
    }
    // クーポン使用制限（create_booking_atomic が RAISE する。トランザクションごとロールバック済み）
    if (error.message?.includes('COUPON_LIMIT')) {
      return NextResponse.json({ error: 'このクーポンは利用上限に達しています' }, { status: 409 });
    }
    if (error.message?.includes('COUPON_ALREADY_USED')) {
      return NextResponse.json({ error: 'このクーポンは既に利用済みです' }, { status: 409 });
    }
    return NextResponse.json({ error: '予約に失敗しました' }, { status: 500 });
  }

  const newBookingId: string = rpcResult || '';
  if (!newBookingId) {
    console.error('[booking] create_booking_atomic returned null with no error');
    return NextResponse.json({ error: '予約に失敗しました' }, { status: 500 });
  }

  // 複数メニュー予約は menu_ids 列に全メニューを保存する。create_booking_atomic は p_menu_id(単一)
  // しか受けず menu_id には先頭1件しか入らないため、保存しないと予約詳細の表示が1件目のみになる（A6）。
  // 料金・所要時間は既に全メニュー合算で正しい。失敗は致命でない（menu_id への単一フォールバックで
  // 表示は機能する）ため warn のみ。単一メニュー時は menu_id で足りるのでスキップ。
  if (menuIdsToPrice.length > 1) {
    const svc = createServiceRoleClient();
    const { error: menuIdsErr } = await svc.from('bookings').update({ menu_ids: menuIdsToPrice }).eq('id', newBookingId);
    if (menuIdsErr) console.error('[booking] menu_ids persist failed', { bookingId: newBookingId, err: menuIdsErr.message });
  }

  // Points deduction with CAS (compare-and-swap) to prevent race conditions:
  // Insert the deduction row via service_role (user_points has no INSERT policy for anon client),
  // then verify the running balance is still non-negative.
  // If another concurrent request already deducted points (balance changed since snapshot),
  // roll back and cancel the booking.
  if (pointsUsed > 0 && user && newBookingId) {
    const serviceSupabase = createServiceRoleClient();
    // ロールバック共通処理: 予約をキャンセルし、成立しなかったクーポン利用(coupon_redemptions)も解放する。
    // クーポンを解放しないと、予約が成立していないのに「1人1回」上限が恒久消費され、以後そのクーポンが
    // COUPON_ALREADY_USED で使えなくなる（SM-6）。coupon_redemptions は booking_id 列で一意特定できる。
    const rollbackBooking = async () => {
      const { error: rbErr } = await serviceSupabase.from('bookings').update({ status: 'cancelled' }).eq('id', newBookingId);
      if (rbErr) console.error('[booking] booking rollback failed — manual cleanup needed', { bookingId: newBookingId, err: rbErr.message });
      if (parsed.data.coupon_id) {
        const { error: crErr } = await serviceSupabase.from('coupon_redemptions').delete().eq('booking_id', newBookingId);
        /* istanbul ignore next — 解放 delete 失敗は DB 障害時のみの防御ログ */
        if (crErr) console.error('[booking] coupon redemption release failed — manual cleanup needed', { bookingId: newBookingId, err: crErr.message });
      }
    };

    const { data: deductionRow, error: deductErr } = await serviceSupabase
      .from('user_points')
      .insert({
        user_id: user.id,
        points: -pointsUsed,
        reason: `予約利用 (${newBookingId.slice(0, 8)})`,
      })
      .select('id')
      .single();

    // 控除 INSERT が失敗すると、控除行が入らないのに total_price は値引き済で予約が確定し、
    // 客はポイントを保持したまま値引きを得る（キャンセル返還でポイント鋳造にも波及）＝金銭損失。
    // 従来 error を捨てていたためこの経路が無音だった。失敗時は予約をキャンセルして 500 で明示する。
    if (deductErr) {
      await rollbackBooking();
      return NextResponse.json({ error: 'ポイントの利用処理に失敗しました。時間をおいて再度お試しください。' }, { status: 500 });
    }

    // Re-verify balance to detect concurrent deductions since our snapshot
    const { data: recheck, error: recheckErr } = await serviceSupabase.from('user_points').select('points').eq('user_id', user.id);
    // recheck の取得失敗を fail-open（残高不明を 0 扱い）にすると `0 < 0` が成立せず負残高検知が無効化し、
    // 残高を超えるポイント利用が通ってしまう。取得できない場合は安全側で控除と予約をロールバックする。
    if (recheckErr) {
      /* istanbul ignore next — deductionRow は直前の insert 成功で常に存在する防御チェック */
      if (deductionRow?.id) await serviceSupabase.from('user_points').delete().eq('id', deductionRow.id);
      await rollbackBooking();
      return NextResponse.json({ error: 'ポイント残高の確認に失敗しました。時間をおいて再度お試しください。' }, { status: 500 });
    }
    const newBalance = (recheck ?? []).reduce((sum: number, r: { points: number }) => sum + r.points, 0);
    if (newBalance < 0) {
      // CAS failed: another concurrent request deducted points between our read and write.
      // Rollback: delete this specific deduction row by ID (not by reason, to avoid ambiguity)
      if (deductionRow?.id) {
        const { error: rollbackPointsErr } = await serviceSupabase.from('user_points').delete().eq('id', deductionRow.id);
        if (rollbackPointsErr) console.error('[booking] point deduction rollback failed — manual cleanup needed', { deductionId: deductionRow.id, err: rollbackPointsErr });
      }
      await rollbackBooking();
      return NextResponse.json({ error: 'ポイント残高が不足しています（競合が発生しました）' }, { status: 400 });
    }
  }

  // レスポンス返却後に走らせていた副作用（メール・Push・LINE 通知）をここに集約し、return 直前に
  // await Promise.allSettled でまとめて完了させる。【2026年7月7日 本番実データで確定した恒久根治】
  // 従来は各副作用を Vercel の waitUntil() に渡す fire-and-forget だったが、Fluid Compute 無効の
  // 本番では関数がレスポンス返却直後に凍結され、waitUntil の後処理が一切完走せず通知が全滅していた
  // （口コミルート /api/review と同一の欠陥・同一の根治）。各 send は safeSend 等の契約で失敗しても
  // reject せず、末尾 .catch でも握るため allSettled で本体レスポンス(200)には影響しない。
  const bookingSideEffects: Promise<unknown>[] = [];

  // Send email notifications (non-blocking)
  try {
    // facility_members（RLS: USING(auth.uid()=user_id)）は匿名予約では anon 権限の supabase では
    // 常に0行（本人の行しか見えない）。同じく profiles（RLS: USING(auth.uid()=id)）も匿名では
    // 0行。この2クエリだけは service role（RLSバイパス）で引く。facility_profiles / facility_menus
    // / staff_profiles は「公開施設は誰でも読める」ポリシー（Public read published 等）があるため
    // anon のままで問題ない（2026年7月16日 本番実データで確定：匿名予約でオーナー通知メールが
    // 一度も送信されない事故の根治）。
    const ownerLookupClient = createServiceRoleClient();
    const [facilityResult, menuResult, staffResult, ownerResult] = await Promise.all([
      supabase.from('facility_profiles').select('name, phone').eq('id', parsed.data.facility_id).single(),
      parsed.data.menu_id
        ? supabase.from('facility_menus').select('name').eq('id', parsed.data.menu_id).eq('facility_id', parsed.data.facility_id).single()
        : Promise.resolve({ data: null }),
      parsed.data.staff_id
        ? supabase.from('staff_profiles').select('name').eq('id', parsed.data.staff_id).eq('facility_id', parsed.data.facility_id).single()
        : Promise.resolve({ data: null }),
      // 施設の全オーナー・管理者を取得（配列）。旧実装は .limit(1).single() で非決定的に1人だけ取得し、
      // push.ts(sendPushToFacilityOwners) が owner/admin 全員へ送るのと非対称で、複数オーナー運用時に
      // 一部オーナーへ新規予約メールが届かなかった。配列 select なら複数行でも PGRST116 にならず、
      // 全員へ送れる（下でメール宛先を全員化する）。role も push.ts と揃え owner に加え admin も対象にする
      // （2026年7月17日 恒久根治：facility_members の admin ロールは Push は受け取るがメール通知は
      // .eq('role','owner') のため受け取れない非対称があった）。
      ownerLookupClient.from('facility_members').select('user_id').eq('facility_id', parsed.data.facility_id).in('role', ['owner', 'admin']),
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
      totalPrice: finalPrice,
      bookingId: newBookingId,
    };

    // 即時確定（booking_auto_confirm=true）施設では status='confirmed' になるため、
    // 「確認待ち＋確定メールを後送」を案内する sendBookingConfirmation ではなく、確定メール
    // sendBookingConfirmed を送る。従来は常に確認待ちメールを送り、自動確定施設の顧客は
    // 来ることのない確定メールを待ち続けた（確定メールは admin 経路からしか送られない）。
    // いずれの送信関数も失敗時 throw せず false を返す契約のため、.catch() だけでは失敗が
    // 無音化する（想定外の例外のみ catch が発火する）。戻り値を確認して可視化する。
    const confirmationEmailSend = bookingStatus === 'confirmed'
      ? sendBookingConfirmed(emailData)
      : sendBookingConfirmation(emailData);
    bookingSideEffects.push(
      confirmationEmailSend.then((ok) => {
        if (!ok) {
          const err = new Error('booking confirmation email send failed');
          safeCaptureException(err, 'booking-email');
          alertCaughtError('booking-email', err, '/api/booking');
        }
      }).catch((e) => {
        safeCaptureException(e, 'booking-email');
        alertCaughtError('booking-email', e, '/api/booking');
      })
    );

    // Notify ALL facility owners（メールを全オーナーへ）。push.ts の owner 全員通知と対称にする。
    const ownerRows = (ownerResult.data as { user_id: string }[] | null) ?? [];
    if (ownerRows.length > 0) {
      const ownerUserIds = Array.from(new Set(ownerRows.map((o) => o.user_id).filter(Boolean)));
      const { data: ownerProfiles } = await ownerLookupClient.from('profiles').select('email').in('id', ownerUserIds);
      const ownerEmails = Array.from(new Set(
        ((ownerProfiles as { email: string | null }[] | null) ?? []).map((p) => p.email).filter(Boolean) as string[]
      ));
      for (const facilityEmail of ownerEmails) {
        bookingSideEffects.push(
          sendNewBookingNotification({ ...emailData, facilityEmail }).then((ok) => {
            if (!ok) {
              const err = new Error('new booking notification email send failed');
              safeCaptureException(err, 'booking-email-owner');
              alertCaughtError('booking-email-owner', err, '/api/booking');
            }
          }).catch((e) => {
            safeCaptureException(e, 'booking-email-owner');
            alertCaughtError('booking-email-owner', e, '/api/booking');
          })
        );
      }
    }
  } catch (e) {
    safeCaptureException(e, 'booking-email-setup');
  }

  // Push notifications (non-blocking)
  try {
    // 施設オーナーへの新規予約 Push は施設の通知設定（push_on_new_booking）で制御する。
    // 客本人への確認 Push（下）は施設設定の対象外（客自身の予約確認のため常に送る）。
    const notif = await getFacilityNotificationSettings(parsed.data.facility_id);
    if (notif.pushOnNewBooking) {
      bookingSideEffects.push(
        sendPushToFacilityOwners(parsed.data.facility_id, {
          title: '新規予約',
          body: `${parsed.data.customer_name}様から${parsed.data.booking_date} ${parsed.data.start_time}〜の予約が入りました`,
          url: '/admin/bookings',
          tag: `booking-${newBookingId}`,
        }).catch((e) => safeCaptureException(e, 'booking-push-owner'))
      );
    }

    if (user) {
      bookingSideEffects.push(
        sendPushToUser(user.id, {
          title: '予約を受け付けました',
          body: `${parsed.data.booking_date} ${parsed.data.start_time}〜のご予約を承りました`,
          url: `/mypage/bookings/${newBookingId}`,
          tag: `booking-confirm-${newBookingId}`,
        }).catch((e) => safeCaptureException(e, 'booking-push-user'))
      );
    }
  } catch (e) {
    safeCaptureException(e, 'booking-push-setup');
  }

  // LINE notification (non-blocking)
  try {
    if (user && process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) {
      const adminSupabase = createServiceRoleClient();
      // 【監査C2】連携の単一ソース profiles.line_user_id で解決する（line_user_links.user_id は
      // どの経路でも populate されず常に0件ヒットで LINE 通知が無音失効していた）。
      const lineUserId = await resolveLineUserIdForUser(adminSupabase, user.id);

      if (lineUserId) {
        const { data: facilityForLine } = await supabase
          .from('facility_profiles')
          .select('name')
          .eq('id', parsed.data.facility_id)
          .maybeSingle();

        let lineMenuName = '';
        if (parsed.data.menu_id) {
          const { data: menuForLine } = await supabase.from('facility_menus').select('name').eq('id', parsed.data.menu_id).eq('facility_id', parsed.data.facility_id).maybeSingle();
          lineMenuName = menuForLine?.name || '';
        }

        // 指名予約の担当スタッフ名を LINE 確認に含める（A-14）。lib/line は staffName 対応済みだが
        // 従来この呼び出しが渡しておらず、顧客の LINE 予約確認に担当名が出ていなかった。
        let lineStaffName = '';
        if (parsed.data.staff_id) {
          const { data: staffForLine } = await supabase.from('staff_profiles').select('name').eq('id', parsed.data.staff_id).eq('facility_id', parsed.data.facility_id).maybeSingle();
          lineStaffName = staffForLine?.name || '';
        }

        // sendLineBookingConfirm は sendLinePush 経由で送信失敗時も throw せず false を返す
        // 契約のため、.catch() だけでは失敗が無音化する。戻り値を確認して可視化する。
        // 本パスは line_user_id 連携済みの時のみ到達するため、false は「連携なし」でなく真の未送達。
        bookingSideEffects.push(
          sendLineBookingConfirm(lineUserId, {
            facilityName: facilityForLine?.name || '',
            menuName: lineMenuName,
            staffName: lineStaffName || undefined,
            date: parsed.data.booking_date,
            time: parsed.data.start_time,
          }).then((ok) => {
            if (!ok) {
              const err = new Error('LINE booking confirmation send failed');
              console.error('[booking] LINE booking confirmation not delivered', { userId: user.id, bookingId: newBookingId });
              safeCaptureException(err, 'booking-line');
              alertCaughtError('booking-line', err, '/api/booking');
            }
          }).catch((e) => {
            safeCaptureException(e, 'booking-line');
            alertCaughtError('booking-line', e, '/api/booking');
          })
        );
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
            // notifyNewBookingLineWorks も失敗時 throw せず false を返す契約。line_works_channel_id
            // 設定済みスタッフのみが対象なので false は真の未送達＝ログ化して可観測にする（非ブロッキング維持）。
            bookingSideEffects.push(
              notifyNewBookingLineWorks(staff.line_works_channel_id, bookingInfo)
                .then((ok) => { if (!ok) console.error('[booking] LINE Works new-booking notification not delivered', { bookingId: newBookingId, staffId: staff.id }); })
                .catch((e) => safeCaptureException(e, 'booking-lineworks'))
            );
          }
        }
        void facilityRow;
      }
    } catch (e) {
      safeCaptureException(e, 'booking-lineworks-setup');
    }
  }

  // レスポンス返却前に副作用を確実に完了させる（waitUntil 後処理が本番で全滅していた恒久根治）。
  await Promise.allSettled(bookingSideEffects);

  return NextResponse.json({ success: true, bookingId: newBookingId });
  } catch (e) {
    safeCaptureException(e, 'booking');
    // catch して 500 を返すと instrumentation.ts の onRequestError に伝播せず Slack 通知が漏れるため明示通知。
    alertCaughtError('booking', e, '/api/booking');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
