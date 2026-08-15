import { mutationRateLimit, checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
/**
 * アカウント削除 API（v8.5）
 * POST /api/account/delete
 * ユーザーの全データを削除（個人情報保護法対応）
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkCsrf } from '@/lib/csrf';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { todayJst } from '@/lib/admin-date';
import { alertCaughtError } from '@/lib/alert';
import { resolveLineUserIdForUser } from '@/lib/line-link';
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
  console.error(`[account/delete] ${context} — aborted`, { err });
  alertCaughtError(tag, new Error(`${context}: ${errorMessage(err)}`), '/api/account/delete');
  return NextResponse.json(
    { error: 'アカウント削除に失敗しました。時間をおいて再度お試しください。' },
    { status: 500 },
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

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const { confirmation } = await request.json().catch(() => ({}));
    if (confirmation !== 'DELETE') {
      return NextResponse.json({ error: '確認コードが正しくありません' }, { status: 400 });
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
    if (ownBookingsErr) {
      return guardQueryFailedResponse(
        'account-delete-guard-own-bookings',
        'active bookings guard query (own) failed',
        ownBookingsErr,
      );
    }

    const { data: ownerMemberships, error: ownerMembershipsErr } = await adminSupabase
      .from('facility_members')
      .select('facility_id')
      .eq('user_id', user.id)
      .eq('role', 'owner');
    if (ownerMembershipsErr) {
      return guardQueryFailedResponse(
        'account-delete-guard-owner-memberships',
        'owner memberships guard query failed',
        ownerMembershipsErr,
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
      if (facilityBookingsErr) {
        return guardQueryFailedResponse(
          'account-delete-guard-facility-bookings',
          'active bookings guard query (facility) failed',
          facilityBookingsErr,
        );
      }
      facilityActiveBookings = facilityCount ?? 0;
    }

    if ((ownActiveBookings ?? 0) > 0 || facilityActiveBookings > 0) {
      return NextResponse.json(
        { error: '未完了の予約が残っているため退会できません。予約の完了またはキャンセル後に再度お試しください。' },
        { status: 409 }
      );
    }

    // 【監査C2 low】line_user_links.user_id は恒常的に NULL（webhook は user_id 未設定で upsert・
    // populate するコードが無い）ため、旧 .eq('user_id', user.id) 削除は一致0行でフォロー行が
    // 退会後も孤児として残存していた。連携の line_user_id を profiles（単一ソース）から解決し、
    // それを起点に削除する（未連携＝lineUserId null のときは対象行なしで削除自体を発行しない）。
    //
    // why: profiles がこの解決の唯一のソースであるため、profiles の削除は下のバッチに含めず
    // （バッチは Promise.allSettled で並行実行される＝順序は保証されない）、バッチが失敗チェックを
    // 通過した後に単独で削除する（詳細は下の profiles 削除箇所のコメント参照）。これにより
    // バッチが部分失敗して再実行される場合も profiles が生き残っているため、この行が
    // 毎回正しく lineUserId を再解決できる＝退会処理全体が再実行に対して冪等になる。
    const lineUserId = await resolveLineUserIdForUser(adminSupabase, user.id);

    // 関連データ削除（CASCADE設定されていないテーブル + SET NULL で残存するPIIテーブル）
    const deleteResults = await Promise.allSettled([
      // CASCADE なし → 明示削除必須
      lineUserId
        ? adminSupabase.from('line_user_links').delete().eq('line_user_id', lineUserId)
        : Promise.resolve({ error: null }), // 未連携＝対象行なし。結果チェックの {error} 形に揃える。
      adminSupabase.from('favorites').delete().eq('user_id', user.id),
      adminSupabase.from('user_points').delete().eq('user_id', user.id),
      adminSupabase.from('push_subscriptions').delete().eq('user_id', user.id),
      adminSupabase.from('referral_codes').delete().eq('user_id', user.id),
      adminSupabase.from('review_helpful').delete().eq('user_id', user.id),
      adminSupabase.from('user_preferred_staff').delete().eq('user_id', user.id),
      adminSupabase.from('google_calendar_tokens').delete().eq('user_id', user.id),
      adminSupabase.from('user_packages').delete().eq('user_id', user.id),
      adminSupabase.from('user_subscriptions').delete().eq('user_id', user.id),
      // SET NULL テーブル → user_id を NULL に更新してPII分離
      adminSupabase.from('intake_form_responses').update({ user_id: null }).eq('user_id', user.id),
      adminSupabase.from('nps_surveys').update({ user_id: null }).eq('user_id', user.id),
      adminSupabase.from('booking_waitlist').update({ user_id: null }).eq('user_id', user.id),
      adminSupabase.from('treatment_records').update({ user_id: null }).eq('user_id', user.id),
      adminSupabase.from('treatment_plans').update({ user_id: null }).eq('user_id', user.id),
      adminSupabase.from('bookings').update({ user_id: null }).eq('user_id', user.id),
      // created_by が auth.users(id) を ON DELETE 指定なし(RESTRICT)で参照するテーブル。
      // 当該ユーザーが作成した行が残っていると下の auth.admin.deleteUser が FK 違反で失敗し、
      // アカウント削除が丸ごと 500 になる（個人情報保護法対応の致命的ブロック）。
      // 監査用途の作成者参照のため、削除ではなく NULL 化して参照を切る。
      adminSupabase.from('newsletter_campaigns').update({ created_by: null }).eq('created_by', user.id),
      adminSupabase.from('api_keys').update({ created_by: null }).eq('created_by', user.id),
      // profiles はこのバッチに含めない（下で単独削除する）。opIndex ベースのログは
      // このバッチの要素数に対応するため、要素を増減させたら opIndex の対応も見直すこと。
    ]);

    const failedOps = deleteResults
      .map((r, i) => ({ i, r }))
      .filter(({ r }) => r.status === 'rejected' || (r.status === 'fulfilled' && (r.value as { error?: unknown }).error));
    if (failedOps.length > 0) {
      console.error('[account/delete] PII deletion partial failure — manual GDPR cleanup required', {
        userId: user.id,
        failures: failedOps.map(({ i, r }) => ({
          opIndex: i,
          // allSettled は 'rejected' | 'fulfilled' しか返さないため三項の else は到達不可
          reason: r.status === 'rejected' ? r.reason : (r.value as { error?: unknown }).error,
        })),
      });
      // PII 削除が部分失敗した状態で auth.users を消すと、残存 PII 行が削除済みユーザーを指す
      // 孤立データになり個人情報保護法違反になる（発症後では検知不能）。auth 削除の前に中断し、
      // Slack 通知して 500 を返す。各削除/NULL 化は user_id 等値で冪等のため、ユーザーは
      // 再実行で安全にやり直せる（既に消えた行は no-op・残りが消える＝発症前予防）。
      alertCaughtError(
        'account-delete-pii',
        new Error(`PII deletion partial failure (${failedOps.length} ops) — aborted before auth deletion`),
        '/api/account/delete',
      );
      return NextResponse.json(
        { error: 'アカウント削除に失敗しました。時間をおいて再度お試しください。' },
        { status: 500 },
      );
    }

    // profiles は必ず最後（バッチの外）で削除する。
    // why: resolveLineUserIdForUser は profiles.line_user_id を読む。profiles をバッチに
    // 含めて Promise.allSettled で並行削除すると、他のバッチ要素が失敗して中断した再実行時に
    // profiles だけが先に消えている可能性があり（allSettled は並行実行のため順序不定）、
    // 再実行時に lineUserId を再解決できず line_user_links の削除が発行されなくなる
    // （line_user_links.user_id は常に NULL のため auth.users 削除の CASCADE も効かず、
    // LINE 識別子を含む行が恒久的に孤児化する）。バッチの失敗チェックを通過した後に
    // profiles を単独で削除することで、部分失敗時は profiles が残り、再実行時に
    // resolveLineUserIdForUser が正しく解決できる＝退会処理全体が冪等になる。
    // when: 削除に失敗した場合は auth.users 削除の前に中断する（従来どおり）。
    const { error: profilesDeleteErr } = await adminSupabase.from('profiles').delete().eq('id', user.id);
    if (profilesDeleteErr) {
      console.error('[account/delete] profiles deletion failed — manual cleanup required', {
        userId: user.id,
        err: profilesDeleteErr,
      });
      alertCaughtError(
        'account-delete-profiles',
        new Error(`profiles deletion failed: ${errorMessage(profilesDeleteErr)}`),
        '/api/account/delete',
      );
      return NextResponse.json(
        { error: 'アカウント削除に失敗しました。時間をおいて再度お試しください。' },
        { status: 500 },
      );
    }

    // 施設オーナーの場合、施設も削除
    const { data: memberships, error: membershipsErr } = await adminSupabase
      .from('facility_members')
      .select('facility_id, role')
      .eq('user_id', user.id)
      .eq('role', 'owner');
    if (membershipsErr) {
      return guardQueryFailedResponse(
        'account-delete-memberships-select',
        'facility_members (owner) select failed',
        membershipsErr,
      );
    }

    if (memberships) {
      for (const m of memberships) {
        // 他にオーナーがいない場合のみ施設削除
        const { count, error: ownerCountErr } = await adminSupabase
          .from('facility_members')
          .select('id', { count: 'exact', head: true })
          .eq('facility_id', m.facility_id)
          .eq('role', 'owner')
          .neq('user_id', user.id);
        if (ownerCountErr) {
          return guardQueryFailedResponse(
            'account-delete-owner-count',
            `owner count query failed (facility_id=${m.facility_id})`,
            ownerCountErr,
          );
        }

        if ((count ?? 0) === 0) {
          const { error: suspendErr } = await adminSupabase.from('facility_profiles').update({ status: 'suspended' }).eq('id', m.facility_id);
          if (suspendErr) console.error('[account/delete] facility suspend failed — manual cleanup required', { facilityId: m.facility_id, err: suspendErr });
        }
      }
    }

    const { error: memberDeleteErr } = await adminSupabase.from('facility_members').delete().eq('user_id', user.id);
    if (memberDeleteErr) {
      console.error('[account/delete] facility_members deletion failed — manual cleanup required', { userId: user.id, err: memberDeleteErr });
      // facility_members が残ったまま auth.users を消すと、孤立メンバーシップ（FK RESTRICT なら
      // 後続の auth 削除自体が失敗）になる。auth 削除前に中断して再実行可能化する（冪等・発症前予防）。
      alertCaughtError(
        'account-delete-members',
        new Error(`facility_members deletion failed: ${memberDeleteErr.message}`),
        '/api/account/delete',
      );
      return NextResponse.json(
        { error: 'アカウント削除に失敗しました。時間をおいて再度お試しください。' },
        { status: 500 },
      );
    }

    // auth.usersから削除
    const { error: authDeleteErr } = await adminSupabase.auth.admin.deleteUser(user.id);
    if (authDeleteErr) {
      console.error('[account/delete] auth.users deletion failed', { userId: user.id, err: authDeleteErr });
      // why: この中断はここまでの3経路の中で最も深刻。PII（profiles等）と facility_members は
      // 既に全て削除済みで auth.users だけが残るため、「ログインはできるが profiles が無い
      // 半分消えたアカウント」になる。Cookie 失効処理は成功パス（この下）にしか無いためセッションも
      // 生きたまま残る。人による即時対応が必要な状態なので必ず Slack へ通知する。
      alertCaughtError(
        'account-delete-auth',
        new Error(
          `auth.users deletion failed after PII already deleted (profiles/facility_members removed, ` +
            `auth.users orphaned): ${errorMessage(authDeleteErr)}`,
        ),
        '/api/account/delete',
      );
      return NextResponse.json({ error: 'アカウント削除に失敗しました' }, { status: 500 });
    }

    const { ua } = getRequestContext(request);
    void writeAuditLog({
      userId: user.id,
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
    for (const c of cookieStore.getAll()) {
      if (c.name.startsWith('sb-') && c.name.includes('auth-token')) {
        res.cookies.set(c.name, '', { maxAge: 0, path: '/' });
      }
    }
    return res;
  } catch (e) {
    console.error('[account/delete] Error:', e);
    // catch して 500 を返すと instrumentation.ts の onRequestError に伝播せず Slack 通知が漏れるため明示通知。
    alertCaughtError('account-delete', e, '/api/account/delete');
    return NextResponse.json({ error: 'アカウント削除に失敗しました' }, { status: 500 });
  }
}
