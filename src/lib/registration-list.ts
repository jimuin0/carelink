import { z } from 'zod';
import type { createServiceRoleClient } from './supabase-server';
import { registrationListInput, registrationListRow, registrationCursorFilter, type RegistrationCursor } from './registration-list-contract';

export async function readRegistrationList(db: ReturnType<typeof createServiceRoleClient>, value: unknown) {
  const parsed = registrationListInput.safeParse(value);
  if (!parsed.success) return { state: 'invalid' as const };
  const input = parsed.data;
  try {
    let query = db.from('salons')
      .select('id,name:facility_name,email,phone,status,created_at,claimed_at,claimed_facility_id,review_revision')
      .order('created_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false });
    if (input.query) {
      const column = { receipt: 'id', facility: 'facility_name', email: 'email' }[input.field];
      query = query.eq(column, input.field === 'receipt' ? input.query.toLowerCase() : input.query);
    }
    if (input.status === 'unknown') query = query.is('status', null);
    else if (input.status !== 'all') query = query.eq('status', input.status);
    if (input.cursor) query = query.or(registrationCursorFilter(input.cursor));
    const result = await query.limit(51);
    const rows = z.array(registrationListRow).max(51).safeParse(result.data);
    if (result.error !== null || !rows.success) return { state: 'unavailable' as const };
    const salons = rows.data.slice(0, 50);
    let nextCursor: RegistrationCursor | null = null;
    if (rows.data.length > 50) {
      const last = salons[salons.length - 1];
      nextCursor = { id: last.id, createdAt: last.created_at };
    }
    return { state: 'confirmed' as const, salons, nextCursor };
  } catch {
    return { state: 'unavailable' as const };
  }
}
