import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog } from '@/lib/audit-logger';

const blogUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(50000).optional(),
  is_published: z.boolean().optional(),
});

async function getAdminFacilityId(request: NextRequest): Promise<{ userId: string; facilityId: string } | null> {
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

  return data?.facility_id ? { userId: user.id, facilityId: data.facility_id } : null;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-blog-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const auth = await getAdminFacilityId(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = blogUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const updatePayload: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.is_published !== undefined) {
    updatePayload.published_at = parsed.data.is_published ? new Date().toISOString() : null;
  }

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('blog_posts')
    .update(updatePayload)
    .eq('id', params.id)
    .eq('facility_id', auth.facilityId)
    .select()
    // .maybeSingle(): 該当0行（他施設の記事/存在しないid）を not found として扱う。.single() だと
    // 0行→PGRST116で if(error)→500 が先に発火し if(!data)→404 が到達不能になる（500に化ける）。
    .maybeSingle();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data) return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });

  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'update',
    tableName: 'blog_posts',
    recordId: params.id,
    newValues: updatePayload,
    ipAddress: ip,
  });

  return NextResponse.json({ post: data });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-blog-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const auth = await getAdminFacilityId(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  // 【2026年7月10日 恒久根治】削除件数を検証せず常に成功を返していたため、他施設のIDを
  // 指定した0件削除（facility_id不一致）も「成功」と偽装していた（phantom success）。
  // .select() で削除された行を受け取り、0件なら404を返す。
  const { data, error } = await admin
    .from('blog_posts')
    .delete()
    .eq('id', params.id)
    .eq('facility_id', auth.facilityId)
    .select();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });

  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'delete',
    tableName: 'blog_posts',
    recordId: params.id,
    ipAddress: ip,
  });

  return NextResponse.json({ ok: true });
}
