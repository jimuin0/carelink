import { logCronRun } from '@/lib/cron-logger';
/**
 * お気に入り施設ダイジェスト Cron（v8.25）
 * GET /api/cron/favorites-digest
 * 毎週月曜 9:00 JST: お気に入り施設の新着情報をメール通知（週1回のみ）
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendFavoritesDigest, generateUnsubscribeToken } from '@/lib/email';
import { checkCronAuth } from '@/lib/cron-auth';
import { fetchAllPaged } from '@/lib/paginate';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Returns the ISO week string "YYYY-WNN" for a given date. */
function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  let sent = 0;
  let skipped = 0;
  const startedAt = new Date();
  const thisWeek = isoWeek(startedAt);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    // お気に入りを持つユーザー一覧を全件ページング取得（旧 .limit(500) は500行超で一部ユーザーの
    // ダイジェストが恒常的に欠落していた・本番監査）。
    const { rows: favUsers } = await fetchAllPaged<{ user_id: string; facility_id: string }>(
      async (offset, limit) => {
        const { data, error } = await supabase
          .from('favorites')
          .select('user_id, facility_id')
          .range(offset, offset + limit - 1);
        return { data: data as { user_id: string; facility_id: string }[] | null, error };
      },
    );

    if (favUsers.length === 0) {
      await logCronRun('favorites-digest', 'skipped', startedAt, { processed: 0 });
      return NextResponse.json({ success: true, sent: 0 });
    }

    // ユーザーごとにお気に入り施設をグループ化
    const userFacilityMap = new Map<string, string[]>();
    for (const f of favUsers) {
      if (!userFacilityMap.has(f.user_id)) userFacilityMap.set(f.user_id, []);
      userFacilityMap.get(f.user_id)!.push(f.facility_id);
    }

    const allFacilityIds = Array.from(new Set(favUsers.map((f) => f.facility_id)));

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
    const userIds = Array.from(userFacilityMap.keys());
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, email_unsubscribed, favorites_digest_sent_week')
      .in('id', userIds);

    const { data: authUsers } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const emailMap = new Map((authUsers?.users || []).map((u) => [u.id, u.email]));

    for (const profile of profiles || []) {
      if (profile.email_unsubscribed) { skipped++; continue; }
      // Skip if already sent this week (idempotency for double-fire)
      if (profile.favorites_digest_sent_week === thisWeek) { skipped++; continue; }

      const email = emailMap.get(profile.id);
      if (!email) { skipped++; continue; }

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

      if (updatedFacilities.length === 0) { skipped++; continue; }

      // Claim this week's slot before sending (CAS guard)
      const { data: claimed } = await supabase
        .from('profiles')
        .update({ favorites_digest_sent_week: thisWeek })
        .eq('id', profile.id)
        .neq('favorites_digest_sent_week', thisWeek)
        .select('id');

      if (!claimed || claimed.length === 0) { skipped++; continue; } // Another invocation claimed it

      // 配信停止トークン生成・保存
      const token = generateUnsubscribeToken();
      const { error: tokenErr } = await supabase.from('email_unsubscribe_tokens').insert({
        token,
        user_id: profile.id,
      });
      if (tokenErr) console.error('[favorites-digest] unsubscribe token insert failed', { userId: profile.id, err: tokenErr });

      await sendFavoritesDigest({
        userEmail: email,
        userName: profile.display_name,
        facilities: updatedFacilities,
        unsubscribeToken: token,
      }).catch((err) => console.error('[favorites-digest] email send failed', { userId: profile.id, err }));

      sent++;
    }

    await logCronRun('favorites-digest', 'success', startedAt, { processed: sent, skipped });
    return NextResponse.json({ processed: sent, skipped });
  } catch (e) {
    console.error('favorites-digest error', e);
    await logCronRun('favorites-digest', 'error', startedAt, { error_msg: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'error', sent }, { status: 500 });
  }
}
