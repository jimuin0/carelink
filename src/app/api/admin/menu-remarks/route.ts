import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';

// メニュー全体の備考（facility_profiles.menu_remarks）専用エンドポイント。
// 設定エンドポイントは name 必須のため、メニュー画面からの単項目更新用に分離。
const schema = z.object({ menu_remarks: z.string().max(500).optional().nullable() });

async function getAdminInfo(request: NextRequest): Promise<{ userId: string; facilityId: string } | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const facilityId = request.nextUrl.searchParams.get('facility_id');
  if (!facilityId || !UUID_REGEX.test(facilityId)) return null;
  const { data } = await supabase
    .from('facility_members').select('facility_id')
    .eq('user_id', user.id).eq('facility_id', facilityId).in('role', ['owner', 'admin']).single();
  return data ? { userId: user.id, facilityId: data.facility_id } : null;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 30, 60_000, 'menu-remarks-get')) return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = createServiceRoleClient();
  const { data, error } = await admin.from('facility_profiles').select('menu_remarks').eq('id', auth.facilityId).single();
  // マイグレーション未適用（カラム不在）の場合は supported:false で UI 側を無効化
  if (error) return NextResponse.json({ supported: false, menu_remarks: '' });
  return NextResponse.json({ supported: true, menu_remarks: (data as { menu_remarks: string | null }).menu_remarks ?? '' });
}

export async function PATCH(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'menu-remarks-patch')) return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const admin = createServiceRoleClient();
  const { error } = await admin.from('facility_profiles')
    .update({ menu_remarks: parsed.data.menu_remarks ?? null })
    .eq('id', auth.facilityId);
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  void writeAuditLog({ userId: auth.userId, facilityId: auth.facilityId, action: 'update', tableName: 'facility_profiles', recordId: auth.facilityId, newValues: { menu_remarks: parsed.data.menu_remarks ?? null }, ipAddress: ip });
  return NextResponse.json({ ok: true });
}
