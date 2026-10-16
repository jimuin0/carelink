/**
 * DBバックアップ管理 API（v8.39）
 * GET /api/admin/backup - バックアップ状態確認
 * POST /api/admin/backup - 手動エクスポート（CSV）
 *
 * Supabase Pro では自動日次バックアップが有効
 * ここでは重要テーブルの行数チェック + CSVエクスポートを提供
 */

import { createServiceRoleClient } from '@/lib/supabase-server';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { NextRequest, NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { serverError } from '@/lib/with-route';
import { assertExportPageCursor, createBackupExportStream } from '@/lib/backup-export';

/** 1つのCSV値を安全にエスケープする（CSVインジェクション対策込み）。 */
function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  const safe = /^(?:[\s\uFEFF]*[=+\-@|＝＋－＠]|[\t\r\n])/.test(str) ? `'${str}` : str;
  return safe.includes(',') || safe.includes('\n') || safe.includes('\r') || safe.includes(';') || safe.includes('"')
    ? `"${safe.replace(/"/g, '""')}"`
    : safe;
}

function csvRow(headers: string[], row: Record<string, unknown>): string {
  return headers.map((h) => csvEscape(row[h])).join(',');
}

export const dynamic = 'force-dynamic';

// <Database> 配線により supabase.from(table) は table が具体的なテーブル名リテラル型
// でないと解決できない（string のままだと存在しないテーブル名も型上通ってしまい、
// この配線が本来防ぎたい「無言で死ぬ」事故そのものになる）。行数確認対象は下記8種の
// 固定リストのみで、いずれも schema-snapshot.json に実在を確認済み。
type CountedTable =
  | 'facility_profiles'
  | 'bookings'
  | 'profiles'
  | 'facility_reviews'
  | 'facility_menus'
  | 'facility_photos'
  | 'coupons'
  | 'user_points';

/** テーブルの行数を取得 */
async function getTableCount(
  supabase: ReturnType<typeof createServiceRoleClient>,
  table: CountedTable
): Promise<{ count: number | null; ok: boolean }> {
  try {
    const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true });
    const valid = typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
    return error || !valid ? { count: null, ok: false } : { count, ok: true };
  } catch {
    return { count: null, ok: false };
  }
}

// CSVエクスポート対象は4テーブルのみ（従来の allowedTables と同一の対象・同一の判定結果）。
// value is ExportableTable の型ガードにすることで、呼び出し側の table を as で偽装せずに
// 具体的なリテラル型へ narrow できる。
type ExportableTable = 'facility_profiles' | 'bookings' | 'profiles' | 'facility_reviews';

function isExportableTable(value: unknown): value is ExportableTable {
  return (
    value === 'facility_profiles' ||
    value === 'bookings' ||
    value === 'profiles' ||
    value === 'facility_reviews'
  );
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 10, 60_000, 'backup-get')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  // 管理者権限チェック
  const user = await requirePlatformAdmin();
  if (user instanceof NextResponse) return user;
  if (!user) return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });

  const serviceSupabase = createServiceRoleClient();

  // 主要テーブルの行数確認（CountedTable と要素を一致させる。型で存在確認済み）
  const tables: CountedTable[] = [
    'facility_profiles', 'bookings', 'profiles',
    'facility_reviews', 'facility_menus', 'facility_photos',
    'coupons', 'user_points',
  ];

  const countResults = await Promise.all(tables.map(async (table) => ({
    table,
    result: await getTableCount(serviceSupabase, table),
  })));
  const counts: Record<string, number | null> = Object.fromEntries(
    countResults.map(({ table, result }) => [table, result.count])
  );
  const failedTables = countResults.filter(({ result }) => !result.ok).map(({ table }) => table);

  return NextResponse.json({
    status: failedTables.length > 0 ? 'degraded' : 'ok',
    supabase_project: process.env.NEXT_PUBLIC_SUPABASE_URL?.split('.')[0]?.replace('https://', '') ?? 'unknown',
    checked_at: new Date().toISOString(),
    table_counts: counts,
    failed_tables: failedTables,
    note: 'Supabase Pro では自動日次バックアップが有効です。Point-in-time recovery は Supabase Dashboard → Settings → Backups から確認できます。',
  });
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 3, 60_000 * 10, 'backup-export')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  // 管理者権限チェック
  const user = await requirePlatformAdmin();
  if (user instanceof NextResponse) return user;
  if (!user) return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });

  const body: unknown = await request.json().catch(() => null);
  const table = body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>).table
    : undefined;

  // <Database> 配線後は .from(table) が table の型からテーブル名を解決する。
  // isExportableTable の型ガードで narrow すると、以降のスコープ（fetchPage クロージャ
  // 含む）で table が ExportableTable（4テーブルの具体的リテラル型）として扱われ、
  // as 等で黙らせずに tsc を通せる。判定内容（対象4テーブル）は変更前と同一。
  if (!isExportableTable(table)) {
    return NextResponse.json({ error: '対応していないテーブルです' }, { status: 400 });
  }

  const serviceSupabase = createServiceRoleClient();

  // First read precedes HTTP headers. Later pages follow consumer demand and
  // immutable IDs, avoiding offset shifts when earlier rows are deleted.
  // This operational CSV export is not a transaction-wide DB snapshot.
  const PAGE_SIZE = 1000;
  const MAX_ROWS = 1000000;
  const downloadAbort = new AbortController();
  const signal = AbortSignal.any([request.signal, downloadAbort.signal]);
  const fetchPage = async (afterId: string) => {
    let query = serviceSupabase
      .from(table)
      .select('*')
      .order('id', { ascending: true })
      .limit(PAGE_SIZE)
      .abortSignal(signal);
    if (afterId) query = query.gt('id', afterId);
    const { data, error } = await query;
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Invalid export query result');
    const rows = data as Record<string, unknown>[];
    assertExportPageCursor(rows, afterId);
    return rows;
  };

  let firstRows: Record<string, unknown>[];
  try {
    firstRows = await fetchPage('');
  } catch (error) {
    return serverError('admin-backup-export', error, '/api/admin/backup', 'データの取得に失敗しました');
  }
  if (firstRows.length === 0) {
    return NextResponse.json({ error: 'エクスポート対象のデータがありません' }, { status: 404 });
  }

  const headers = Object.keys(firstRows[0]);
  const encoder = new TextEncoder();

  const stream = createBackupExportStream({
    firstPage: firstRows,
    maxRows: MAX_ROWS,
    readNext: fetchPage,
    encodePage: (rows, first) => encoder.encode(
      (first ? headers.join(',') + '\n' : '') + rows.map(row => csvRow(headers, row) + '\n').join('')
    ),
    onCancel: () => downloadAbort.abort(),
    onComplete(totalRows) {
      const { ip: auditIp, ua } = getRequestContext(request);
      void writeAuditLog({
        userId: user.id,
        action: 'export',
        tableName: table,
        newValues: { row_count: totalRows },
        ipAddress: auditIp,
        userAgent: ua,
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${table}_${new Date().toISOString().split('T')[0]}.csv"`,
    },
  });
}
