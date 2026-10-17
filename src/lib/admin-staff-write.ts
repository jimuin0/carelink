import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from './supabase-server';
import { serverError } from './with-route';
import { databaseDiagnostic } from './database-diagnostic';
import type { Json } from '@/types/database.types';

const receipt = z.object({ id: z.uuid(), facility_id: z.uuid() }).passthrough();

/** The database rechecks and locks current membership with the actual write. */
export async function saveAdminStaff(input: {
  actorId: string; facilityId: string; staffId: string; values: Json;
  menuIds: string[] | null;
}) {
  const label = 'admin-staff-patch';
  let result;
  try {
    result = await createServiceRoleClient().rpc('save_admin_staff_atomic', {
      p_actor_id: input.actorId, p_facility_id: input.facilityId,
      p_staff_id: input.staffId, p_values: input.values,
      p_menu_ids: input.menuIds,
    });
  } catch (error) {
    return serverError(label, databaseDiagnostic(error), '/api/admin/staff/[id]');
  }
  if (result.error) {
    if (result.error.code === '42501') return NextResponse.json({ error: '店舗の管理権限を確認してください' }, { status: 403 });
    if (result.error.code === 'P0002') return NextResponse.json({ error: '店舗またはスタッフが見つかりません' }, { status: 404 });
    if (result.error.code === '23505') return NextResponse.json({ error: 'スタッフ設定が競合しました。一覧を確認してください。' }, { status: 409 });
    if (result.error.code === '40001') return NextResponse.json({ error: 'スタッフ設定が変更されました。一覧を再読み込みしてください' }, { status: 409 });
    if (result.error.code === '22023') return NextResponse.json({ error: 'スタッフまたは担当メニューが不正です' }, { status: 400 });
    return serverError(label, databaseDiagnostic(result.error), '/api/admin/staff/[id]');
  }
  const parsed = receipt.safeParse(result.data);
  if (!parsed.success || parsed.data.facility_id !== input.facilityId.toLowerCase()
    || parsed.data.id !== input.staffId.toLowerCase()) {
    return serverError(label + '-receipt', new Error('STAFF_RESULT_INVALID'), '/api/admin/staff/[id]');
  }
  return parsed.data;
}
