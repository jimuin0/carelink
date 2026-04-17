/**
 * CareLink 外部API v1 — 顧客一覧
 * GET /api/v1/customers
 * Authorization: Bearer {API_KEY}
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const API_VERSION = '1.0.0';

async function resolveApiKey(apiKey: string) {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await admin
    .from('api_keys')
    .select('facility_id, scopes, is_active, expires_at')
    .eq('key_hash', apiKey)
    .single();
  if (!data || !data.is_active) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  return { facility_id: data.facility_id, scopes: data.scopes ?? [] as string[] };
}

export async function GET(request: NextRequest) {
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
  const page = Math.max(parseInt(sp.get('page') ?? '1') || 1, 1);
  const offset = (page - 1) * limit;
  const search = sp.get('search');

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Get unique customers from bookings for this facility
  let query = admin
    .from('bookings')
    .select('customer_name, customer_phone, customer_email, user_id', { count: 'exact' })
    .eq('facility_id', principal.facility_id)
    .not('customer_name', 'is', null)
    .order('created_at', { ascending: false });

  if (search) {
    query = query.or(`customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%`);
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Deduplicate by phone/user_id
  const seen = new Set<string>();
  const customers = (data ?? []).filter((c) => {
    const key = c.user_id ?? c.customer_phone ?? c.customer_name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((c) => ({
    name: c.customer_name,
    phone: c.customer_phone,
    email: c.customer_email,
  }));

  return NextResponse.json({
    api_version: API_VERSION,
    pagination: { page, limit, total: count ?? 0 },
    data: customers,
  }, { headers: { 'X-API-Version': API_VERSION, 'Cache-Control': 'no-store' } });
}
