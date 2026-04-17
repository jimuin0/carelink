import { logCronRun } from '@/lib/cron-logger';
/**
 * お気に入り施設ダイジェスト Cron（v8.24）
 * GET /api/cron/favorites-digest
 * 毎週月曜 9:00 JST: お気に入り施設の新着情報をメール通知
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendFavoritesDigest } from '@/lib/email';
import { generateUnsubscribeToken } from '@/lib/email';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let sent = 0;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 1週間前

  try {
    // お気に入りを持つユーザー一覧取得
    const { data: favUsers } = await supabase
      .from('favorites')
      .select('user_id, facility_id')
      .limit(500);

    if (!favUsers || favUsers.length === 0) {
      return NextResponse.json({ success: true, sent: 0 });
    }

    // ユーザーごとにお気に入り施設をグループ化
    const userFacilityMap = new Map<string, string[]>();
    for (const f of favUsers) {
      if (!userFacilityMap.has(f.user_id)) userFacilityMap.set(f.user_id, []);
      userFacilityMap.get(f.user_id)!.push(f.facility_id);
    }

    const allFacilityIds = [...new Set(favUsers.map((f) => f.facility_id))];

    // 各施設の新着情報（クーポン）を取得
    const { data: newCoupons } = await supabase
      .from('facility_coupons')
      .select('facility_id, id')
      .in('facility_id', allFacilityIds)
      .gte('created_at', since)
      .eq('is_active', true);

    const couponCountMap = new Map<string, number>();
    for (const c of newCoupons || []) {
      couponCountMap.set(c.facility_id, (couponCountMap.get(c.facility_id) || 0) + 1);
    }

    // 新メニュー追加された施設
    const { data: newMenus } = await supabase
      .from('facility_menus')
      .select('facility_id')
      .in('facility_id', allFacilityIds)
      .gte('created_at', since)
      .eq('is_active', true);

    const newMenuFacilities = new Set((newMenus || []).map((m) => m.facility_id));

    // 施設情報
    const { data: facilities } = await supabase
      .from('facility_profiles')
      .select('id, name, slug')
      .in('id', allFacilityIds);

    const facilityMap = new Map((facilities || []).map((f) => [f.id, f]));

    // ユーザー情報とメール送信
    const userIds = [...userFacilityMap.keys()];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, email_unsubscribed')
      .in('id', userIds);

    const { data: authUsers } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const emailMap = new Map((authUsers?.users || []).map((u) => [u.id, u.email]));

    for (const profile of profiles || []) {
      if (profile.email_unsubscribed) continue;
      const email = emailMap.get(profile.id);
      if (!email) continue;

      const facilityIds = userFacilityMap.get(profile.id) || [];

      // 新着がある施設のみ
      const updatedFacilities = facilityIds
        .filter((fid) => couponCountMap.has(fid) || newMenuFacilities.has(fid))
        .map((fid) => {
          const fac = facilityMap.get(fid);
          if (!fac) return null;
          return {
            name: fac.name,
            slug: fac.slug,
            newCoupons: couponCountMap.get(fid) || 0,
            hasNewMenus: newMenuFacilities.has(fid),
          };
        })
        .filter(Boolean) as { name: string; slug: string; newCoupons: number; hasNewMenus: boolean }[];

      if (updatedFacilities.length === 0) continue;

      // 配信停止トークン生成・保存
      const token = generateUnsubscribeToken();
      await supabase.from('email_unsubscribe_tokens').insert({
        token,
        user_id: profile.id,
      }).catch(() => {});

      await sendFavoritesDigest({
        userEmail: email,
        userName: profile.display_name,
        facilities: updatedFacilities,
        unsubscribeToken: token,
      }).catch(() => {});

      sent++;
    }

    return NextResponse.json({ success: true, sent });
  } catch (e) {
    console.error('favorites-digest error', e);
    return NextResponse.json({ error: 'error', sent }, { status: 500 });
  }
}
