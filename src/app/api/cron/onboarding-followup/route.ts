import { logCronRun } from '@/lib/cron-logger';
/**
 * オンボーディング3日後フォローメール Cron（v8.15）
 * GET /api/cron/onboarding-followup
 * 登録から3〜7日経ったが未完了の施設オーナーへリマインドメール（1施設1回のみ）
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendOnboardingFollowEmail } from '@/lib/email';
import { checkCronAuth } from '@/lib/cron-auth';
import { alertDeliveryFailures } from '@/lib/alert';
import { fetchAllPaged } from '@/lib/paginate';

export const dynamic = 'force-dynamic';
// 全プラン安全な明示値（Hobby 上限60s / Pro 上限300s のいずれでも有効）。
// 既定の低い値を上書きし、下の SEND_BUDGET_MS による予算ガードが確実に発火する既知の上限を与える。
export const maxDuration = 60;

// 登録からこの時間以上経過した施設のみ対象（登録直後の催促を避ける）。
const MIN_AGE_MS = 3 * 24 * 60 * 60 * 1000;
// 未送信のまま「retry 可能」として扱う上限（これを超えた古い登録には今さら送らない）。
// 旧実装は下限 4 日の固定窓だったため、1 日の窓内で .limit(100) を超えた分が翌日 4 日を過ぎて
// gte(d4ago) から外れ、永久に送られなかった（silent な恒久 miss）。下限を 7 日に広げ、
// 未送信(onboarding_email_sent_at IS NULL)のまま日次 run で繰り返し対象に乗せ恒久 miss を無くす。
const STALE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
// 1 回の run で「考慮」する最大行数（メモリ上限）。到達したら警告ログを出す（silent 根絶）。
const CONSIDER_LIMIT = 2000;
// 送信ループの実時間予算。maxDuration(60s) 未満に設定し、超えたら残りを翌 run へ回す。
const SEND_BUDGET_MS = 50 * 1000;

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
    // 3〜7日前に作成された施設（古い順 = staleness 期限が近いものから優先）
    const staleAfter = new Date(now.getTime() - STALE_LOOKBACK_MS).toISOString();
    const minAgeBefore = new Date(now.getTime() - MIN_AGE_MS).toISOString();

    // PostgREST の実 db-max-rows(1000) は .limit(2000) より小さく、常に1000件で
    // 打ち切られる（バックログが1000件を超える恒久取りこぼし）。review-request と同じ
    // fetchAllPaged でページングし、真に CONSIDER_LIMIT まで取得する。
    // 併せて主クエリの error を明示チェックする（旧実装は error を無視しており、一過性障害を
    // 「0件=skipped(成功)」に偽装しfollowupメールが全停止しても無音だった＝review-request H-2 と同型）。
    type FacilityRow = { id: string; name: string; status: string };
    const { rows: facilities, error: facilitiesErr } = await fetchAllPaged<FacilityRow>(
      async (offset, limit) => {
        const { data, error } = await supabase
          .from('facility_profiles')
          .select('id, name, status')
          .gte('created_at', staleAfter)
          .lte('created_at', minAgeBefore)
          .neq('status', 'published')       // 公開済みは対象外
          .is('onboarding_email_sent_at', null) // 未送信のみ
          .order('created_at', { ascending: true })
          .range(offset, offset + limit - 1);
        return { data: data as FacilityRow[] | null, error };
      },
      { maxRows: CONSIDER_LIMIT },
    );

    if (facilitiesErr) {
      const msg = facilitiesErr instanceof Error
        ? facilitiesErr.message
        : (facilitiesErr as { message?: string })?.message ?? String(facilitiesErr);
      console.error('[onboarding-followup] facilities query failed', { err: facilitiesErr });
      await logCronRun('onboarding-followup', 'error', startedAt, { error_msg: msg });
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }

    if (facilities.length === 0) {
      await logCronRun('onboarding-followup', 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ processed: 0, skipped: 0, status: 'ok', sent: 0 });
    }

    if (facilities.length === CONSIDER_LIMIT) {
      console.warn('[onboarding-followup] consider limit reached', { limit: CONSIDER_LIMIT });
    }

    const loopStart = Date.now();
    let sent = 0;
    let skipped = 0;
    let deferred = 0;
    let deliveryFailures = 0;

    for (let i = 0; i < facilities.length; i++) {
      const facility = facilities[i];

      // 実時間予算ガード: 残りは claim せず翌 run へ回す（onboarding_email_sent_at IS NULL のまま）。
      if (Date.now() - loopStart > SEND_BUDGET_MS) {
        deferred = facilities.length - i;
        console.warn('[onboarding-followup] time budget exceeded, deferring rest to next run', { deferred });
        break;
      }

      // Claim before sending (CAS guard via .is('onboarding_email_sent_at', null))
      const { data: claimed } = await supabase
        .from('facility_profiles')
        .update({ onboarding_email_sent_at: new Date().toISOString() })
        .eq('id', facility.id)
        .is('onboarding_email_sent_at', null)
        .select('id');

      if (!claimed || claimed.length === 0) { skipped++; continue; }

      // claim を先に立てる方式は二重送信を防ぐ一方、送信や前処理が一過性失敗すると
      // sent_at が立ったまま二度と再送されない（silent な恒久 miss）。
      // 「連絡先なし(noContact)」は再送しても無意味なので claim 維持、それ以外の失敗は claim を解放する。
      let delivered = false;
      let noContact = false;
      try {
        // 未完了ステップを特定
        // staff_schedules has no facility_id column — query staff IDs first, then schedules
        const [menusRes, staffRes, photosRes, memberRes] = await Promise.all([
          supabase.from('facility_menus').select('id', { count: 'exact', head: true }).eq('facility_id', facility.id),
          supabase.from('staff_profiles').select('id').eq('facility_id', facility.id),
          supabase.from('facility_photos').select('id', { count: 'exact', head: true }).eq('facility_id', facility.id),
          supabase.from('facility_members').select('user_id').eq('facility_id', facility.id).eq('role', 'owner').maybeSingle(),
        ]);

        // count 系クエリが error だと count=null → `(count ?? 0) === 0` が「未登録」と誤判定し、
        // 実際は登録済みなのに「メニュー未登録」等の誤内容の督促メールを送ってしまう（一度きり送信のため訂正不能）。
        // いずれかが error なら判定材料が欠けるため送信せず throw → 下の catch で delivered=false のまま claim を解放し、
        // 翌 run で正しい判定材料が取れてから再送する（誤内容の永続化を防ぐ発症前予防）。
        const stepQueryErr = menusRes.error || staffRes.error || photosRes.error || memberRes.error;
        if (stepQueryErr) {
          throw new Error(`missing-steps query failed: ${stepQueryErr.message}`);
        }

        const menuCount = menusRes.count;
        const photoCount = photosRes.count;
        const member = memberRes.data;
        const staffIds = (staffRes.data ?? []).map((s: { id: string }) => s.id);
        let scheduleCount = 0;
        if (staffIds.length > 0) {
          const { count, error: scheduleErr } = await supabase
            .from('staff_schedules')
            .select('id', { count: 'exact', head: true })
            .in('staff_id', staffIds);
          // 同上：error を 0 と誤判定して「スケジュール未設定」の誤内容を送らないよう throw で中止する。
          if (scheduleErr) {
            throw new Error(`staff_schedules count failed: ${scheduleErr.message}`);
          }
          scheduleCount = count ?? 0;
        }

        const missingSteps: string[] = [];
        if ((menuCount ?? 0) === 0) missingSteps.push('メニュー・料金の登録');
        if (staffIds.length === 0) missingSteps.push('スタッフの登録');
        if ((photoCount ?? 0) === 0) missingSteps.push('施設写真のアップロード');
        if (scheduleCount === 0) missingSteps.push('スケジュールの設定');
        missingSteps.push('施設を「公開」にする');

        if (!member) { noContact = true; }
        else {
          const { data: profile } = await supabase
            .from('profiles')
            .select('email')
            .eq('id', member.user_id)
            .maybeSingle();

          if (!profile?.email) { noContact = true; }
          else {
            // 実際の送達可否で delivered を決める。safeSend は throw せず false を返すため、
            // ここで true 固定にすると送信失敗時も claim 解放（再送）が発火しない恒久 miss になる。
            delivered = await sendOnboardingFollowEmail({
              ownerEmail: profile.email,
              facilityName: facility.name,
              missingSteps,
            });
            if (!delivered) deliveryFailures++;
          }
        }
      } catch (facilityErr) {
        console.error('[onboarding-followup] facility processing error', { facilityId: facility.id, err: facilityErr });
      }

      if (!delivered) {
        // 連絡先なし → claim 維持（再送無意味）。それ以外の失敗 → claim 解放して翌 run で再送。
        if (!noContact) {
          const { error: releaseErr } = await supabase
            .from('facility_profiles')
            .update({ onboarding_email_sent_at: null })
            .eq('id', facility.id);
          if (releaseErr) {
            console.error('[onboarding-followup] claim release failed', { facilityId: facility.id, err: releaseErr });
          }
        }
        skipped++;
        continue;
      }

      sent++;
    }

    alertDeliveryFailures('onboarding-followup', deliveryFailures, { sent, skipped });
    await logCronRun('onboarding-followup', 'success', startedAt, { processed: sent, skipped, meta: { deferred } });
    return NextResponse.json({ processed: sent, skipped, deferred });
  } catch (e) {
    console.error('[onboarding-followup] Error:', e);
    await logCronRun('onboarding-followup', 'error', startedAt, { error_msg: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
