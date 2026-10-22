import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from './supabase-server';
import { serverError } from './with-route';
import { databaseDiagnostic } from './database-diagnostic';
import type { Json } from '@/types/database.types';

const receipt = z.object({ id: z.uuid(), facility_id: z.uuid() }).passthrough();

/**
 * 公開中の施設で、お客様に表示される最後のメニューを非公開にしようとした（削除の 'last_menu' と同じ規則）。
 * 23514 の中でもこの名前の拒否だけを扱う。他の CHECK 違反は従来どおりサーバーエラーとして通知する。
 */
export const LAST_PUBLISHED_MENU_MESSAGE = '公開中は最後の公開メニューを非公開にできません。先に別のメニューを公開するか、施設を非公開にしてください。';
function isLastPublishedMenuRefusal(error: { code?: string; message?: string }): boolean {
  return error.code === '23514' && typeof error.message === 'string' && error.message.includes('MENU_LAST_PUBLISHED');
}

/** The database rechecks and locks current membership with the actual write. */
export async function saveAdminMenu(input: {
  actorId: string; facilityId: string; menuId: string | null; values: Json;
  checkPhoto?: boolean; expectedPhoto?: string | null;
}) {
  const label = input.menuId === null ? 'admin-menus-create' : 'admin-menus-patch';
  let result;
  try {
    result = await createServiceRoleClient().rpc('save_admin_menu_atomic', {
      p_actor_id: input.actorId, p_facility_id: input.facilityId,
      p_menu_id: input.menuId, p_values: input.values,
      p_check_photo: input.checkPhoto ?? false, p_expected_photo: input.expectedPhoto ?? null,
    });
  } catch (error) {
    return serverError(label, databaseDiagnostic(error), '/api/admin/menus');
  }
  if (result.error) {
    if (result.error.code === '42501') return NextResponse.json({ error: '店舗の管理権限を確認してください' }, { status: 403 });
    if (result.error.code === 'P0002') return NextResponse.json({ error: '店舗またはメニューが見つかりません' }, { status: 404 });
    if (result.error.code === '23505') return NextResponse.json({ error: 'メニューが競合しました。一覧を確認してから、もう一度お試しください。' }, { status: 409 });
    if (result.error.code === '40001') return NextResponse.json({ error: 'メニューが変更されました。一覧を再読み込みしてください' }, { status: 409 });
    if (result.error.code === '22023') return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    if (isLastPublishedMenuRefusal(result.error)) return NextResponse.json({ error: LAST_PUBLISHED_MENU_MESSAGE }, { status: 400 });
    return serverError(label, databaseDiagnostic(result.error), '/api/admin/menus');
  }
  const parsed = receipt.safeParse(result.data);
  if (!parsed.success || parsed.data.facility_id !== input.facilityId.toLowerCase()
    || (input.menuId !== null && parsed.data.id !== input.menuId.toLowerCase())) {
    return serverError(label + '-receipt', new Error('MENU_RESULT_INVALID'), '/api/admin/menus');
  }
  return parsed.data;
}
