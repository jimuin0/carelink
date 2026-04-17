/**
 * DBバックアップ管理 API（v8.39）
 * GET /api/admin/backup - バックアップ状態確認
 * POST /api/admin/backup - 手動エクスポート（CSV）
 *
 * Supabase Pro では自動日次バックアップが有効
 * ここでは重要テーブルの行数チェック + CSVエクスポートを提供
 */

import { createServiceRoleClient } from '@/lib/supabase-server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** テーブルの行数を取得 */
async function getTableCount(supabase: ReturnType<typeof createServiceRoleClient>, table: string): Promise<number> {
  const { count } = await supabase.from(table).select('id', { count: 'exact', head: true });
  return count ?? 0;
}

export async function GET(request: Request) {
  // 管理者権限チェック
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });

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

export async function POST(request: Request) {
  // 管理者権限チェック
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const table = body.table as string;

  const allowedTables = ['facility_profiles', 'bookings', 'profiles', 'facility_reviews'];
  if (!allowedTables.includes(table)) {
    return NextResponse.json({ error: '対応していないテーブルです' }, { status: 400 });
  }

  const serviceSupabase = createServiceRoleClient();

  // 最大10,000件のCSVエクスポート
  const { data, error } = await serviceSupabase
    .from(table)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10000);

  if (error || !data || data.length === 0) {
    return NextResponse.json({ error: 'データの取得に失敗しました' }, { status: 500 });
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
        return str.includes(',') || str.includes('\n') || str.includes('"')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(',')
    ),
  ].join('\n');

  return new Response(csvRows, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${table}_${new Date().toISOString().split('T')[0]}.csv"`,
    },
  });
}
