import { logCronRun } from '@/lib/cron-logger';
/**
 * オンボーディング3日後フォローメール Cron（v8.14）
 * GET /api/cron/onboarding-followup
 * 登録から3〜4日経ったが未完了の施設オーナーへリマインドメール
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendOnboardingFollowEmail } from '@/lib/email';

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

  try {
    const now = new Date();
    // 3〜4日前に作成された施設（日本時間考慮）
    const d4ago = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();
    const d3ago = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const { data: facilities } = await supabase
      .from('facility_profiles')
      .select('id, name, status')
      .gte('created_at', d4ago)
      .lte('created_at', d3ago)
      .neq('status', 'published'); // 公開済みは対象外

    if (!facilities || facilities.length === 0) {
      return NextResponse.json({ status: 'ok', sent: 0 });
    }

    let sent = 0;
    for (const facility of facilities) {
      // 未完了ステップを特定
      const [
        { count: menuCount },
        { count: staffCount },
        { count: photoCount },
        { count: scheduleCount },
      ] = await Promise.all([
        supabase.from('facility_menus').select('id', { count: 'exact', head: true }).eq('facility_id', facility.id),
        supabase.from('staff_profiles').select('id', { count: 'exact', head: true }).eq('facility_id', facility.id),
        supabase.from('facility_photos').select('id', { count: 'exact', head: true }).eq('facility_id', facility.id),
        supabase.from('staff_schedules').select('id', { count: 'exact', head: true }).eq('facility_id', facility.id),
      ]);

      const missingSteps: string[] = [];
      if ((menuCount ?? 0) === 0) missingSteps.push('メニュー・料金の登録');
      if ((staffCount ?? 0) === 0) missingSteps.push('スタッフの登録');
      if ((photoCount ?? 0) === 0) missingSteps.push('施設写真のアップロード');
      if ((scheduleCount ?? 0) === 0) missingSteps.push('スケジュールの設定');
      missingSteps.push('施設を「公開」にする');

      // オーナーのメールアドレスを取得
      const { data: member } = await supabase
        .from('facility_members')
        .select('user_id')
        .eq('facility_id', facility.id)
        .eq('role', 'owner')
        .maybeSingle();

      if (!member) continue;

      const { data: profile } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', member.user_id)
        .maybeSingle();

      if (!profile?.email) continue;

      await sendOnboardingFollowEmail({
        ownerEmail: profile.email,
        facilityName: facility.name,
        missingSteps,
      });
      sent++;
    }

    return NextResponse.json({ status: 'ok', sent });
  } catch (e) {
    console.error('[onboarding-followup] Error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
