import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { isMissingColumnError, omitKeys, warnMissingColumnFallback } from '@/lib/db-fallback';

const blogUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(50000).optional(),
  is_published: z.boolean().optional(),
  coupon_id: z.string().uuid().optional().nullable(),
  author_id: z.string().uuid().optional().nullable(),
  author_name_id: z.string().uuid().optional().nullable(), // 外部投稿者(blog_authors)
  thumbnail_url: z.string().max(200000).optional().nullable(),
  category: z.string().max(50).optional().nullable(),
  scheduled_at: z.string().datetime({ offset: true }).optional().nullable(), // 予約掲載時刻(ISO)
  image_urls: z.array(z.string().max(200000)).max(4).optional(), // 本文画像（最大4枚 #33）
});

async function getAdminFacilityId(request: NextRequest): Promise<string | null> {
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

  return data?.facility_id ?? null;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-blog-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const facilityId = await getAdminFacilityId(request);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = blogUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

  const updatePayload: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.is_published !== undefined) {
    updatePayload.published_at = parsed.data.is_published ? new Date().toISOString() : null;
  }
  // 予約掲載(#34): scheduled_at 指定時は is_published=true・published_at=予約時刻で上書き（時刻到来まで公開ページ非表示）
  if (parsed.data.scheduled_at) {
    updatePayload.is_published = true;
    updatePayload.published_at = parsed.data.scheduled_at;
  }

  const admin = createServiceRoleClient();

  // クロス施設参照防止: 指定された場合のみ coupon_id / author_id が自施設のものか検証
  if (parsed.data.coupon_id) {
    const { data: c } = await admin.from('coupons').select('id').eq('id', parsed.data.coupon_id).eq('facility_id', facilityId).maybeSingle();
    if (!c) return NextResponse.json({ error: 'クーポンが見つかりません' }, { status: 400 });
  }
  if (parsed.data.author_id) {
    const { data: s } = await admin.from('staff_profiles').select('id').eq('id', parsed.data.author_id).eq('facility_id', facilityId).maybeSingle();
    if (!s) return NextResponse.json({ error: 'スタッフが見つかりません' }, { status: 400 });
  }
  if (parsed.data.author_name_id) {
    const { data: a } = await admin.from('blog_authors').select('id').eq('id', parsed.data.author_name_id).eq('facility_id', facilityId).maybeSingle();
    if (!a) return NextResponse.json({ error: '投稿者が見つかりません' }, { status: 400 });
  }

  let { data, error } = await admin
    .from('blog_posts')
    .update(updatePayload)
    .eq('id', params.id)
    .eq('facility_id', facilityId)
    .select()
    .single();
  if (isMissingColumnError(error)) {
    warnMissingColumnFallback('blog_posts.update');
    ({ data, error } = await admin.from('blog_posts').update(omitKeys(updatePayload, ['category', 'coupon_id', 'author_name_id', 'scheduled_at', 'image_urls'])).eq('id', params.id).eq('facility_id', facilityId).select().single());
  }

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data) return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });
  return NextResponse.json({ post: data });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-blog-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const facilityId = await getAdminFacilityId(request);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from('blog_posts')
    .delete()
    .eq('id', params.id)
    .eq('facility_id', facilityId);

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
