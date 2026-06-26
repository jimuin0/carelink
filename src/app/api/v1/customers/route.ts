/**
 * CareLink 外部API v1 — 顧客一覧
 * GET /api/v1/customers
 * Authorization: Bearer {API_KEY}
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { alertCaughtError } from '@/lib/alert';

const API_VERSION = '1.0.0';

async function resolveApiKey(apiKey: string) {
  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  const admin = createServiceRoleClient();
  const { data } = await admin
    .from('api_keys')
    .select('facility_id, scopes, is_active, expires_at')
    .eq('key_hash', keyHash)
    .single();
  if (!data || !data.is_active) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  return { facility_id: data.facility_id, scopes: data.scopes ?? [] as string[] };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // 外部公開 JSON API のため、想定外 throw でも必ず JSON 500 を返して契約を守る
  // （未捕捉だと Next.js 既定の非JSON 500 が返り API クライアントを壊す）。
  // catch 経路は instrumentation.ts onRequestError に伝播しないため、
  // Slack 通知漏れを防ぐべく alertCaughtError を明示発火する（🔴2 と同方針）。
  try {
    return await handleGet(request);
  } catch (e) {
    alertCaughtError('v1-customers', e, new URL(request.url).pathname);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function handleGet(request: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 60, 60_000, 'v1-customers')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const apiKey = authHeader.slice(7).trim();
  const principal = await resolveApiKey(apiKey);
  if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!principal.scopes.includes('customers:read') && !principal.scopes.includes('*')) {
    return NextResponse.json({ error: 'Forbidden', message: 'customers:read スコープが必要です' }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const limit = Math.min(parseInt(sp.get('limit') ?? '50') || 50, 100);
  const page = Math.min(Math.max(parseInt(sp.get('page') ?? '1') || 1, 1), 10000);
  const offset = (page - 1) * limit;
  const search = sp.get('search');

  const admin = createServiceRoleClient();

  // ユニーク顧客を DB 側で正しくページングする。旧実装は bookings を range() でページングし
  // 取得した1ページ内だけ dedup していたため、total が重複込み件数になり（ユニーク顧客数と乖離）、
  // 同一顧客がページ跨ぎで重複・1ページの実件数が limit 未満になる二重の破綻があった。
  // RPC が DISTINCT ON で一意化し COUNT(*) OVER() でユニーク総数を同梱して返す。
  // 検索文字列は LIKE ワイルドカード(% _ \)をエスケープし区切り文字を除去（パラメータ渡しで注入は不可だが念のため）。
  const safeSearch = search
    ? search.replace(/[%_\\]/g, '\\$&').replace(/[,()]/g, '').slice(0, 100)
    : null;

  const { data, error } = await admin.rpc('get_facility_customers_v1', {
    p_facility_id: principal.facility_id,
    p_search: safeSearch,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });

  const rows = (data ?? []) as { name: string; phone: string | null; email: string | null; total_count: number }[];
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  const customers = rows.map((c) => ({ name: c.name, phone: c.phone, email: c.email }));

  return NextResponse.json({
    api_version: API_VERSION,
    pagination: { page, limit, total },
    data: customers,
  }, { headers: { 'X-API-Version': API_VERSION, 'Cache-Control': 'no-store' } });
}
