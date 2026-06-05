/**
 * DBバックアップ管理 API（v8.39）
 * GET /api/admin/backup - バックアップ状態確認
 * POST /api/admin/backup - 手動エクスポート（CSV）
 *
 * Supabase Pro では自動日次バックアップが有効
 * ここでは重要テーブルの行数チェック + CSVエクスポートを提供
 */

import { createServiceRoleClient } from '@/lib/supabase-server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { NextRequest, NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { alertWarning } from '@/lib/alert';

async function requirePlatformAdmin() {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_platform_admin) return null;
  return user;
}

export const dynamic = 'force-dynamic';

/** テーブルの行数を取得 */
async function getTableCount(supabase: ReturnType<typeof createServiceRoleClient>, table: string): Promise<number> {
  const { count } = await supabase.from(table).select('id', { count: 'exact', head: true });
  return count ?? 0;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 10, 60_000, 'backup-get')) {
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
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 3, 60_000 * 10, 'backup-export')) {
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

  // バックアップは取りこぼし不可。PostgREST の db-max-rows(1000) を .range() で全件ページングする
  // （旧 .limit(10000) は10000件超で黙って欠落しており「不完全バックアップ」になっていた・round6）。安全上限20万行。
  const PAGE = 1000;
  const MAX_ROWS = 200000;
  const data: Record<string, unknown>[] = [];
  let truncated = false;
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data: page, error } = await serviceSupabase
      .from(table)
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error('[backup] export query failed', { table, err: error });
      return NextResponse.json({ error: 'データの取得に失敗しました' }, { status: 500 });
    }
    if (!page || page.length === 0) break;
    data.push(...(page as Record<string, unknown>[]));
    if (page.length < PAGE) break;            // 最終ページ＝全件取得完了
    if (offset + PAGE >= MAX_ROWS) { truncated = true; break; }  // 上限到達でまだ満杯＝切り捨て発生
  }
  if (truncated) {
    // サイレント切り捨ては「完全バックアップ」と誤認させる。能動警告＋応答ヘッダで明示する。
    alertWarning('backup export truncated at row cap', {
      route: '/api/admin/backup',
      extra: { table, maxRows: MAX_ROWS, exported: data.length },
    });
  }
  if (data.length === 0) {
    return NextResponse.json({ error: 'エクスポート対象のデータがありません' }, { status: 404 });
  }

  // JSONをCSVに変換
  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map((row) =>
      headers.map((h) => {
        const val = (row as Record<string, unknown>)[h];
        if (val === null || val === undefined) return '';
        const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        const safe = /^[=+\-@|]/.test(str) ? `'${str}` : str;
        return safe.includes(',') || safe.includes('\n') || safe.includes('"')
          ? `"${safe.replace(/"/g, '""')}"`
          : safe;
      }).join(',')
    ),
  ].join('\n');

  const { ip: auditIp, ua } = getRequestContext(request);
  void writeAuditLog({
    userId: user.id,
    action: 'export',
    tableName: table,
    newValues: { row_count: data.length },
    ipAddress: auditIp,
    userAgent: ua,
  });

  return new Response(csvRows, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${table}_${new Date().toISOString().split('T')[0]}.csv"`,
      'X-Backup-Row-Count': String(data.length),
      'X-Backup-Truncated': truncated ? 'true' : 'false',
    },
  });
}
