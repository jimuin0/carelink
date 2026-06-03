import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { isMissingColumnError, omitKeys, warnMissingColumnFallback } from '@/lib/db-fallback';
import { IMAGE_URL } from '@/lib/image-url-schema';

const VALID_COUPON_TYPES = ['all', 'new_customer', 'repeat', 'limited_time'] as const;
const VALID_DISCOUNT_TYPES = ['fixed', 'percentage', 'special_price'] as const;

// 有効期限は 'YYYY-MM-DD' 形式かつ実在する日付のみ許可（2月30日等の不正日付による DATE 列の 500 を防ぐ）
const COUPON_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です').refine(
  (s) => { const d = new Date(s + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; },
  '日付が不正です',
);

// マイグレーション未適用環境向け：追加カラム（提示条件・画像など）が無い場合に除外して再試行
const COUPON_EXT_KEYS = ['presentation_timing', 'usage_condition', 'search_category1', 'search_category2', 'duration_minutes', 'image_url', 'image_submission'] as const;

const couponSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  coupon_type: z.enum(VALID_COUPON_TYPES).default('all'),
  discount_type: z.enum(VALID_DISCOUNT_TYPES),
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
  image_url: IMAGE_URL.optional().nullable(),
  image_submission: z.boolean().optional(),
  sort_order: z.number().int().min(0).optional(),
}).refine(
  (data) => !(data.discount_type === 'percentage' && data.discount_value != null && data.discount_value > 100),
  { message: 'percentage discount_value must be 0-100', path: ['discount_value'] },
).refine(
  // discount_type 別の必須値（special_price→special_price, fixed/percentage→discount_value）。値欠落クーポンの作成を防ぐ（round3 #05）
  (data) => data.discount_type === 'special_price' ? data.special_price != null : data.discount_value != null,
  { message: '割引種別に対応する金額(special_price または discount_value)が必要です', path: ['discount_value'] },
).refine(
  // 有効期間の前後関係（round3 #17）
  (data) => !(data.valid_from != null && data.valid_until != null && data.valid_from > data.valid_until),
  { message: '有効期限の開始は終了より前にしてください', path: ['valid_until'] },
);

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
  if (inMemoryRateLimit(ip, 30, 60_000, 'coupons-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('coupons')
    .select('*')
    .eq('facility_id', auth.facilityId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  return NextResponse.json({ coupons: data });
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'coupons-create')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = couponSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();
  const insertRow = { facility_id: auth.facilityId, ...parsed.data, is_active: parsed.data.is_active ?? true };
  let { data, error } = await admin.from('coupons').insert(insertRow).select().single();
  if (isMissingColumnError(error)) {
    warnMissingColumnFallback('coupons.insert');
    ({ data, error } = await admin.from('coupons').insert(omitKeys(insertRow, COUPON_EXT_KEYS)).select().single());
  }

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'create',
    tableName: 'coupons',
    recordId: data.id,
    newValues: { name: parsed.data.name, discount_type: parsed.data.discount_type, discount_value: parsed.data.discount_value },
    ipAddress: ip,
    userAgent: ua,
  });

  return NextResponse.json({ coupon: data }, { status: 201 });
}
