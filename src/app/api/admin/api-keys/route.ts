/**
 * APIキー管理
 * POST /api/admin/api-keys — 新規作成
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { createHash, randomBytes } from 'crypto';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

const VALID_SCOPES = ['bookings:read', 'customers:read', 'reviews:read'];

function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = 'ck_live_' + randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 16);
  return { raw, hash, prefix };
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 10, 60_000, 'api-keys-create')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { facility_id, name, scopes } = body as { facility_id?: string; name?: string; scopes?: string[] };

  if (!facility_id || typeof facility_id !== 'string') return NextResponse.json({ error: 'facility_id required' }, { status: 400 });
  if (!UUID_REGEX.test(facility_id)) return NextResponse.json({ error: 'Invalid facility_id' }, { status: 400 });
  if (!name || typeof name !== 'string' || name.trim().length === 0) return NextResponse.json({ error: 'name required' }, { status: 400 });
  if (!Array.isArray(scopes) || scopes.length === 0) return NextResponse.json({ error: 'scopes required' }, { status: 400 });

  const invalidScopes = scopes.filter((s) => !VALID_SCOPES.includes(s));
  if (invalidScopes.length > 0) return NextResponse.json({ error: `Invalid scopes: ${invalidScopes.join(', ')}` }, { status: 400 });

  // Verify ownership
  const { data: mem } = await supabase
    .from('facility_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('facility_id', facility_id)
    .in('role', ['owner', 'admin'])
    .single();
  if (!mem) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const admin = createServiceRoleClient();
  const { raw, hash, prefix } = generateApiKey();

  const { data: newKey, error } = await admin.from('api_keys').insert({
    facility_id,
    name: name.trim(),
    key_hash: hash,
    key_prefix: prefix,
    scopes,
    created_by: user.id,
  }).select('id, name, key_prefix, scopes, is_active, last_used_at, expires_at, created_at').single();

  if (error || !newKey) return NextResponse.json({ error: 'APIキーの作成に失敗しました' }, { status: 500 });

  const { ip: auditIp, ua } = getRequestContext(request);
  void writeAuditLog({
    userId: user.id,
    facilityId: facility_id,
    action: 'create',
    tableName: 'api_keys',
    recordId: newKey.id,
    newValues: { name: name.trim(), scopes, key_prefix: prefix },
    ipAddress: auditIp,
    userAgent: ua,
  });

  // Return the raw key ONCE — it won't be retrievable after this
  return NextResponse.json({ raw_key: raw, key: newKey }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'api-keys-list')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = request.nextUrl.searchParams.get('facility_id');
  if (!facilityId) return NextResponse.json({ error: 'facility_id required' }, { status: 400 });
  if (!UUID_REGEX.test(facilityId)) return NextResponse.json({ error: 'Invalid facility_id' }, { status: 400 });

  const { data: mem } = await supabase
    .from('facility_members').select('role')
    .eq('user_id', user.id).eq('facility_id', facilityId)
    .in('role', ['owner', 'admin']).single();
  if (!mem) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const admin = createServiceRoleClient();
  const { data } = await admin.from('api_keys')
    .select('id, name, key_prefix, scopes, is_active, last_used_at, expires_at, created_at')
    .eq('facility_id', facilityId)
    .order('created_at', { ascending: false });

  return NextResponse.json(data ?? []);
}
