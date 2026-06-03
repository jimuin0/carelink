import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { isMissingColumnError, omitKeys, warnMissingColumnFallback } from '@/lib/db-fallback';

const VALID_PHOTO_TYPES = ['main', 'interior', 'exterior', 'staff', 'menu', 'other'] as const;
// 後続マイグレーションで追加された拡張列。未適用環境でも500にしないため除外候補にする（photos/[id] と対称）
const PHOTO_EXT_KEYS = ['title', 'genre', 'search_category', 'image_submission', 'is_published', 'coupon_id'] as const;

const photoSchema = z.object({
  photo_url: z.string().min(1).max(200000), // 公開URL or data URI（Storage連携前のフォールバック）
  photo_type: z.enum(VALID_PHOTO_TYPES).default('other'),
  caption: z.string().max(200).optional().nullable(),
  sort_order: z.number().int().min(0).optional(),
  title: z.string().max(100).optional().nullable(),
  genre: z.string().max(100).optional().nullable(),
  search_category: z.string().max(100).optional().nullable(),
  image_submission: z.boolean().optional(),
  is_published: z.boolean().optional(),
  coupon_id: z.string().uuid().optional().nullable(),
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

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 30, 60_000, 'photos-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = createServiceRoleClient();
  const { data, error } = await admin.from('facility_photos').select('*').eq('facility_id', auth.facilityId).order('sort_order', { ascending: true }).order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ photos: data });
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'photos-create')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = photoSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  // クロス施設参照防止: coupon_id が自施設のものか検証
  if (parsed.data.coupon_id) {
    const { data: c } = await admin.from('coupons').select('id').eq('id', parsed.data.coupon_id).eq('facility_id', auth.facilityId).maybeSingle();
    if (!c) return NextResponse.json({ error: 'クーポンが見つかりません' }, { status: 400 });
  }
  // sort_order の既定値は「現存最大 +1」(#22)。count 基準だと中間削除後に既存行と衝突し並び順が不定になるため。
  const { data: maxRow } = await admin.from('facility_photos').select('sort_order').eq('facility_id', auth.facilityId).order('sort_order', { ascending: false }).limit(1).maybeSingle();
  const nextSort = ((maxRow as { sort_order: number | null } | null)?.sort_order ?? -1) + 1;
  const insertRow = {
    facility_id: auth.facilityId,
    ...parsed.data,
    sort_order: parsed.data.sort_order ?? nextSort,
  };
  let { data, error } = await admin.from('facility_photos').insert(insertRow).select().single();
  // 拡張列が未適用の環境では除外して再試行（menus/coupons/blog と対称な部分適用耐性）
  if (isMissingColumnError(error)) {
    warnMissingColumnFallback('facility_photos.insert');
    ({ data, error } = await admin.from('facility_photos').insert(omitKeys(insertRow, PHOTO_EXT_KEYS)).select().single());
  }

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId: auth.userId, facilityId: auth.facilityId, action: 'create', tableName: 'facility_photos',
    recordId: data.id, newValues: { caption: parsed.data.caption, photo_type: parsed.data.photo_type }, ipAddress: ip, userAgent: ua,
  });
  return NextResponse.json({ photo: data }, { status: 201 });
}
