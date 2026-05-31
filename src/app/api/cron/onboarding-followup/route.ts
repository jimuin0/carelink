import { logCronRun } from '@/lib/cron-logger';
/**
 * オンボーディング3日後フォローメール Cron（v8.15）
 * GET /api/cron/onboarding-followup
 * 登録から3〜4日経ったが未完了の施設オーナーへリマインドメール（1施設1回のみ）
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendOnboardingFollowEmail } from '@/lib/email';
import { checkCronAuth } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  // 遅延初期化: モジュールスコープで createClient を呼ぶとビルド時の
  // page data 収集フェーズで env 未設定環境（Vercel preview 等）が
  // "supabaseUrl is required" で落ちるため、リクエスト時に生成する。
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const startedAt = new Date();
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
      .neq('status', 'published')       // 公開済みは対象外
      .is('onboarding_email_sent_at', null) // 未送信のみ
      .limit(100);

    if (!facilities || facilities.length === 0) {
      await logCronRun('onboarding-followup', 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ processed: 0, skipped: 0, status: 'ok', sent: 0 });
    }

    let sent = 0;
    let skipped = 0;
    for (const facility of facilities) {
      try {
        // Claim before sending (CAS guard via .is('onboarding_email_sent_at', null))
        const { data: claimed } = await supabase
          .from('facility_profiles')
          .update({ onboarding_email_sent_at: new Date().toISOString() })
          .eq('id', facility.id)
          .is('onboarding_email_sent_at', null)
          .select('id');

        if (!claimed || claimed.length === 0) { skipped++; continue; }

        // 未完了ステップを特定
        // staff_schedules has no facility_id column — query staff IDs first, then schedules
        const [
          { count: menuCount },
          { data: staffData },
          { count: photoCount },
          { data: member },
        ] = await Promise.all([
          supabase.from('facility_menus').select('id', { count: 'exact', head: true }).eq('facility_id', facility.id),
          supabase.from('staff_profiles').select('id').eq('facility_id', facility.id),
          supabase.from('facility_photos').select('id', { count: 'exact', head: true }).eq('facility_id', facility.id),
          supabase.from('facility_members').select('user_id').eq('facility_id', facility.id).eq('role', 'owner').maybeSingle(),
        ]);

        const staffIds = (staffData ?? []).map((s: { id: string }) => s.id);
        let scheduleCount = 0;
        if (staffIds.length > 0) {
          const { count } = await supabase
            .from('staff_schedules')
            .select('id', { count: 'exact', head: true })
            .in('staff_id', staffIds);
          scheduleCount = count ?? 0;
        }

        const missingSteps: string[] = [];
        if ((menuCount ?? 0) === 0) missingSteps.push('メニュー・料金の登録');
        if (staffIds.length === 0) missingSteps.push('スタッフの登録');
        if ((photoCount ?? 0) === 0) missingSteps.push('施設写真のアップロード');
        if (scheduleCount === 0) missingSteps.push('スケジュールの設定');
        missingSteps.push('施設を「公開」にする');

        if (!member) { skipped++; continue; }

        const { data: profile } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', member.user_id)
          .maybeSingle();

        if (!profile?.email) { skipped++; continue; }

        await sendOnboardingFollowEmail({
          ownerEmail: profile.email,
          facilityName: facility.name,
          missingSteps,
        });
        sent++;
      } catch (facilityErr) {
        console.error('[onboarding-followup] facility processing error', { facilityId: facility.id, err: facilityErr });
        skipped++;
      }
    }

    await logCronRun('onboarding-followup', 'success', startedAt, { processed: sent, skipped });
    return NextResponse.json({ processed: sent, skipped });
  } catch (e) {
    console.error('[onboarding-followup] Error:', e);
    await logCronRun('onboarding-followup', 'error', startedAt, { error_msg: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
