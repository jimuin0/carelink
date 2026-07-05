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

/** 1つのCSV値を安全にエスケープする（CSVインジェクション対策込み）。 */
function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  const safe = /^[=+\-@|]/.test(str) ? `'${str}` : str;
  return safe.includes(',') || safe.includes('\n') || safe.includes('"')
    ? `"${safe.replace(/"/g, '""')}"`
    : safe;
}

function csvRow(headers: string[], row: Record<string, unknown>): string {
  return headers.map((h) => csvEscape(row[h])).join(',');
}

export const dynamic = 'force-dynamic';

/** テーブルの行数を取得 */
async function getTableCount(supabase: ReturnType<typeof createServiceRoleClient>, table: string): Promise<number> {
  const { count } = await supabase.from(table).select('id', { count: 'exact', head: true });
  return count ?? 0;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 10, 60_000, 'backup-get')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  // 管理者権限チェック
  const user = await requirePlatformAdmin();
  if (!user) return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });

  const serviceSupabase = createServiceRoleClient();

  // 主要テーブルの行数確認
  const tables = [
    'facility_profiles', 'bookings', 'profiles',
    'facility_reviews', 'facility_menus', 'facility_photos',
    'coupons', 'user_points',
  ];

  const counts: Record<string, number> = {};
  await Promise.all(tables.map(async (t) => {
    counts[t] = await getTableCount(serviceSupabase, t);
  }));

  return NextResponse.json({
    status: 'ok',
    supabase_project: process.env.NEXT_PUBLIC_SUPABASE_URL?.split('.')[0]?.replace('https://', '') ?? 'unknown',
    checked_at: new Date().toISOString(),
    table_counts: counts,
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
  if (!user) return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const table = body.table as string;

  const allowedTables = ['facility_profiles', 'bookings', 'profiles', 'facility_reviews'];
  if (!allowedTables.includes(table)) {
    return NextResponse.json({ error: '対応していないテーブルです' }, { status: 400 });
  }

  const serviceSupabase = createServiceRoleClient();

  // 監査P9: 従来は fetchAllPaged で全件（最大100万行）を一度に JS 配列へ蓄積してから
  // CSV文字列化していた（大テーブルでメモリ全展開＝OOMリスク）。ReadableStream で
  // ページ(1000件)ごとに読み取り即flushし、常時メモリに載るのは1ページ分のみにする。
  //
  // ただし「データ0件→404」「取得失敗→500」の判定はレスポンス開始（ヘッダ確定）前に
  // 行う必要がある（ストリーム開始後はHTTPステータスを変更できない）。そのため最初の
  // ページだけ先に取得して判定し、ヘッダー確定後にストリームへ引き継いで残りを読む。
  const PAGE_SIZE = 1000;
  const MAX_ROWS = 1000000;

  const fetchPage = (offset: number) =>
    serviceSupabase
      .from(table)
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

  const first = await fetchPage(0);
  if (first.error) {
    console.error('[backup] export query failed', { table, err: first.error });
    return NextResponse.json({ error: 'データの取得に失敗しました' }, { status: 500 });
  }
  const firstRows = (first.data ?? []) as Record<string, unknown>[];
  if (firstRows.length === 0) {
    return NextResponse.json({ error: 'エクスポート対象のデータがありません' }, { status: 404 });
  }

  const headers = Object.keys(firstRows[0]);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let totalRows = 0;
      try {
        controller.enqueue(encoder.encode(headers.join(',') + '\n'));
        let page = firstRows;
        let offset = 0;
        for (;;) {
          for (const row of page) controller.enqueue(encoder.encode(csvRow(headers, row) + '\n'));
          totalRows += page.length;
          const isLastPage = page.length < PAGE_SIZE || totalRows >= MAX_ROWS;
          if (isLastPage) break;
          offset += PAGE_SIZE;
          const next = await fetchPage(offset);
          if (next.error) {
            console.error('[backup] export streaming query failed (partial export)', { table, offset, err: next.error });
            break;
          }
          page = (next.data ?? []) as Record<string, unknown>[];
          if (page.length === 0) break;
        }

        const { ip: auditIp, ua } = getRequestContext(request);
        void writeAuditLog({
          userId: user.id,
          action: 'export',
          tableName: table,
          newValues: { row_count: totalRows },
          ipAddress: auditIp,
          userAgent: ua,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${table}_${new Date().toISOString().split('T')[0]}.csv"`,
    },
  });
}
