import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { alertWarning } from '@/lib/alert';
import {
  computeDrift,
  computeConstraintDrift,
  type SchemaRow,
  type ConstraintRow,
} from '@/lib/schema-drift';
import snapshot from '@/lib/schema-snapshot.json';
import constraintsSnapshot from '@/lib/schema-constraints-snapshot.json';

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

  // RPC get_public_columns は jsonb 配列(1行)を返す。PostgREST 行数上限の影響を受けないよう
  // SETOF ではなく jsonb_agg で集約しているため data は [{table_name, column_name}] 配列そのもの。
  const rows = (Array.isArray(data) ? data : []) as SchemaRow[];
  const expected = snapshot as Record<string, string[]>;
  const { contaminated, missing, colDrift } = computeDrift(expected, rows);

  // 制約レベル（PK/UNIQUE）ドリフト。RPC get_public_constraints が未適用の環境では
  // graceful に skip し cron 本体を壊さない（本番 RPC 適用後に追加監視が自動で有効化）。
  let constraintExtra: string[] = [];
  let constraintMissing: string[] = [];
  let constraintCheckSkipped = false;
  const { data: cData, error: cError } = await admin.rpc('get_public_constraints');
  if (cError) {
    // 制約(PK/UNIQUE)ドリフト監視そのものが機能停止する障害。従来は meta フラグに
    // 残すのみで無音だったため、RPC が恒久的に壊れても誰も気づけず監視が永久に
    // 無効化されたまま cron_logs は 'success' で緑を保ち続けていた。恒久検知として
    // Slack へ警報する（列レベルのドリフト監視 computeDrift は RPC 非依存で継続する）。
    constraintCheckSkipped = true;
    alertWarning(
      'schema-drift-check: get_public_constraints RPC 失敗（制約ドリフト監視が無効化）',
      { route: '/api/cron/schema-drift-check', extra: { errorMessage: cError.message } },
    );
  } else {
    const cRows = (Array.isArray(cData) ? cData : []) as ConstraintRow[];
    const cd = computeConstraintDrift(constraintsSnapshot as ConstraintRow[], cRows);
    constraintExtra = cd.extra;
    constraintMissing = cd.missing;
  }

  const driftCount =
    contaminated.length +
    missing.length +
    colDrift.length +
    constraintExtra.length +
    constraintMissing.length;
  if (driftCount > 0) {
    alertWarning(
      `スキーマドリフト検知: 混入${contaminated.length} / 欠落${missing.length} / 列差分${colDrift.length} / 制約追加${constraintExtra.length} / 制約欠落${constraintMissing.length}`,
      {
        route: '/api/cron/schema-drift-check',
        extra: { contaminated, missing, colDrift, constraintExtra, constraintMissing },
      },
    );
  }

  await logCronRun('schema-drift-check', 'success', startedAt, {
    processed: driftCount,
    meta: { contaminated, missing, colDrift, constraintExtra, constraintMissing, constraintCheckSkipped },
  });
  return NextResponse.json({
    ok: true,
    driftCount,
    contaminated,
    missing,
    colDrift,
    constraintExtra,
    constraintMissing,
    constraintCheckSkipped,
  });
}
