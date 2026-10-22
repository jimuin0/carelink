import { createServiceRoleClient } from './supabase-server';
import { sendNewQuestionNotification } from './email';
import { safeCaptureException } from './safe';
import { alertCaughtError } from './alert';
import { databaseDiagnostic } from './database-diagnostic';

const ROUTE = '/api/facility/qa';

function report(tag: string, error: unknown): void {
  safeCaptureException(error, tag);
  alertCaughtError(tag, error, ROUTE);
}

/**
 * 施設 Q&A の新着質問を、その店舗の owner / admin 全員へメールで知らせる（2026年10月22日）。
 *
 * 以前は質問がブラウザから保存されるだけで、店舗には何も届かなかった（来院者には
 * 「施設からの回答をお待ちください」と表示したまま、店舗が /admin/qa を自分で開くまで放置）。
 * 口コミ（sendNewReviewNotification）・問い合わせ（sendNewInquiryNotification）と同じく、
 * owner に加えて admin にも送る（push.ts の sendPushToFacilityOwners と対象を揃える）。
 *
 * 応答後（runAfterResponse）に呼ぶ前提。質問はもう保存済みなので、ここでの失敗は
 * 本体の応答に影響させず、ただし無音にもしない（Sentry ＋ Slack）。宛先が 1 件も無い
 * 場合も知らせる（誰も回答できない質問が残るため、運営が気づける必要がある）。
 * この関数は例外を投げない（runAfterResponse は task の失敗を報告しないため）。
 */
export async function notifyFacilityOfNewQuestion(input: {
  facilityId: string;
  facilityName: string;
  question: string;
}): Promise<void> {
  try {
    const db = createServiceRoleClient();
    const { data: members, error: memberError } = await db
      .from('facility_members')
      .select('user_id')
      .eq('facility_id', input.facilityId)
      .in('role', ['owner', 'admin']);
    if (memberError || !members) {
      report('facility-qa-notify-members', memberError ? databaseDiagnostic(memberError) : new Error('facility_members returned no rows'));
      return;
    }
    const userIds = Array.from(new Set(members.map((m) => m.user_id).filter(Boolean)));
    let emails: string[] = [];
    if (userIds.length > 0) {
      const { data: profiles, error: profileError } = await db.from('profiles').select('email').in('id', userIds);
      if (profileError || !profiles) {
        report('facility-qa-notify-profiles', profileError ? databaseDiagnostic(profileError) : new Error('profiles returned no rows'));
        return;
      }
      emails = Array.from(new Set(profiles.map((p) => p.email).filter((e): e is string => Boolean(e))));
    }
    if (emails.length === 0) {
      report('facility-qa-notify-no-recipient', new Error('FACILITY_QA_NO_RECIPIENT'));
      return;
    }
    await Promise.allSettled(emails.map((facilityEmail) =>
      sendNewQuestionNotification({
        facilityEmail,
        facilityName: input.facilityName,
        question: input.question,
        facilityId: input.facilityId,
      }).then((ok) => {
        if (!ok) report('facility-qa-notify-email', new Error('question notification email send failed'));
      }, (e: unknown) => report('facility-qa-notify-email', e)),
    ));
  } catch (e) {
    report('facility-qa-notify', e);
  }
}
