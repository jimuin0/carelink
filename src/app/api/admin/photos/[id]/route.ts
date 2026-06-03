import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';
import { isMissingColumnError, omitKeys, warnMissingColumnFallback } from '@/lib/db-fallback';
import { storagePathFromPublicUrl, UPLOAD_BUCKET } from '@/lib/storage-cleanup';

const VALID_PHOTO_TYPES = ['main', 'interior', 'exterior', 'staff', 'menu', 'other'] as const;
// マイグレーション部分適用環境でも500にしないための拡張カラム
const PHOTO_EXT_KEYS = ['title', 'genre', 'search_category', 'image_submission', 'is_published', 'coupon_id'] as const;

const updateSchema = z.object({
  photo_url: z.string().min(1).max(200000).optional(),
  photo_type: z.enum(VALID_PHOTO_TYPES).optional(),
  caption: z.string().max(200).optional().nullable(),
  sort_order: z.number().int().min(0).optional(),
  title: z.string().max(100).optional().nullable(),
  genre: z.string().max(100).optional().nullable(),
  search_category: z.string().max(100).optional().nullable(),
  image_submission: z.boolean().optional(),
  is_published: z.boolean().optional(),
  coupon_id: z.string().uuid().optional().nullable(),
});

async function verifyPhotoAdmin(photoId: string, userId: string): Promise<string | null> {
  const admin = createServiceRoleClient();
  const { data: photo } = await admin.from('facility_photos').select('facility_id').eq('id', photoId).single();
  if (!photo) return null;
  const supabase = await createServerSupabaseAuthClient();
  const { data: mem } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', userId)
    .eq('facility_id', photo.facility_id)
    .in('role', ['owner', 'admin'])
    .single();
  return mem ? photo.facility_id : null;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 30, 60_000, 'photos-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = await verifyPhotoAdmin(params.id, user.id);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  // クロス施設参照防止: coupon_id が自施設のものか検証
  if (parsed.data.coupon_id) {
    const { data: c } = await admin.from('coupons').select('id').eq('id', parsed.data.coupon_id).eq('facility_id', facilityId).maybeSingle();
    if (!c) return NextResponse.json({ error: 'クーポンが見つかりません' }, { status: 400 });
  }
  let { data, error } = await admin.from('facility_photos').update(parsed.data).eq('id', params.id).eq('facility_id', facilityId).select().single();
  if (isMissingColumnError(error)) {
    warnMissingColumnFallback('facility_photos.update');
    ({ data, error } = await admin.from('facility_photos').update(omitKeys(parsed.data, PHOTO_EXT_KEYS)).eq('id', params.id).eq('facility_id', facilityId).select().single());
  }
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data) return NextResponse.json({ error: '写真が見つかりません' }, { status: 404 });

  void writeAuditLog({ userId: user.id, facilityId, action: 'update', tableName: 'facility_photos', recordId: params.id, newValues: parsed.data, ipAddress: ip });
  return NextResponse.json({ photo: data });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'photos-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = await verifyPhotoAdmin(params.id, user.id);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  // 孤児化防止(#06): DB行削除前に photo_url を取得し、削除成功後に Storage 実体も消す
  const { data: row } = await admin.from('facility_photos').select('photo_url').eq('id', params.id).eq('facility_id', facilityId).maybeSingle();
  const { error } = await admin.from('facility_photos').delete().eq('id', params.id).eq('facility_id', facilityId);
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  const path = storagePathFromPublicUrl((row as { photo_url: string | null } | null)?.photo_url);
  if (path) { try { await admin.storage.from(UPLOAD_BUCKET).remove([path]); } catch { /* 実体削除失敗はDB削除を覆さない(孤児sweepで回収) */ } }

  void writeAuditLog({ userId: user.id, facilityId, action: 'delete', tableName: 'facility_photos', recordId: params.id, ipAddress: ip });
  return NextResponse.json({ message: 'deleted' });
}
