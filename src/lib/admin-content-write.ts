import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from './supabase-server';
import { serverError } from './with-route';
import { databaseDiagnostic } from './database-diagnostic';
import type { Json } from '@/types/database.types';

const receipt = z.object({ id: z.uuid(), facility_id: z.uuid() }).passthrough();

/** The database rechecks and locks current membership with the actual write. */
export async function manageAdminContent(input: {
  actorId: string; facilityId: string; recordId: string | null; kind: 'catalog:update' | 'catalog:delete' | 'job:update' | 'job:delete' | 'catalog:create' | 'blog:create' | 'blog:update' | 'blog:delete' | 'qa:answer' | 'qa:toggle' | 'qa:delete' | 'job:create'; values: Json;
}) {
  const label = 'admin-content-' + input.kind;
  let result;
  try {
    result = await createServiceRoleClient().rpc('manage_admin_content_atomic', {
      p_actor_id: input.actorId, p_facility_id: input.facilityId,
      p_record_id: input.recordId, p_values: input.values,
      p_kind: input.kind,
    });
  } catch (error) {
    return serverError(label, databaseDiagnostic(error), '/api/admin');
  }
  if (result.error) {
    // 権限不足として 403 にするのは RPC が自ら投げた拒否（CONTENT_FORBIDDEN）だけ。関数の実行権限の設定ミスなど
    // 同じ 42501 の別原因は、利用者の権限不足に見せずサーバーエラーとして通知する（中 A43）。
    if (result.error.code === '42501' && result.error.message === 'CONTENT_FORBIDDEN') return NextResponse.json({ error: '店舗の管理権限を確認してください' }, { status: 403 });
    if (result.error.code === 'P0002') return NextResponse.json({ error: '対象のデータが見つかりません' }, { status: 404 });
    if (result.error.code === '23505') return NextResponse.json({ error: 'データが競合しました。一覧を確認してください' }, { status: 409 });
    if (result.error.code === '40001') return NextResponse.json({ error: 'データが変更されました。一覧を再読み込みしてください' }, { status: 409 });
    if (result.error.code === '22023') return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    return serverError(label, databaseDiagnostic(result.error), '/api/admin');
  }
  const parsed = receipt.safeParse(result.data);
  if (!parsed.success || parsed.data.facility_id !== input.facilityId.toLowerCase()
    || (input.recordId !== null && parsed.data.id !== input.recordId.toLowerCase())) {
    return serverError(label + '-receipt', new Error('CONTENT_RESULT_INVALID'), '/api/admin');
  }
  return parsed.data;
}
