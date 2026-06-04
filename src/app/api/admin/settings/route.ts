import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { isMissingColumnError, omitKeys, warnMissingColumnFallback } from '@/lib/db-fallback';
import { revalidateFacilityById } from '@/lib/revalidate';

// 20260531/20260601 マイグレーションで facility_profiles に追加された拡張カラム。
// 部分適用環境でも保存全失敗にしないため、カラム不在時はこれらを除外して再試行する。
const SETTINGS_EXT_KEYS = [
  'business_hours_text', 'directions', 'remarks', 'payment_other', 'parking_text',
  'owner_name', 'owner_title', 'owner_message', 'genres', 'equipment', 'staff_breakdown',
  'header_photo_url', 'logo_url', 'owner_photo_url', 'design_template', 'design_color',
] as const;

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
  phone: z.string().max(20).optional().nullable(),
  website_url: z.string().url().max(200).optional().nullable().or(z.literal('')),
  seat_count: z.number().int().min(0).max(9999).optional().nullable(),
  staff_count: z.number().int().min(0).max(9999).optional().nullable(),
  parking: z.boolean().optional(),
  credit_card: z.boolean().optional(),
  features: z.array(z.string().max(50)).max(50).optional(),
  regular_holiday: z.string().max(100).optional().nullable(),
  business_hours: z.record(z.string(), businessHoursDaySchema).optional().nullable(),
  booking_auto_confirm: z.boolean().optional(),
  booking_buffer_minutes: z.number().int().min(0).max(120).optional(),
  business_hours_text: z.string().max(200).optional().nullable(),
  directions: z.string().max(500).optional().nullable(),
  remarks: z.string().max(500).optional().nullable(),
  payment_other: z.string().max(100).optional().nullable(),
  parking_text: z.string().max(100).optional().nullable(),
  owner_name: z.string().max(50).optional().nullable(),
  owner_title: z.string().max(50).optional().nullable(),
  owner_message: z.string().max(500).optional().nullable(),
  genres: z.array(z.string().max(50)).max(6).optional(),
  equipment: z.array(z.object({ name: z.string().max(50), count: z.number().int().min(0).max(999) })).max(20).optional().nullable(),
  staff_breakdown: z.array(z.object({ role: z.string().max(50), count: z.number().int().min(0).max(999) })).max(20).optional().nullable(),
  header_photo_url: z.string().max(200000).optional().nullable(),
  logo_url: z.string().max(200000).optional().nullable(),
  owner_photo_url: z.string().max(200000).optional().nullable(),
  design_template: z.string().max(30).optional().nullable(),
  design_color: z.string().max(30).optional().nullable(),
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

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'admin-settings-patch')) {
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

    // 公開ゲート: published にする時のみ「最低限まともな公開リスティング」を必須化する（自己公開運用のため
    // 公開基準を内容面で担保する・神原さん指示）。draft 作成時は緩和済みのため、ここを唯一の必須チェックとする。
    // 必須: 住所(検索ヒット) / 電話(連絡先) / 施設紹介文(description か catch_copy) / メニュー1件(予約) / 写真1枚(視覚)。
    // register でリッチ登録したオーナーは引き継ぎ済みデータで自動的に満たす。素登録のみ内容補完が要る。
    if (parsed.data.status === 'published') {
      const { data: prof, error: profErr } = await admin
        .from('facility_profiles')
        .select('prefecture, city, address, phone, description, catch_copy, main_photo_url')
        .eq('id', auth.facilityId)
        .single();
      if (profErr || !prof) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });

      const missing: string[] = [];
      if (!prof.prefecture || !prof.prefecture.trim()) missing.push('都道府県');
      if (!prof.city || !prof.city.trim()) missing.push('市区町村');
      if (!prof.address || !prof.address.trim()) missing.push('住所');
      if (!prof.phone || !prof.phone.trim()) missing.push('電話番号');
      const hasIntro = (!!prof.description && prof.description.trim().length > 0) || (!!prof.catch_copy && prof.catch_copy.trim().length > 0);
      if (!hasIntro) missing.push('施設紹介文');

      const { count: menuCount, error: menuErr } = await admin
        .from('facility_menus')
        .select('id', { count: 'exact', head: true })
        .eq('facility_id', auth.facilityId);
      if (menuErr) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
      if (!menuCount || menuCount < 1) missing.push('メニュー（1件以上）');

      // 写真: main_photo_url か facility_photos が1件以上
      let hasPhoto = !!prof.main_photo_url && prof.main_photo_url.trim().length > 0;
      if (!hasPhoto) {
        const { count: photoCount, error: photoErr } = await admin
          .from('facility_photos')
          .select('id', { count: 'exact', head: true })
          .eq('facility_id', auth.facilityId);
        if (photoErr) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
        hasPhoto = !!photoCount && photoCount >= 1;
      }
      if (!hasPhoto) missing.push('写真（1枚以上）');

      if (missing.length > 0) {
        return NextResponse.json(
          { error: `公開には次の項目が必要です: ${missing.join('、')}`, missing },
          { status: 400 },
        );
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
    // 公開/非公開トグルを公開ページ(ISR)へ即時反映（facility-status 経路と同様・反映漏れ防止・scale監査）
    await revalidateFacilityById(auth.facilityId);
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
  const updateRow = {
    ...parsed.data,
    website_url: parsed.data.website_url || null,
    updated_at: new Date().toISOString(),
  };
  let { error } = await admin.from('facility_profiles').update(updateRow).eq('id', auth.facilityId);
  if (isMissingColumnError(error)) {
    warnMissingColumnFallback('facility_profiles.settings-update');
    ({ error } = await admin.from('facility_profiles').update(omitKeys(updateRow, SETTINGS_EXT_KEYS)).eq('id', auth.facilityId));
  }

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
  // 施設基本情報・営業時間等は公開ページ表示に反映されるため即時再検証（scale監査）
  await revalidateFacilityById(auth.facilityId);
  return NextResponse.json({ ok: true });
}
