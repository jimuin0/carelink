/**
 * 会計ソフト連携 CSV エクスポート API
 * GET /api/admin/accounting-export?facility_id=xxx&format=freee|mf&from=2026-01-01&to=2026-01-31
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';

function toJST(isoString: string) {
  const d = new Date(isoString);
  return d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
}

function csvEscape(val: string | number | null | undefined): string {
  const s = String(val ?? '');
  // Prefix formula-trigger characters to prevent CSV injection
  const safe = /^[=+\-@|]/.test(s) ? `'${s}` : s;
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function toCsvRow(cols: (string | number | null | undefined)[]): string {
  return cols.map(csvEscape).join(',');
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = request.nextUrl.searchParams.get('facility_id');
  const format = request.nextUrl.searchParams.get('format') ?? 'freee';
  const from = request.nextUrl.searchParams.get('from');
  const to = request.nextUrl.searchParams.get('to');

  if (!facilityId) return NextResponse.json({ error: 'facility_id required' }, { status: 400 });
  if (!UUID_REGEX.test(facilityId)) return NextResponse.json({ error: 'Invalid facility_id' }, { status: 400 });
  if (!['freee', 'mf', 'generic'].includes(format)) return NextResponse.json({ error: 'Invalid format' }, { status: 400 });
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (from && !dateRegex.test(from)) return NextResponse.json({ error: 'Invalid from date' }, { status: 400 });
  if (to && !dateRegex.test(to)) return NextResponse.json({ error: 'Invalid to date' }, { status: 400 });

  // Enforce maximum export range of 366 days to prevent DoS via huge queries
  if (from && to) {
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    if (isNaN(fromMs) || isNaN(toMs)) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    if (toMs < fromMs) return NextResponse.json({ error: 'to must be after from' }, { status: 400 });
    const diffDays = (toMs - fromMs) / (1000 * 60 * 60 * 24);
    if (diffDays > 366) return NextResponse.json({ error: 'エクスポート範囲は最大366日です' }, { status: 400 });
  }

  const { data: mem } = await supabase
    .from('facility_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    .single();
  if (!mem) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  let query = admin
    .from('bookings')
    .select('id, created_at, menu_name, total_amount, status, profiles(display_name, email)')
    .eq('facility_id', facilityId)
    .in('status', ['confirmed', 'completed'])
    .order('created_at');

  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to + 'T23:59:59Z');

  const { data: bookings, error } = await query.limit(5000);
  if (error) return NextResponse.json({ error: 'データの取得に失敗しました' }, { status: 500 });

  let csv = '';
  let filename = '';

  if (format === 'freee') {
    // freee 取引インポート形式
    filename = `carelink_freee_${from ?? 'all'}.csv`;
    const header = ['取引日', '収支区分', '管理番号', '取引先', '勘定科目', '税区分', '金額', '税計算区分', '消費税額', '備考'];
    csv = '\uFEFF' + header.join(',') + '\n';
    for (const b of bookings ?? []) {
      const customer = (Array.isArray(b.profiles) ? b.profiles[0] : b.profiles) as { display_name?: string } | null;
      const amount = b.total_amount ?? 0;
      const tax = Math.round(amount * 10 / 110);
      csv += toCsvRow([
        toJST(b.created_at),
        '収入',
        b.id.slice(0, 8),
        customer?.display_name ?? '',
        '売上高',
        '課税売上10%',
        amount - tax,
        '内税',
        tax,
        b.menu_name ?? '',
      ]) + '\n';
    }
  } else if (format === 'mf') {
    // MF クラウド会計 仕訳インポート形式
    filename = `carelink_mf_${from ?? 'all'}.csv`;
    const header = ['日付', '借方勘定科目', '借方補助科目', '借方税区分', '借方金額', '貸方勘定科目', '貸方補助科目', '貸方税区分', '貸方金額', '摘要'];
    csv = '\uFEFF' + header.join(',') + '\n';
    for (const b of bookings ?? []) {
      const customer = (Array.isArray(b.profiles) ? b.profiles[0] : b.profiles) as { display_name?: string } | null;
      const amount = b.total_amount ?? 0;
      csv += toCsvRow([
        toJST(b.created_at),
        '現金',
        '',
        '対象外',
        amount,
        '売上高',
        '',
        '課税売上10%',
        amount,
        `${b.menu_name ?? '施術'} ${customer?.display_name ?? ''}`,
      ]) + '\n';
    }
  } else {
    // 汎用CSV
    filename = `carelink_bookings_${from ?? 'all'}.csv`;
    const header = ['予約ID', '日付', '顧客名', 'メール', 'メニュー', '金額', 'ステータス'];
    csv = '\uFEFF' + header.join(',') + '\n';
    for (const b of bookings ?? []) {
      const customer = (Array.isArray(b.profiles) ? b.profiles[0] : b.profiles) as { display_name?: string; email?: string } | null;
      csv += toCsvRow([
        b.id,
        toJST(b.created_at),
        customer?.display_name ?? '',
        customer?.email ?? '',
        b.menu_name ?? '',
        b.total_amount ?? 0,
        b.status,
      ]) + '\n';
    }
  }

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
