/**
 * 退会SagaのAuth削除再試行 Cron。
 * DB内のPII scrub後に auth.admin.deleteUser だけ失敗した job を回収する。
 */
import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { cronError, logCronRun } from '@/lib/cron-logger';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { errorMessage } from '@/lib/err';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SELF = 'account-deletion-retry';

export async function GET(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();

  try {
    const supabase = createServiceRoleClient();
    const { data: jobs, error: fetchError } = await supabase
      .from('account_deletion_jobs')
      .select('user_id')
      .in('status', ['retryable', 'awaiting_auth_delete'])
      .order('updated_at', { ascending: true })
      .limit(50);
    if (fetchError) return cronError(SELF, startedAt, fetchError, { message: 'Internal Server Error' });

    let processed = 0;
    let skipped = 0;
    for (const job of jobs ?? []) {
      const { error: deleteError } = await supabase.auth.admin.deleteUser(job.user_id);
      const alreadyGone = deleteError && /404|not found|does not exist/i.test(errorMessage(deleteError));
      if (deleteError && !alreadyGone) {
        skipped++;
        const { error: stateError } = await supabase.from('account_deletion_jobs').update({
          status: 'awaiting_auth_delete',
          last_error: errorMessage(deleteError),
          updated_at: new Date().toISOString(),
        }).eq('user_id', job.user_id);
        if (stateError) console.error('[account-deletion-retry] state update failed', { userId: job.user_id, err: stateError });
        continue;
      }

      const { error: completeError } = await supabase.from('account_deletion_jobs').update({
        status: 'completed',
        last_error: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('user_id', job.user_id);
      if (completeError) {
        skipped++;
        console.error('[account-deletion-retry] completed state update failed', { userId: job.user_id, err: completeError });
      } else {
        processed++;
      }
    }

    await logCronRun(SELF, 'success', startedAt, { processed, skipped });
    return NextResponse.json({ processed, skipped });
  } catch (error) {
    return cronError(SELF, startedAt, error);
  }
}
