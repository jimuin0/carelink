import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { checkRateLimit, mutationRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { withRoute } from '@/lib/with-route';
import { isAllowedStorageUrl } from '@/lib/storage-url-guard';

export const dynamic = 'force-dynamic';

// -----------------------------------------------------------------------------
// POST /api/salons : 施設掲載の唯一の登録経路（service_role でサーバ挿入）。
//
// 【背景・恒久対策】
//   従来はクライアントが anon キーで salons へ直接 INSERT していた。anon キーは
//   公開JSに含まれ誰でも入手できるため、RLS の anon INSERT ポリシーが開いている限り
//   reCAPTCHA / rate-limit / サーバ検証を一切経由しない無制限投入が可能だった
//   （発症前の構造的脆弱性）。本 API に集約し、対応する anon INSERT ポリシーを
//   DB から DROP することで「サーバを通さない投入」を物理的に不能化する。
//
// 【検証方針】
//   サーバを権威（authoritative）とする。register（全項目）と recruit（部分項目）の
//   両ページが送る項目の和集合を受理し、未送出項目は null 化して挿入する。
//   写真URLは Supabase Storage 公開バケットの自プレフィックス以外を拒否し、
//   任意URL混入（保存型の不正データ）を封じる。
// -----------------------------------------------------------------------------

const phoneField = z.string().min(1).max(20).regex(/^[\d-]+$/, '正しい電話番号を入力してください');

const salonInsertSchema = z.object({
  facility_name: z.string().min(1).max(200),
  business_type: z.string().min(1).max(50),
  representative_name: z.string().min(1).max(100),
  contact_name: z.string().min(1).max(100),
  email: z.string().email().max(254),
  phone: phoneField,
  contact_phone: z.string().max(20).regex(/^[\d-]*$/).optional().nullable(),
  website: z.string().max(2000).url().or(z.literal('')).optional().nullable(),
  postal_code: z.string().max(8).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  building_name: z.string().max(200).optional().nullable(),
  nearest_station: z.string().max(200).optional().nullable(),
  business_hours: z.string().max(200).optional().nullable(),
  regular_holiday: z.string().max(200).optional().nullable(),
  seat_count: z.number().int().min(0).max(9999).optional().nullable(),
  staff_count: z.number().int().min(0).max(9999).optional().nullable(),
  has_parking: z.boolean().optional(),
  features: z.array(z.string().max(50)).max(20).optional(),
  pr_text: z.string().max(1000).optional().nullable(),
  photo_url: z.string().max(2000).optional().nullable(),
  photo_urls: z.array(z.string().max(2000)).max(7).optional(),
  desired_start_date: z.string().max(50).optional().nullable(),
});

// GET（匿名・認証なし）で返してよい公開安全カラムのみ。
// email / phone / contact_phone / contact_name / representative_name（登録者PII）と
// is_public / status / desired_start_date（内部情報）は select('*') だと匿名露出するため除外。
const PUBLIC_SALON_COLUMNS =
  'id, facility_name, business_type, address, building_name, nearest_station, ' +
  'business_hours, regular_holiday, seat_count, staff_count, has_parking, ' +
  'features, pr_text, photo_url, photo_urls, website, postal_code, created_at';

// Supabase Storage 公開バケットの自プレフィックスのみ許可（任意URL混入を拒否）。
// review/route.ts と共通のヘルパー（src/lib/storage-url-guard.ts）を使う。
function isAllowedPhotoUrl(url: string): boolean {
  return isAllowedStorageUrl(url, 'carelink-uploads');
}

export const POST = withRoute(async (request) => {
  const body = await request.json().catch(() => null);
  const parsed = salonInsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '入力内容が不正です' }, { status: 400 });
  }
  const d = parsed.data;

  // 写真URLの出所検証（自Storage公開URL以外は拒否）
  const photoUrls = (d.photo_urls ?? []).filter((u) => u.length > 0);
  if (photoUrls.some((u) => !isAllowedPhotoUrl(u))) {
    return NextResponse.json({ error: '不正な写真URLです' }, { status: 400 });
  }
  if (d.photo_url && !isAllowedPhotoUrl(d.photo_url)) {
    return NextResponse.json({ error: '不正な写真URLです' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .from('salons')
    .insert({
      facility_name: d.facility_name,
      business_type: d.business_type,
      representative_name: d.representative_name,
      contact_name: d.contact_name,
      email: d.email,
      phone: d.phone,
      contact_phone: d.contact_phone || null,
      website: d.website || null,
      postal_code: d.postal_code || null,
      address: d.address || null,
      building_name: d.building_name || null,
      nearest_station: d.nearest_station || null,
      business_hours: d.business_hours || null,
      regular_holiday: d.regular_holiday || null,
      // seat_count / staff_count は JSON 経由のため NaN は到達不能（zod が int 範囲を検証済み）。
      seat_count: d.seat_count ?? null,
      staff_count: d.staff_count ?? null,
      has_parking: d.has_parking ?? false,
      features: d.features ?? [],
      pr_text: d.pr_text || null,
      photo_url: photoUrls[0] || null,
      photo_urls: photoUrls,
      desired_start_date: d.desired_start_date || null,
    })
    .select('id')
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: '送信に失敗しました。時間をおいて再度お試しください。' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, id: data.id });
}, {
  csrf: true,
  rateLimit: { limiter: mutationRateLimit, limit: 5, windowMs: 60_000, prefix: 'salon-register' },
  sentryTag: 'salons',
});

export async function GET(req: NextRequest) {
  try {
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 20, 60_000, 'salons')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const supabase = createServerSupabaseClient();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    const { data, error } = await supabase
      .from('salons')
      .select(PUBLIC_SALON_COLUMNS)
      .eq('id', id)
      .eq('is_public', true)
      .single();
    if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(data);
  }

  let query = supabase
    .from('salons')
    .select(PUBLIC_SALON_COLUMNS)
    .eq('is_public', true)
    .order('created_at', { ascending: false });

  const businessType = searchParams.get('business_type');
  if (businessType) query = query.eq('business_type', businessType);

  const area = searchParams.get('area')?.trim().slice(0, 100);
  if (area) {
    const escaped = area.replace(/[%_\\]/g, '\\$&');
    query = query.ilike('address', `%${escaped}%`);
  }

  query = query.limit(50);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'データの取得に失敗しました' }, { status: 500 });
  return NextResponse.json(data || []);
  } catch (e) {
    safeCaptureException(e, 'salons');
    alertCaughtError('salons', e, '/api/salons');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
