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
    const baseRow = registrationListRow.omit({ classification: true, classification_revision: true });
    const rows = z.array(baseRow).max(51).safeParse(result.data);
    if (result.error !== null || !rows.success) return { state: 'unavailable' as const };
    const page = rows.data.slice(0, 50);
    const labels = page.length === 0 ? { data: [], error: null } : await db.from('salon_registration_classifications')
      .select('salon_id,classification,revision').in('salon_id', page.map(row => row.id));
    const parsedLabels = z.array(z.object({ salon_id: z.uuid(), classification: z.enum(['test', 'real', 'unknown']), revision: z.number().int().positive() }).strict()).max(50).safeParse(labels.data);
    if (labels.error !== null || !parsedLabels.success) return { state: 'unavailable' as const };
    const index = new Map(parsedLabels.data.map(label => [label.salon_id, label]));
    if (index.size !== parsedLabels.data.length) return { state: 'unavailable' as const };
    const salons = page.map(row => ({ ...row, classification: index.get(row.id)?.classification ?? null,
      classification_revision: index.get(row.id)?.revision ?? 0 }));
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
