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

const VALID_COUPON_TYPES = ['all', 'new_customer', 'repeat', 'limited_time'] as const;
const VALID_DISCOUNT_TYPES = ['fixed', 'percentage', 'special_price'] as const;

// 有効期限は 'YYYY-MM-DD' 形式かつ実在する日付のみ許可（不正日付による DATE 列の 500 を防ぐ）
const COUPON_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です').refine(
  (s) => { const d = new Date(s + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; },
  '日付が不正です',
);

// マイグレーション未適用環境向け：追加カラムが無い場合に除外して再試行
const COUPON_EXT_KEYS = ['presentation_timing', 'usage_condition', 'search_category1', 'search_category2', 'duration_minutes', 'image_url', 'image_submission'] as const;

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  coupon_type: z.enum(VALID_COUPON_TYPES).optional(),
  discount_type: z.enum(VALID_DISCOUNT_TYPES).optional(),
  discount_value: z.number().int().min(0).max(100000).optional().nullable(),
  special_price: z.number().int().min(0).max(9999999).optional().nullable(),
  valid_from: COUPON_DATE.nullable().optional(),
  valid_until: COUPON_DATE.nullable().optional(),
  is_active: z.boolean().optional(),
  presentation_timing: z.string().max(20).optional().nullable(),
  usage_condition: z.string().max(100).optional().nullable(),
  search_category1: z.string().max(50).optional().nullable(),
  search_category2: z.string().max(50).optional().nullable(),
  duration_minutes: z.number().int().min(0).max(1440).optional().nullable(),
  image_url: z.string().max(200000).optional().nullable(),
  image_submission: z.boolean().optional(),
  sort_order: z.number().int().min(0).optional(),
}).refine(
  (data) => !(data.discount_type === 'percentage' && data.discount_value != null && data.discount_value > 100),
  { message: 'percentage discount_value must be 0-100', path: ['discount_value'] },
).refine(
  // 有効期間の前後関係（両方が更新ペイロードに含まれる場合のみ検証・round3 #17）
  (data) => !(data.valid_from != null && data.valid_until != null && data.valid_from > data.valid_until),
  { message: '有効期限の開始は終了より前にしてください', path: ['valid_until'] },
);

async function verifyCouponAdmin(couponId: string, userId: string): Promise<string | null> {
  const admin = createServiceRoleClient();
  const { data: coupon } = await admin.from('coupons').select('facility_id').eq('id', couponId).single();
  if (!coupon) return null;

  const supabase = await createServerSupabaseAuthClient();
  const { data: mem } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', userId)
    .eq('facility_id', coupon.facility_id)
    .in('role', ['owner', 'admin'])
    .single();

  return mem ? coupon.facility_id : null;
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'coupons-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = await verifyCouponAdmin(params.id, user.id);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  // Include facility_id in WHERE as defence-in-depth (CAS guard against stale verifyCouponAdmin read)
  let { data, error } = await admin.from('coupons').update(parsed.data).eq('id', params.id).eq('facility_id', facilityId).select().single();
  if (isMissingColumnError(error)) {
    warnMissingColumnFallback('coupons.update');
    ({ data, error } = await admin.from('coupons').update(omitKeys(parsed.data, COUPON_EXT_KEYS)).eq('id', params.id).eq('facility_id', facilityId).select().single());
  }

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'クーポンが見つかりません' }, { status: 404 });

  void writeAuditLog({
    userId: user.id,
    facilityId,
    action: 'update',
    tableName: 'coupons',
    recordId: params.id,
    newValues: parsed.data,
    ipAddress: ip,
  });

  return NextResponse.json({ coupon: data });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 10, 60_000, 'coupons-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const facilityId = await verifyCouponAdmin(params.id, user.id);
  if (!facilityId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  // 孤児化防止(#06): 削除前に image_url を取得し、DB削除成功後に Storage 実体も消す
  const { data: row } = await admin.from('coupons').select('image_url').eq('id', params.id).eq('facility_id', facilityId).maybeSingle();
  // Include facility_id in WHERE as defence-in-depth (CAS guard against stale verifyCouponAdmin read)
  const { error } = await admin.from('coupons').delete().eq('id', params.id).eq('facility_id', facilityId);
  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  const cpath = storagePathFromPublicUrl((row as { image_url: string | null } | null)?.image_url);
  if (cpath) { try { await admin.storage.from(UPLOAD_BUCKET).remove([cpath]); } catch { /* 実体削除失敗はDB削除を覆さない */ } }

  void writeAuditLog({
    userId: user.id,
    facilityId,
    action: 'delete',
    tableName: 'coupons',
    recordId: params.id,
    ipAddress: ip,
  });

  return NextResponse.json({ message: 'deleted' });
}
