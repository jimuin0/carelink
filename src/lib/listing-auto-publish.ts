import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { checkPublishReadiness } from './facility-publish-gate';

/**
 * 書類の承認による自動公開（2026-11-03 本人決定「揃っていれば自動で公開」）。
 *
 * 公開の規則（店舗名・所在地・キャッチコピーと紹介文の禁止表現・曜日ごとの営業時間）はアプリ側の
 * listingPublishMissing が持つ。以前は DB の中だけで公開していたため、禁止表現の検査を通らずに
 * 公開されていた。ここで同じ規則を通してから、DB の try_auto_publish_verified_facility に頼む
 * （DB は行をロックして、公開待ちの印・下書きであること・最後の条件・公開ゲートを確かめる）。
 *
 * 呼ぶのは、運営が書類を承認した直後と、店舗が設定を保存した直後だけ。どちらも失敗しても
 * 元の操作（承認・保存）は確定済みなので、結果を返すだけで例外は投げない。
 */
export type AutoPublishOutcome =
  | 'published' | 'already_published' | 'suspended' | 'not_pending' | 'not_ready' | 'blocked' | 'unavailable';

const dbOutcome = z.enum(['published', 'not_pending', 'not_draft', 'not_ready', 'blocked']);

export async function publishVerifiedFacilityIfReady(
  db: SupabaseClient, facilityId: string, actorId: string,
): Promise<AutoPublishOutcome> {
  try {
    const [facility, approval] = await Promise.all([
      db.from('facility_profiles').select('status').eq('id', facilityId).maybeSingle(),
      db.from('listing_verification_approvals').select('auto_publish_pending').eq('facility_id', facilityId).maybeSingle(),
    ]);
    if (facility.error || approval.error || !facility.data) return 'unavailable';
    if (facility.data.status === 'published') return 'already_published';
    if (facility.data.status === 'suspended') return 'suspended';
    if (approval.data?.auto_publish_pending !== true) return 'not_pending';
    const { readiness, error } = await checkPublishReadiness(db, facilityId);
    if (error) return 'unavailable';
    if (!readiness.ready) return 'not_ready';
    const result = await db.rpc('try_auto_publish_verified_facility', { p_facility_id: facilityId, p_actor: actorId });
    const outcome = dbOutcome.safeParse(result.data);
    if (result.error || !outcome.success) return 'unavailable';
    // 読んだ後に別の操作で公開・休止された場合（not_draft）は、結果を言い切らずに読み直してもらう。
    return outcome.data === 'not_draft' ? 'unavailable' : outcome.data;
  } catch {
    return 'unavailable';
  }
}
