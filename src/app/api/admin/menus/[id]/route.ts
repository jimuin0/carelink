import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';
import { isMissingColumnError, omitKeys, warnMissingColumnFallback } from '@/lib/db-fallback';
import { revalidateFacilityById } from '@/lib/revalidate';

// 後続マイグレーションで追加された拡張列。未適用環境でも500にしないため除外候補にする
const MENU_EXT_KEYS = ['subcategory', 'search_category', 'reservable', 'is_published', 'price_show_tilde', 'price_ask'] as const;

const menuUpdateSchema = z.object({
  category: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  price: z.number().int().min(0).max(9999999).optional().nullable(),
  price_note: z.string().max(100).optional().nullable(),
  duration_minutes: z.number().int().min(0).max(1440).optional().nullable(),
  photo_url: z.string().url().max(500).optional().nullable().or(z.literal('')),
  is_featured: z.boolean().optional(),
  sort_order: z.number().int().min(0).optional(),
  subcategory: z.string().max(100).optional().nullable(),
  search_category: z.string().max(100).optional().nullable(),
  reservable: z.boolean().optional(),
  is_published: z.boolean().optional(),
  price_show_tilde: z.boolean().optional(),
  price_ask: z.boolean().optional(),
});

async function getAdminContext(request: NextRequest): Promise<{ facilityId: string; userId: string } | null> {
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

  return data ? { facilityId: data.facility_id, userId: user.id } : null;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-menus-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = menuUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();

  // Duplicate name check (if name is being changed)
  if (parsed.data.name) {
    const { data: existing } = await admin
      .from('facility_menus')
      .select('id')
      .eq('facility_id', ctx.facilityId)
      .eq('name', parsed.data.name)
      .neq('id', params.id)
      .maybeSingle();
    if (existing) return NextResponse.json({ error: '同じ名前のメニューが既に存在します' }, { status: 409 });
  }

  const updateData: Record<string, unknown> = { ...parsed.data };
  if ('photo_url' in updateData) updateData.photo_url = updateData.photo_url || null;
  let { data, error } = await admin
    .from('facility_menus')
    .update(updateData)
    .eq('id', params.id)
    .eq('facility_id', ctx.facilityId)
    .select()
    .single();
  // 拡張列が未適用の環境では除外して再試行
  if (isMissingColumnError(error)) {
    warnMissingColumnFallback('facility_menus.update');
    ({ data, error } = await admin.from('facility_menus').update(omitKeys(updateData, MENU_EXT_KEYS)).eq('id', params.id).eq('facility_id', ctx.facilityId).select().single());
  }

  // 一意制約 uniq_facility_menu_name 違反（改名で同名重複）は 409 で返す
  if (error?.code === '23505') return NextResponse.json({ error: '同じ名前のメニューが既に存在します' }, { status: 409 });
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'メニューが見つかりません' }, { status: 404 });

  void writeAuditLog({
    userId: ctx.userId,
    facilityId: ctx.facilityId,
    action: 'update',
    tableName: 'facility_menus',
    recordId: params.id,
    newValues: parsed.data,
    ipAddress: ip,
  });

  await revalidateFacilityById(ctx.facilityId); // 公開ページ(ISR)へ即時反映（round6）
  return NextResponse.json({ menu: data });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-menus-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from('facility_menus')
    .delete()
    .eq('id', params.id)
    .eq('facility_id', ctx.facilityId);

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  void writeAuditLog({
    userId: ctx.userId,
    facilityId: ctx.facilityId,
    action: 'delete',
    tableName: 'facility_menus',
    recordId: params.id,
    ipAddress: ip,
  });

  await revalidateFacilityById(ctx.facilityId); // 公開ページ(ISR)へ即時反映（round6）
  return NextResponse.json({ ok: true });
}
