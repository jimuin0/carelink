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

export const dynamic = 'force-dynamic';

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

    // 関連データ削除（CASCADE設定されていないテーブル + SET NULL で残存するPIIテーブル）
    const deleteResults = await Promise.allSettled([
      // CASCADE なし → 明示削除必須
      adminSupabase.from('line_user_links').delete().eq('user_id', user.id),
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
      // profiles は最後に削除
      adminSupabase.from('profiles').delete().eq('id', user.id),
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
    }

    // 施設オーナーの場合、施設も削除
    const { data: memberships } = await adminSupabase
      .from('facility_members')
      .select('facility_id, role')
      .eq('user_id', user.id)
      .eq('role', 'owner');

    if (memberships) {
      for (const m of memberships) {
        // 他にオーナーがいない場合のみ施設削除
        const { count } = await adminSupabase
          .from('facility_members')
          .select('id', { count: 'exact', head: true })
          .eq('facility_id', m.facility_id)
          .eq('role', 'owner')
          .neq('user_id', user.id);

        if ((count ?? 0) === 0) {
          const { error: suspendErr } = await adminSupabase.from('facility_profiles').update({ status: 'suspended' }).eq('id', m.facility_id);
          if (suspendErr) console.error('[account/delete] facility suspend failed — manual cleanup required', { facilityId: m.facility_id, err: suspendErr });
        }
      }
    }

    const { error: memberDeleteErr } = await adminSupabase.from('facility_members').delete().eq('user_id', user.id);
    if (memberDeleteErr) {
      console.error('[account/delete] facility_members deletion failed — manual cleanup required', { userId: user.id, err: memberDeleteErr });
    }

    // auth.usersから削除
    const { error: authDeleteErr } = await adminSupabase.auth.admin.deleteUser(user.id);
    if (authDeleteErr) {
      console.error('[account/delete] auth.users deletion failed', { userId: user.id, err: authDeleteErr });
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

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[account/delete] Error:', e);
    return NextResponse.json({ error: 'アカウント削除に失敗しました' }, { status: 500 });
  }
}
