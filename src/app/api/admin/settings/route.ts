import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { checkPublishReadiness } from '@/lib/facility-publish-gate';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const businessHoursDaySchema = z.union([
  z.object({ open: z.string().regex(TIME_REGEX), close: z.string().regex(TIME_REGEX) }),
  z.null(),
]);

const settingsSchema = z.object({
  name: z.string().min(1).max(100),
  business_type: z.string().max(50).optional().nullable(),
  catch_copy: z.string().max(200).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  postal_code: z.string().max(8).optional().nullable(),
  prefecture: z.string().max(20).optional().nullable(),
  city: z.string().max(50).optional().nullable(),
  address: z.string().max(100).optional().nullable(),
  building: z.string().max(100).optional().nullable(),
  access_info: z.string().max(200).optional().nullable(),
  nearest_station: z.string().max(100).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  website_url: z.string().url().max(200).optional().nullable().or(z.literal('')),
  seat_count: z.number().int().min(0).max(9999).optional().nullable(),
  staff_count: z.number().int().min(0).max(9999).optional().nullable(),
  parking: z.boolean().optional(),
  credit_card: z.boolean().optional(),
  features: z.array(z.string().max(50)).max(50).optional(),
  regular_holiday: z.string().max(100).optional().nullable(),
  // キーは曜日（mon〜sun）の7つに限定する。z.record(z.string()) だと任意キーを無制限に
  // 受け付け、巨大な business_hours JSON で行を肥大化させられる（DoS・無意味データ混入）。
  // z.object().partial() は未知キーを既定で strip するため、7曜日以外は保存に乗らない。
  business_hours: z.object({
    mon: businessHoursDaySchema,
    tue: businessHoursDaySchema,
    wed: businessHoursDaySchema,
    thu: businessHoursDaySchema,
    fri: businessHoursDaySchema,
    sat: businessHoursDaySchema,
    sun: businessHoursDaySchema,
  }).partial().optional().nullable(),
  booking_auto_confirm: z.boolean().optional(),
  booking_buffer_minutes: z.number().int().min(0).max(120).optional(),
  // サロンボードの時間軸の区切り幅（分）。15/30/60 のみ（DB CHECK と一致）。
  board_slot_minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
});

const statusSchema = z.object({
  status: z.enum(['draft', 'published', 'suspended']),
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

// PATCH: Update facility settings
export async function PATCH(request: NextRequest) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-settings-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);

  // Check if this is a status-only update
  const action = request.nextUrl.searchParams.get('action');
  if (action === 'status') {
    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });

    const admin = createServiceRoleClient();

    // 公開(published)に切り替える時のみ、必須項目の充足をサーバー側で検証する。
    // 空の施設が検索結果に出て予約ページで行き止まりになる事故を防ぐ
    // （UI が「メニューと写真を登録すると公開できます」と案内する前提条件の実装）。
    if (parsed.data.status === 'published') {
      // 単一公開の必須項目ゲート。チェーン一括公開(bulk-publish)と共通ヘルパで検証を共有する。
      // メニュー件数は公開側の可視条件(is_published null/true)と揃える（HPB 下書きのみで
      // 公開して公開メニュー0件の行き止まりになるのを防ぐ = BP-2）。
      const { readiness, error: gateErr } = await checkPublishReadiness(admin, auth.facilityId);
      if (gateErr) {
        return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
      }
      if (!readiness.ready) {
        return NextResponse.json({ error: '公開するには次の項目が必要です', missing: readiness.missing }, { status: 400 });
      }
    }

    const { error } = await admin
      .from('facility_profiles')
      .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
      .eq('id', auth.facilityId);

    if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

    const { ua } = getRequestContext(request);
    void writeAuditLog({
      userId: auth.userId,
      facilityId: auth.facilityId,
      action: parsed.data.status === 'suspended' ? 'suspend' : parsed.data.status === 'published' ? 'publish' : 'update',
      tableName: 'facility_profiles',
      recordId: auth.facilityId,
      newValues: { status: parsed.data.status },
      ipAddress: ip,
      userAgent: ua,
    });
    return NextResponse.json({ ok: true });
  }

  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  // Validate business hours consistency
  if (parsed.data.business_hours) {
    for (const [day, hours] of Object.entries(parsed.data.business_hours)) {
      if (hours && hours.close <= hours.open) {
        return NextResponse.json({ error: `${day}の閉店時間は開店時間より後にしてください` }, { status: 400 });
      }
    }
  }

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from('facility_profiles')
    .update({
      ...parsed.data,
      website_url: parsed.data.website_url || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', auth.facilityId);

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'update',
    tableName: 'facility_profiles',
    recordId: auth.facilityId,
    newValues: { name: parsed.data.name, booking_auto_confirm: parsed.data.booking_auto_confirm },
    ipAddress: ip,
    userAgent: ua,
  });
  return NextResponse.json({ ok: true });
}
