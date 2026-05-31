import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

const staffUpdateSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  position: z.string().max(50).optional().nullable(),
  bio: z.string().max(500).optional().nullable(),
  specialties: z.array(z.string().max(50)).max(20).optional(),
  years_experience: z.number().int().min(0).max(99).optional().nullable(),
  instagram_url: z.string().url().max(200).optional().nullable().or(z.literal('')),
  line_works_channel_id: z.string().max(50).optional().nullable(),
  line_works_notify_all: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

async function getAdminInfo(request: NextRequest): Promise<{ userId: string; facilityId: string } | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const facilityId = request.nextUrl.searchParams.get('facility_id');
  if (!facilityId || !UUID_REGEX.test(facilityId)) return null;

  const { data } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .in('role', ['owner', 'admin'])
    .single();

  return data ? { userId: user.id, facilityId: data.facility_id } : null;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-staff-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = staffUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  // 送信されたフィールドのみ更新（一覧の掲載/非掲載トグル等の部分更新に対応。
  // 管理画面の全項目フォームは全フィールド送信のため従来挙動と後方互換）
  const upd: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  if ('instagram_url' in upd) upd.instagram_url = (upd.instagram_url as string) || null;
  const { data, error } = await admin
    .from('staff_profiles')
    .update(upd)
    .eq('id', params.id)
    .eq('facility_id', auth.facilityId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'スタッフが見つかりません' }, { status: 404 });

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'update',
    tableName: 'staff_profiles',
    recordId: params.id,
    newValues: { name: parsed.data.name, position: parsed.data.position ?? null },
    ipAddress: ip,
    userAgent: ua,
  });
  return NextResponse.json({ staff: data });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-staff-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  const { error } = await admin.from('staff_profiles').delete().eq('id', params.id).eq('facility_id', auth.facilityId);
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'delete',
    tableName: 'staff_profiles',
    recordId: params.id,
    ipAddress: ip,
    userAgent: ua,
  });
  return NextResponse.json({ message: 'deleted' });
}
