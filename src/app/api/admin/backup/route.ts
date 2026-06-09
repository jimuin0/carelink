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
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { fetchAllPaged } from '@/lib/paginate';

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

  // 全件を CSV エクスポートする（バックアップは完全性が必須）。
  // 旧実装は .limit(10000) で、bookings/profiles 等が1万件を超えるとバックアップが
  // 黙って欠損していた。fetchAllPaged で created_at desc 順に全件ページング取得する。
  const { rows: data, error } = await fetchAllPaged<Record<string, unknown>>(
    async (offset, limit) => {
      const { data, error } = await serviceSupabase
        .from(table)
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      return { data: data as Record<string, unknown>[] | null, error };
    },
    { maxRows: 1000000 },
  );

  if (error) {
    console.error('[backup] export query failed', { table, err: error });
    return NextResponse.json({ error: 'データの取得に失敗しました' }, { status: 500 });
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
    },
  });
}
