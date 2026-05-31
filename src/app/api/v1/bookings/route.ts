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
import { inMemoryRateLimit } from '@/lib/rate-limit';

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

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 60, 60_000, 'v1-bookings')) {
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
    .select('id, booking_date, start_time, end_time, status, customer_name, customer_phone, total_price, menu_name, staff_name, notes, created_at, updated_at', { count: 'exact' })
    .eq('facility_id', facilityId)
    .order('booking_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (from) query = query.gte('booking_date', from);
  if (to) query = query.lte('booking_date', to);
  if (status) query = query.eq('status', status);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });

  return NextResponse.json({
    api_version: API_VERSION,
    facility_id: facilityId,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      total_pages: Math.ceil((count ?? 0) / limit),
    },
    data: data ?? [],
  }, {
    headers: {
      'X-API-Version': API_VERSION,
      'Cache-Control': 'no-store',
    },
  });
}
