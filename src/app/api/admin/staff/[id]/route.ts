import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';

const staffUpdateSchema = z.object({
  name: z.string().min(1).max(50),
  position: z.string().max(50).optional().nullable(),
  bio: z.string().max(500).optional().nullable(),
  specialties: z.array(z.string().max(50)).max(20).optional(),
  years_experience: z.number().int().min(0).max(99).optional().nullable(),
  instagram_url: z.string().url().max(200).optional().nullable().or(z.literal('')),
  line_works_channel_id: z.string().max(50).optional().nullable(),
  line_works_notify_all: z.boolean().optional(),
  // 在籍/休止（false=休止）。退職者を物理削除せず休止にして公開ページ・予約枠・指名から外す。
  // 予約履歴の参照は保持したいので DELETE でなく is_active フラグで運用する。
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

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-staff-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = staffUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  // is_active は指定された時のみ更新する。未指定の通常編集で在籍状態を勝手に戻さない
  // （休止中スタッフの名前だけ直す等で意図せず再在籍化するのを防ぐ）。
  const updateFields: Record<string, unknown> = {
    name: parsed.data.name,
    position: parsed.data.position ?? null,
    bio: parsed.data.bio ?? null,
    specialties: parsed.data.specialties ?? [],
    years_experience: parsed.data.years_experience ?? null,
    instagram_url: parsed.data.instagram_url || null,
    line_works_channel_id: parsed.data.line_works_channel_id ?? null,
    line_works_notify_all: parsed.data.line_works_notify_all ?? false,
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.is_active !== undefined) updateFields.is_active = parsed.data.is_active;
  const { data, error } = await admin
    .from('staff_profiles')
    .update(updateFields)
    .eq('id', params.id)
    .eq('facility_id', auth.facilityId)
    .select()
    // .maybeSingle(): 該当0行（他施設のスタッフ/存在しないid）を not found として扱う。.single() だと
    // 0行→PGRST116で if(error)→500 が先に発火し if(!data)→404 が到達不能になる（500に化ける）。
    .maybeSingle();

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
