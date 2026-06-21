import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';

const menuUpdateSchema = z.object({
  category: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  price: z.number().int().min(0).max(9999999).optional().nullable(),
  price_note: z.string().max(100).optional().nullable(),
  duration_minutes: z.number().int().min(0).max(1440).optional().nullable(),
  photo_url: z.string().url().max(500).optional().nullable().or(z.literal('')),
  is_featured: z.boolean().optional(),
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

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-menus-patch')) {
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

  const { data, error } = await admin
    .from('facility_menus')
    // facility_menus に updated_at 列は無い（created_at のみ）→ 書き込むと 400 になるため付けない
    .update({ ...parsed.data, photo_url: parsed.data.photo_url || null })
    .eq('id', params.id)
    .eq('facility_id', ctx.facilityId)
    .select()
    .single();

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

  return NextResponse.json({ menu: data });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-menus-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();

  // 公開中の施設で最後のメニューを削除すると、公開のまま予約不能（メニュー0件の行き止まり）になる。
  // 公開ガード（公開にはメニュー≥1 が必須）と整合させ、公開中は最後の1件の削除を拒否する
  // （先に施設を非公開にするか別のメニューを追加してもらう。サイレント非公開化より明示的で安全）。
  const { data: facility } = await admin
    .from('facility_profiles')
    .select('status')
    .eq('id', ctx.facilityId)
    .single();
  if (facility?.status === 'published') {
    const { count } = await admin
      .from('facility_menus')
      .select('id', { count: 'exact', head: true })
      .eq('facility_id', ctx.facilityId);
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: '公開中は最後のメニューを削除できません。先に施設を非公開にするか、別のメニューを追加してください。' },
        { status: 400 }
      );
    }
  }

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

  return NextResponse.json({ ok: true });
}
