/**
 * 会計ソフト連携 CSV エクスポート API
 * GET /api/admin/accounting-export?facility_id=xxx&format=freee|mf&from=2026-01-01&to=2026-01-31
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { checkRateLimit } from '@/lib/rate-limit';
import { csvEscape } from '@/lib/csv';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { fetchAllPaged } from '@/lib/paginate';

function toCsvRow(cols: (string | number | null | undefined)[]): string {
  return cols.map(csvEscape).join(',');
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 10, 60_000, 'accounting-export')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
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

  // 全件をエクスポートする（会計データは完全性が必須）。
  // 旧実装は .limit(5000) で、対象期間の確定/完了予約が5000件を超えると会計データが
  // 黙って欠損していた。fetchAllPaged で created_at 順に全件ページング取得する。
  // bookings に menu_name 列は無く menu_id 経由で取得（embed）。total_amount 列も無いため
  // 実列 total_price をエイリアスで total_amount として取得し、menu_name は取得後に平坦化する。
  type BookingRow = {
    id: string; booking_date: string;
    user_id: string | null;
    menu: { name: string } | { name: string }[] | null;
    menu_ids: string[] | null;
    total_amount: number | null;
    status: string;
    profiles: { display_name?: string; email?: string } | { display_name?: string; email?: string }[] | null;
  };
  const { rows: bookings, error } = await fetchAllPaged<BookingRow>(
    async (offset, limit) => {
      // 計上日は来店日(booking_date)基準・対象は completed のみ（ダッシュボード売上＝
      // aggregate_daily_revenue の booking_date∧completed と一致させる）。旧実装は created_at
      // (予約申込日)基準かつ confirmed(未来店)を含み、月跨ぎ予約の計上月ズレ・未実現売上の過大計上に
      // なっていた（8体監査 A3）。
      let q = admin
        .from('bookings')
        .select('id, booking_date, user_id, menu:facility_menus(name), menu_ids, total_amount:total_price, status')
        .eq('facility_id', facilityId)
        .eq('status', 'completed')
        .order('booking_date');
      if (from) q = q.gte('booking_date', from);
      if (to) q = q.lte('booking_date', to);
      const { data, error } = await q.range(offset, offset + limit - 1);
      return { data: data as BookingRow[] | null, error };
    },
    { maxRows: 1000000 },
  );
  if (error) return NextResponse.json({ error: 'データの取得に失敗しました' }, { status: 500 });

  // 複数メニュー予約は menu_ids 列に全メニューが入る（menu_id は先頭1件のみ＝embed した menu も
  // 先頭名のみ）。会計CSVのメニュー名を全件にするため、menu_ids の全IDの名前をまとめて1クエリで
  // 取得して名前解決する（8体監査 A6 の追検証）。金額(total_price)は元々全メニュー合算で正しく、
  // ここは表示の完全化のみ。
  const multiMenuIds = Array.from(
    new Set(bookings.flatMap((b) => (b.menu_ids && b.menu_ids.length > 1 ? b.menu_ids : []))),
  );
  const menuNameMap = new Map<string, string>();
  if (multiMenuIds.length > 0) {
    const { data: menuRows } = await admin
      .from('facility_menus')
      .select('id, name')
      .eq('facility_id', facilityId)
      .in('id', multiMenuIds);
    for (const m of (menuRows ?? []) as { id: string; name: string }[]) {
      menuNameMap.set(m.id, m.name);
    }
  }

  // profiles(display_name, email) は embed しない：bookings.user_id は auth.users(id) 参照で
  // bookings→profiles の FK が無く、PostgREST が embed を解決できず会計CSVエクスポートが常時 500 に
  // 落ちる実バグだった（user-packages / user-subscriptions と同根）。user_id で別取得しマージする。
  const customerUserIds = Array.from(new Set(bookings.map((b) => b.user_id).filter(Boolean) as string[]));
  if (customerUserIds.length > 0) {
    const { data: profs, error: profErr } = await admin
      .from('profiles')
      .select('id, display_name, email')
      .in('id', customerUserIds);
    if (profErr) return NextResponse.json({ error: 'データの取得に失敗しました' }, { status: 500 });
    const profMap = new Map((profs ?? []).map((p) => [p.id as string, { display_name: p.display_name ?? undefined, email: p.email ?? undefined }]));
    for (const b of bookings) b.profiles = b.user_id ? (profMap.get(b.user_id) ?? null) : null;
  }

  // embed した menu を従来の menu_name フラット形へ平坦化。複数メニュー時は menu_ids 順に全名を
  // 「、」連結（解決できた名前が1件も無ければ embed フォールバック＝表示が空になるのを防ぐ）。
  const rows = bookings.map((b) => {
    const embedded = (Array.isArray(b.menu) ? b.menu[0] : b.menu)?.name ?? null;
    let menu_name = embedded;
    if (b.menu_ids && b.menu_ids.length > 1) {
      const names = b.menu_ids
        .map((id) => menuNameMap.get(id))
        .filter((n): n is string => Boolean(n));
      if (names.length > 0) menu_name = names.join('、');
    }
    return { ...b, menu_name };
  });

  let csv = '';
  let filename = '';

  if (format === 'freee') {
    // freee 取引インポート形式
    filename = `carelink_freee_${from ?? 'all'}.csv`;
    const header = ['取引日', '収支区分', '管理番号', '取引先', '勘定科目', '税区分', '金額', '税計算区分', '消費税額', '備考'];
    csv = '\uFEFF' + header.join(',') + '\n';
    for (const b of rows) {
      const customer = (Array.isArray(b.profiles) ? b.profiles[0] : b.profiles) as { display_name?: string } | null;
      const amount = b.total_amount ?? 0;
      const tax = Math.round(amount * 10 / 110);
      csv += toCsvRow([
        b.booking_date,
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
    for (const b of rows) {
      const customer = (Array.isArray(b.profiles) ? b.profiles[0] : b.profiles) as { display_name?: string } | null;
      const amount = b.total_amount ?? 0;
      csv += toCsvRow([
        b.booking_date,
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
    for (const b of rows) {
      const customer = (Array.isArray(b.profiles) ? b.profiles[0] : b.profiles) as { display_name?: string; email?: string } | null;
      csv += toCsvRow([
        b.id,
        b.booking_date,
        customer?.display_name ?? '',
        customer?.email ?? '',
        b.menu_name ?? '',
        b.total_amount ?? 0,
        b.status,
      ]) + '\n';
    }
  }

  const { ip: auditIp, ua } = getRequestContext(request);
  void writeAuditLog({
    userId: user.id,
    facilityId,
    action: 'export',
    tableName: 'bookings',
    newValues: { format, from: from ?? null, to: to ?? null, row_count: bookings.length },
    ipAddress: auditIp,
    userAgent: ua,
  });

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
