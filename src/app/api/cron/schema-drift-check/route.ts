import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { alertWarning } from '@/lib/alert';
import { computeDrift, type SchemaRow } from '@/lib/schema-drift';
import snapshot from '@/lib/schema-snapshot.json';

// 本番スキーマ(RPC get_public_columns)と期待スキーマ(schema-snapshot.json)を突合し、
// out-of-band な混入/欠落/列差分を発症前に Slack 通知する。読み取りのみ・副作用なし。
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const admin = createServiceRoleClient();
  const startedAt = new Date();

  const { data, error } = await admin.rpc('get_public_columns');
  if (error) {
    await logCronRun('schema-drift-check', 'error', startedAt, { error_msg: error.message });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  const expected = snapshot as Record<string, string[]>;
  const { contaminated, missing, colDrift } = computeDrift(
    expected,
    (data ?? []) as SchemaRow[],
  );

  const driftCount = contaminated.length + missing.length + colDrift.length;
  if (driftCount > 0) {
    alertWarning(
      `スキーマドリフト検知: 混入${contaminated.length} / 欠落${missing.length} / 列差分${colDrift.length}`,
      {
        route: '/api/cron/schema-drift-check',
        extra: { contaminated, missing, colDrift },
      },
    );
  }

  await logCronRun('schema-drift-check', 'success', startedAt, {
    processed: driftCount,
    meta: { contaminated, missing, colDrift },
  });
  return NextResponse.json({ ok: true, driftCount, contaminated, missing, colDrift });
}
