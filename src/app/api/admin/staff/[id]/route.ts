import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { z } from 'zod';
import { UUID_REGEX } from '@/lib/constants';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { writeAuditLog, getRequestContext } from '@/lib/audit-logger';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';

const staffUpdateSchema = z.object({
  name: z.string().min(1).max(50),
  position: z.string().max(50).optional().nullable(),
  bio: z.string().max(500).optional().nullable(),
  specialties: z.array(z.string().max(50)).max(20).optional(),
  years_experience: z.number().int().min(0).max(99).optional().nullable(),
  instagram_url: z.string().url().max(200).optional().nullable().or(z.literal('')),
  nomination_fee: z.number().int().min(0).max(99999).optional(),
  line_works_channel_id: z.string().max(50).optional().nullable(),
  line_works_notify_all: z.boolean().optional(),
  // 在籍/休止（false=休止）。退職者を物理削除せず休止にして公開ページ・予約枠・指名から外す。
  // 予約履歴の参照は保持したいので DELETE でなく is_active フラグで運用する。
  is_active: z.boolean().optional(),
  // 【2026年7月15日 HPB準拠仕様】担当メニュー(menu_staff)。undefined＝今回は同期しない・
  // 空配列＝担当制解除（このスタッフの担当行を全削除）・非空＝delete→insert で置換。
  // coupon の target_menu_ids（#479）と同型。
  menu_ids: z.array(z.string().uuid()).max(200).optional(),
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

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(null, ip, 20, 60_000, 'admin-staff-patch')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  if (!UUID_REGEX.test(params.id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });

  const auth = await getAdminInfo(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = staffUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'リクエストが不正です', details: parsed.error.flatten() }, { status: 400 });

  const admin = createServiceRoleClient();

  // 【2026年7月15日 HPB準拠仕様】担当メニュー(menu_staff)の同期対象を分離する。
  // menu_ids は staff_profiles の列ではない（menu_staff へ delete→insert で同期）ため
  // update payload から外す。他施設メニューID注入を防ぐため、指定があれば自施設の
  // facility_menus に全て実在することを先に検証する（fail-closed で 400）。
  const menuIds = parsed.data.menu_ids;
  if (menuIds && menuIds.length > 0) {
    const { data: menuRows, error: menuErr } = await admin
      .from('facility_menus')
      .select('id')
      .in('id', menuIds)
      .eq('facility_id', auth.facilityId);
    if (menuErr) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    const validIds = new Set((menuRows ?? []).map((r: { id: string }) => r.id));
    if (!menuIds.every((id) => validIds.has(id))) {
      return NextResponse.json({ error: '担当メニューが不正です' }, { status: 400 });
    }
  }

  // is_active は指定された時のみ更新する。未指定の通常編集で在籍状態を勝手に戻さない
  // （休止中スタッフの名前だけ直す等で意図せず再在籍化するのを防ぐ）。
  const updateFields: Record<string, unknown> = {
    name: parsed.data.name,
    position: parsed.data.position ?? null,
    bio: parsed.data.bio ?? null,
    specialties: parsed.data.specialties ?? [],
    years_experience: parsed.data.years_experience ?? null,
    instagram_url: parsed.data.instagram_url || null,
    nomination_fee: parsed.data.nomination_fee ?? 0,
    line_works_channel_id: parsed.data.line_works_channel_id ?? null,
    line_works_notify_all: parsed.data.line_works_notify_all ?? false,
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.is_active !== undefined) updateFields.is_active = parsed.data.is_active;
  const { data, error } = await admin
    .from('staff_profiles')
    .update(updateFields)
    .eq('id', params.id)
    .eq('facility_id', auth.facilityId)
    .select()
    // .maybeSingle(): 該当0行（他施設のスタッフ/存在しないid）を not found として扱う。.single() だと
    // 0行→PGRST116で if(error)→500 が先に発火し if(!data)→404 が到達不能になる（500に化ける）。
    .maybeSingle();

  if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'スタッフが見つかりません' }, { status: 404 });

  // 担当メニュー(menu_staff)の同期。undefined＝今回は触らない。空配列＝担当制解除（このスタッフの
  // 担当行を全削除）。非空＝delete→insert で置換。#479（クーポン対象メニュー同期）の教訓を最初から
  // 適用＝insert 失敗を無音にせず、その成否を明示チェックして Sentry＋Slack で顕在化し、具体的な
  // 500 メッセージを返す。delete 済み・insert 失敗＝このスタッフの担当が消えた状態で、当該スタッフ
  // のみが担当していたメニューは menu_staff 0 行＝全スタッフ対応に開放されてしまう（意図しない
  // 担当制の緩和）。管理者に再保存を促す。
  if (menuIds !== undefined) {
    const { error: delErr } = await admin.from('menu_staff').delete().eq('staff_id', params.id);
    if (delErr) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    if (menuIds.length > 0) {
      const { error: insErr } = await admin
        .from('menu_staff')
        .insert(menuIds.map((menuId) => ({ menu_id: menuId, staff_id: params.id })));
      if (insErr) {
        const syncFailure = new Error(
          `staff menu_staff sync failed: staff_id=${params.id} の担当メニューが消えた状態で残存の可能性 ` +
          `(このスタッフのみ担当だったメニューは全スタッフ対応に開放されます) (insert: ${insErr.message})`
        );
        safeCaptureException(syncFailure, 'admin-staff-menu-sync');
        alertCaughtError('admin-staff-menu-sync', syncFailure, '/api/admin/staff/[id]');
        return NextResponse.json({
          error: '担当メニューの保存に失敗しました。このスタッフの担当メニュー設定が未反映のままになっている可能性があります。至急このスタッフの担当メニューを設定し直してください。',
        }, { status: 500 });
      }
    }
  }

  const { ua } = getRequestContext(request);
  void writeAuditLog({
    userId: auth.userId,
    facilityId: auth.facilityId,
    action: 'update',
    tableName: 'staff_profiles',
    recordId: params.id,
    newValues: {
      name: parsed.data.name,
      position: parsed.data.position ?? null,
      nomination_fee: parsed.data.nomination_fee ?? 0,
      ...(menuIds !== undefined ? { menu_ids: menuIds } : {}),
    },
    ipAddress: ip,
    userAgent: ua,
  });
  return NextResponse.json({ staff: data });
}
