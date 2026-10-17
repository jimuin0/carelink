import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceRoleClient } from './supabase-server';
import { serverError } from './with-route';
import { databaseDiagnostic } from './database-diagnostic';
import type { Json } from '@/types/database.types';

const receipt = z.object({ id: z.uuid(), facility_id: z.uuid() }).passthrough();

/** The database rechecks and locks current membership with the actual write. */
export async function manageAdminCustomer(input: {
  actorId: string; facilityId: string; customerId: string | null; action: 'create' | 'update' | 'delete'; values: Json;
}) {
  const label = 'admin-customers-' + input.action;
  let result;
  try {
    result = await createServiceRoleClient().rpc('manage_admin_customer_atomic', {
      p_actor_id: input.actorId, p_facility_id: input.facilityId,
      p_customer_id: input.customerId, p_values: input.values,
      p_action: input.action,
    });
  } catch (error) {
    return serverError(label, databaseDiagnostic(error), '/api/admin/customers');
  }
  if (result.error) {
    if (result.error.code === '42501') return NextResponse.json({ error: '店舗の管理権限を確認してください' }, { status: 403 });
    if (result.error.code === 'P0002') return NextResponse.json({ error: '店舗または顧客が見つかりません' }, { status: 404 });
    if (result.error.code === '23505') return NextResponse.json({ error: 'このメールアドレスの顧客は既に登録されています' }, { status: 409 });
    if (result.error.code === '40001') return NextResponse.json({ error: '顧客情報が変更されました。一覧を再読み込みしてください' }, { status: 409 });
    if (result.error.code === '22023') return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    return serverError(label, databaseDiagnostic(result.error), '/api/admin/customers');
  }
  const parsed = receipt.safeParse(result.data);
  if (!parsed.success || parsed.data.facility_id !== input.facilityId.toLowerCase()
    || (input.customerId !== null && parsed.data.id !== input.customerId.toLowerCase())) {
    return serverError(label + '-receipt', new Error('CUSTOMER_RESULT_INVALID'), '/api/admin/customers');
  }
  return parsed.data;
}
