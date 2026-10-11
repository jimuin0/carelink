import { mutationRateLimit, checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
/**
 * アカウント削除 API（v8.5）
 * POST /api/account/delete
 * アカウント削除。予約・診療などの業務記録の保存方針とは区別する。
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkCsrf } from '@/lib/csrf';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { todayJst } from '@/lib/admin-date';
import { serverError } from '@/lib/with-route';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { errorMessage } from '@/lib/err';

// 未完了（進行中）の予約ステータス。completed / cancelled / no_show / cancel_fee_paid は終了済み。
const ACTIVE_BOOKING_STATUSES = ['pending', 'confirmed', 'arrived'];

export const dynamic = 'force-dynamic';

// DB クエリの error を検知したときの共通中断処理。
// why: 退会ガード（未完了予約・オーナー人数）は count クエリの成否に直結する判定で、
// どちらの既定値（0 扱い/スキップ扱い）に倒しても実害が出る
// （0 扱い→稼働中施設を誤 suspend、スキップ扱い→オーナー0人の施設が公開されたまま残る）。
// fail-open にせず必ず中断・可視化する（fail-closed）。
// when: 呼び出し元は必ず 500 応答を return すること（この関数自体は応答を返さない）。
// エラーメッセージの整形は共有ヘルパー `errorMessage`（@/lib/err）に集約する
// （Supabase の PostgrestError は Error インスタンスではないため）。
function guardQueryFailedResponse(tag: string, context: string, err: unknown): NextResponse {
  console.error('[account/delete] guard query failed — aborted', { tag });
  return serverError(
    tag,
    new Error(`${context}: ${errorMessage(err)}`),
    '/api/account/delete',
    'アカウント削除に失敗しました。時間をおいて再度お試しください。',
  );
}

export async function POST(request: NextRequest) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;
    const ip = getClientIp(request);
    if (await checkRateLimit(mutationRateLimit, ip, 5, 60_000, "mutation")) {
      return NextResponse.json({ error: "リクエストが多すぎます" }, { status: 429 });
    }
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || body.confirmation !== 'DELETE') {
      return NextResponse.json({ error: '確認コードが正しくありません' }, { status: 400 });
    }

    // Compatibility boundary, not an authentication credential: the current
    // retirement UI sends this only after verified local-draft cleanup. An old
    // tab cannot rely on a response cookie arriving after irreversible Auth
    // deletion (the entire reply may be lost). Preserve that tab's input and
    // refuse deletion until the user opens the current retirement screen.
    if (request.headers.get('X-CareLink-Client-Cleanup') !== '1') {
      return NextResponse.json({
        error: 'この退会画面では端末の下書きの削除を確認できません。アカウントは削除していません。退会画面を開き直してから、もう一度お試しください。',
        code: 'CLIENT_CLEANUP_REQUIRED',
      }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    }

    const adminSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 退会ガード：未完了予約が残っている間は退会不可（顧客の予約難民・施設のキャンセル難民を防ぐ）。
    // 当日以降の進行中予約を、本人（顧客）分と所有施設（オーナー）分の両面でチェックする。
    // 3クエリとも error 未検査だと fail-open になり（クエリ失敗時 count が undefined→?? 0→0扱い）、
    // 未完了予約が残っていても退会が通ってしまう。ガードの存在意義そのものが DB エラー時に
    // 無効化されるため、error は必ず検査し fail-closed（中断・可視化）にする。
    const today = todayJst();
    const { count: ownActiveBookings, error: ownBookingsErr } = await adminSupabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('status', ACTIVE_BOOKING_STATUSES)
      .gte('booking_date', today);
    if (ownBookingsErr || ownActiveBookings === null || ownActiveBookings === undefined) {
      return guardQueryFailedResponse(
        'account-delete-guard-own-bookings',
        'active bookings guard query (own) failed',
        ownBookingsErr ?? new Error('active bookings count unavailable'),
      );
    }

    const { data: ownerMemberships, error: ownerMembershipsErr } = await adminSupabase
      .from('facility_members')
      .select('facility_id')
      .eq('user_id', user.id)
      .eq('role', 'owner');
    if (ownerMembershipsErr || !Array.isArray(ownerMemberships)) {
      return guardQueryFailedResponse(
        'account-delete-guard-owner-memberships',
        'owner memberships guard query failed',
        ownerMembershipsErr ?? new Error('owner memberships unavailable'),
      );
    }

    let facilityActiveBookings = 0;
    if (ownerMemberships && ownerMemberships.length > 0) {
      const facilityIds = ownerMemberships.map((m) => m.facility_id);
      const { count: facilityCount, error: facilityBookingsErr } = await adminSupabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .in('facility_id', facilityIds)
        .in('status', ACTIVE_BOOKING_STATUSES)
        .gte('booking_date', today);
      if (facilityBookingsErr || facilityCount === null || facilityCount === undefined) {
        return guardQueryFailedResponse(
          'account-delete-guard-facility-bookings',
          'active bookings guard query (facility) failed',
          facilityBookingsErr ?? new Error('facility bookings count unavailable'),
        );
      }
      facilityActiveBookings = facilityCount;
    }

    if (ownActiveBookings > 0 || facilityActiveBookings > 0) {
      return NextResponse.json(
        { error: '未完了の予約が残っているため退会できません。予約の完了またはキャンセル後に再度お試しください。' },
        { status: 409 }
      );
    }

    // New API may be live before migration 5. No destructive Auth request
    // proceeds on a missing/disabled marker or an uncertain read response.
    let cleanupReady = false;
    try {
      const readiness = await adminSupabase.rpc('account_deletion_cleanup_version');
      cleanupReady = !readiness.error && readiness.data === 1;
    } catch { /* dependency failure is unavailable, not proof of readiness */ }
    if (!cleanupReady) {
      const diagnostic = new Error('ACCOUNT_DELETE_CLEANUP_UNAVAILABLE');
      safeCaptureException(diagnostic, 'account-delete-cleanup-unavailable');
      alertCaughtError('account-delete-cleanup-unavailable', diagnostic, '/api/account/delete', 503);
      return NextResponse.json({ error: '現在アカウントの削除を安全に処理できません。時間をおいて再度お試しください。', code: 'ACCOUNT_DELETE_UNAVAILABLE' },
        { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } });
    }

    // Final authorization, active-booking check, all 17 personal cleanup
    // operations, profile/membership CASCADE and last-owner suspension are
    // inside this one Auth deletion transaction. Do not pre-delete anything or
    // pre-suspend based on an earlier owner count: failure must leave the live
    // account's data and facility publication intact.
    // auth.usersから削除
    const { error: authDeleteErr } = await adminSupabase.auth.admin.deleteUser(user.id);
    if (authDeleteErr) {
      console.error('[account/delete] retirement transaction failed — account and cleanup rolled back');
      // DB trigger の整理も同一transactionでrollbackされ、本人参照を保持して再実行できる。
      return serverError(
        'account-delete-auth',
        new Error(
          `auth.users retirement transaction failed; original account context retained: ${errorMessage(authDeleteErr)}`,
        ),
        '/api/account/delete',
        'アカウント削除に失敗しました',
      );
    }

    const { ua } = getRequestContext(request);
    void writeAuditLog({
      // 削除済みauth.usersをFK参照すると監査ログ自体が保存できない。
      userId: null,
      action: 'delete',
      tableName: 'profiles',
      recordId: user.id,
      newValues: { reason: 'self_account_deletion' },
      ipAddress: ip,
      userAgent: ua,
    });

    // 削除済みユーザーの Supabase セッション Cookie をブラウザから除去する。
    // 残置すると以後のリクエストで無効トークンが送られ続ける（getUser で弾かれるとはいえ
    // 不要な失敗・「ログイン状態に見える」UI 不整合の素になる）。auth-token 系のみ失効させる。
    const res = NextResponse.json({ success: true });
    // The pre-cleaned current tab has no dependence on receipt of this cookie.
    // Other tabs consume the non-secret marker before local drafts are restored;
    // this cannot erase arbitrary old JavaScript's in-memory input remotely.
    res.cookies.set('carelink_client_cleanup', '1', {
      path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60,
    });
    for (const c of cookieStore.getAll()) {
      if (c.name.startsWith('sb-') && c.name.includes('auth-token')) {
        res.cookies.set(c.name, '', { maxAge: 0, path: '/' });
      }
    }
    return res;
  } catch (e) {
    return serverError('account-delete', e, '/api/account/delete', 'アカウント削除に失敗しました');
  }
}
