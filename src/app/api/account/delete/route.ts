import { mutationRateLimit, checkRateLimit } from "@/lib/rate-limit";
/**
 * アカウント削除 API（v8.5）
 * POST /api/account/delete
 * ユーザーの全データを削除（個人情報保護法対応）
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
    if (await checkRateLimit(mutationRateLimit, ip, 5, 60_000, "mutation")) {
      return NextResponse.json({ error: "リクエストが多すぎます" }, { status: 429 });
    }
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const { confirmation } = await request.json();
    if (confirmation !== 'DELETE') {
      return NextResponse.json({ error: '確認コードが正しくありません' }, { status: 400 });
    }

    const adminSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 関連データ削除（CASCADE設定されていないテーブル）
    await Promise.all([
      adminSupabase.from('line_user_links').delete().eq('user_id', user.id),
      adminSupabase.from('favorites').delete().eq('user_id', user.id),
      adminSupabase.from('user_points').delete().eq('user_id', user.id),
      adminSupabase.from('profiles').delete().eq('id', user.id),
    ]);

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
          await adminSupabase.from('facility_profiles').update({ status: 'suspended' }).eq('id', m.facility_id);
        }
      }
    }

    await adminSupabase.from('facility_members').delete().eq('user_id', user.id);

    // auth.usersから削除
    await adminSupabase.auth.admin.deleteUser(user.id);

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[account/delete] Error:', e);
    return NextResponse.json({ error: 'アカウント削除に失敗しました' }, { status: 500 });
  }
}
