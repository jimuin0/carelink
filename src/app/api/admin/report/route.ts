/**
 * 売上レポートCSVエクスポート（v8.2）
 * GET /api/admin/report?facility_id=xxx&from=2026-01-01&to=2026-01-31
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 10, 60_000, 'admin-report')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get('facility_id');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!facilityId || !from || !to) {
    return NextResponse.json({ error: 'facility_id, from, to required' }, { status: 400 });
  }
  if (!UUID_REGEX.test(facilityId)) {
    return NextResponse.json({ error: 'Invalid facility_id' }, { status: 400 });
  }
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(from) || !dateRegex.test(to)) {
    return NextResponse.json({ error: 'from, to must be YYYY-MM-DD' }, { status: 400 });
  }
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }
  if (toDate < fromDate) {
    return NextResponse.json({ error: 'to must be >= from' }, { status: 400 });
  }
  const diffDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays > 366) {
    return NextResponse.json({ error: '期間は最大366日までです' }, { status: 400 });
  }

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Revenue data is restricted to owner/admin only
  const { data: member } = await supabase
    .from('facility_members')
    .select('role')
    .eq('facility_id', facilityId)
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin'])
    .maybeSingle();

  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createServiceRoleClient();
  const { data: rows, error: rowsError } = await admin
    .from('daily_revenue_summary')
    .select('*')
    .eq('facility_id', facilityId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true });

  // 取得失敗を「データなし(404)＝売上ゼロ」に偽装しない。DB 障害/権限/タイムアウトを
  // 500 で明示し、経営者が障害を「売上ゼロの月」と誤認してキャッシュフロー判断を誤るのを防ぐ
  // （admin ダッシュボードの「取得失敗を0に偽装しない」方針と統一）。
  if (rowsError) {
    return NextResponse.json({ error: 'レポートの取得に失敗しました' }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'No data' }, { status: 404 });
  }

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
