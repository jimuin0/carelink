/**
 * 売上レポートCSVエクスポート（v8.1）
 * GET /api/admin/report?facility_id=xxx&from=2026-01-01&to=2026-01-31
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get('facility_id');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!facilityId || !from || !to) {
    return NextResponse.json({ error: 'facility_id, from, to required' }, { status: 400 });
  }

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  // 認証+権限チェック
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: member } = await supabase
    .from('facility_members')
    .select('role')
    .eq('facility_id', facilityId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // データ取得
  const { data: rows } = await supabase
    .from('daily_revenue_summary')
    .select('*')
    .eq('facility_id', facilityId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true });

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'No data' }, { status: 404 });
  }

  // CSV生成
  const headers = ['日付', '売上', '予約数', '完了', 'キャンセル', '無断キャンセル', '新規', 'リピート'];
  const csvRows = rows.map(r =>
    [r.date, r.total_revenue, r.booking_count, r.completed_count, r.cancelled_count, r.no_show_count, r.new_customer_count, r.repeat_customer_count].join(',')
  );
  const csv = '\uFEFF' + [headers.join(','), ...csvRows].join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="report_${from}_${to}.csv"`,
    },
  });
}
