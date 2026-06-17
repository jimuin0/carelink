/**
 * CareLink 外部API v1 — 予約一覧
 * GET /api/v1/bookings
 * Authorization: Bearer {API_KEY}
 *
 * クエリパラメータ:
 *   facility_id (required)
 *   from, to (ISO date YYYY-MM-DD)
 *   status (pending|confirmed|completed|cancelled)
 *   limit (max 100, default 50)
 *   page
 *
 * 用途: POS・会計ソフト・独自アプリとの連携
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { alertCaughtError } from '@/lib/alert';

const API_VERSION = '1.0.0';

function unauthorized() {
  return NextResponse.json(
    { error: 'Unauthorized', message: 'APIキーが無効です。Authorization: Bearer {KEY} ヘッダーを確認してください。' },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="CareLink API"' } }
  );
}

async function resolveApiKey(apiKey: string): Promise<{ facility_id: string; scopes: string[] } | null> {
  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  const admin = createServiceRoleClient();
  const { data } = await admin
    .from('api_keys')
    .select('facility_id, scopes, is_active, expires_at')
    .eq('key_hash', keyHash)
    .single();

  if (!data || !data.is_active) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  return { facility_id: data.facility_id, scopes: data.scopes ?? [] };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // 外部公開 JSON API のため、想定外 throw でも必ず JSON 500 を返して契約を守る
  // （未捕捉だと Next.js 既定の非JSON 500 が返り API クライアントを壊す）。
  // catch 経路は instrumentation.ts onRequestError に伝播しないため、
  // Slack 通知漏れを防ぐべく alertCaughtError を明示発火する（🔴2 と同方針）。
  try {
    return await handleGet(request);
  } catch (e) {
    alertCaughtError('v1-bookings', e, new URL(request.url).pathname);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function handleGet(request: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 60, 60_000, 'v1-bookings')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  // Validate Authorization header
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return unauthorized();
  const apiKey = authHeader.slice(7).trim();
  // HTTP ヘッダー正規化により trailing space が除去されるため空 apiKey は到達不可（L51 で捕捉済み）
  /* istanbul ignore next */
  if (!apiKey) return unauthorized();

  const principal = await resolveApiKey(apiKey);
  if (!principal) return unauthorized();

  if (!principal.scopes.includes('bookings:read') && !principal.scopes.includes('*')) {
    return NextResponse.json({ error: 'Forbidden', message: 'bookings:read スコープが必要です' }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const facilityId = sp.get('facility_id') ?? principal.facility_id;

  // API keyのfacility_idと異なる施設を指定した場合はエラー
  if (facilityId !== principal.facility_id && !principal.scopes.includes('*')) {
    return NextResponse.json({ error: 'Forbidden', message: '別施設のデータにはアクセスできません' }, { status: 403 });
  }

  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const VALID_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];

  const fromRaw = sp.get('from');
  const toRaw = sp.get('to');
  const statusRaw = sp.get('status');

  if (fromRaw && !ISO_DATE_RE.test(fromRaw)) {
    return NextResponse.json({ error: 'from は YYYY-MM-DD 形式で指定してください' }, { status: 400 });
  }
  if (toRaw && !ISO_DATE_RE.test(toRaw)) {
    return NextResponse.json({ error: 'to は YYYY-MM-DD 形式で指定してください' }, { status: 400 });
  }
  if (statusRaw && !VALID_STATUSES.includes(statusRaw)) {
    return NextResponse.json({ error: `status は ${VALID_STATUSES.join('|')} のいずれかです` }, { status: 400 });
  }

  const from = fromRaw;
  const to = toRaw;
  const status = statusRaw;
  const limit = Math.min(parseInt(sp.get('limit') ?? '50') || 50, 100);
  const page = Math.min(Math.max(parseInt(sp.get('page') ?? '1') || 1, 1), 10000);
  const offset = (page - 1) * limit;

  const admin = createServiceRoleClient();

  let query = admin
    .from('bookings')
    // bookings の実列に合わせる: customer_phone→phone / notes→note はエイリアスで出力名維持、
    // menu_name/staff_name は列が無いため menu_id/staff_id 経由で embed し後段で平坦化する。
    .select('id, booking_date, start_time, end_time, status, customer_name, customer_phone:phone, total_price, menu:facility_menus(name), staff:staff_profiles(name), notes:note, created_at, updated_at', { count: 'exact' })
    .eq('facility_id', facilityId)
    .order('booking_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (from) query = query.gte('booking_date', from);
  if (to) query = query.lte('booking_date', to);
  if (status) query = query.eq('status', status);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });

  // embed した menu/staff を従来の menu_name/staff_name フラット形へ戻す（外部API契約維持）
  type RawRow = {
    menu?: { name: string } | { name: string }[] | null;
    staff?: { name: string } | { name: string }[] | null;
  } & Record<string, unknown>;
  const rows = ((data ?? []) as RawRow[]).map((b) => {
    const m = Array.isArray(b.menu) ? b.menu[0] : b.menu;
    const s = Array.isArray(b.staff) ? b.staff[0] : b.staff;
    const { menu, staff, ...rest } = b;
    void menu; void staff;
    return { ...rest, menu_name: m?.name ?? null, staff_name: s?.name ?? null };
  });

  return NextResponse.json({
    api_version: API_VERSION,
    facility_id: facilityId,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      total_pages: Math.ceil((count ?? 0) / limit),
    },
    data: rows,
  }, {
    headers: {
      'X-API-Version': API_VERSION,
      'Cache-Control': 'no-store',
    },
  });
}
