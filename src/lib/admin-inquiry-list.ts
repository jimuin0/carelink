import { z } from 'zod';
import type { createServiceRoleClient } from './supabase-server';
import {
  inquiryCursorFilter,
  inquiryListInput,
  inquiryListDatabaseRow,
  inquiryListRow,
  parseInquiryTrafficSource,
  type InquiryCursor,
} from './admin-inquiry-list-contract';

const SELECT_FIELDS = 'id,created_at,name,email,phone,inquiry_type,message,ticket_status,priority,ticket_notes,resolved_at,traffic_source';

export async function readAdminInquiryList(db: ReturnType<typeof createServiceRoleClient>, value: unknown) {
  const parsed = inquiryListInput.safeParse(value);
  if (!parsed.success) return { state: 'invalid' as const };
  const input = parsed.data;

  try {
    let query = db.from('contacts')
      .select(SELECT_FIELDS)
      .order('created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false });
    if (input.status !== 'all') query = query.eq('ticket_status', input.status);
    if (input.cursor) query = query.or(inquiryCursorFilter(input.cursor));

    const result = await query.limit(51);
    if (result.error !== null) return { state: 'unavailable' as const, reason: 'database_error' as const };
    const rows = z.array(inquiryListDatabaseRow).max(51).safeParse(result.data);
    if (!rows.success) return { state: 'unavailable' as const, reason: 'invalid_rows' as const };

    const contacts = rows.data.slice(0, 50).map((contact) => inquiryListRow.parse({
      ...contact,
      traffic_source: parseInquiryTrafficSource(contact.traffic_source),
    }));
    let nextCursor: InquiryCursor | null = null;
    if (rows.data.length > 50) {
      const last = contacts[contacts.length - 1];
      nextCursor = { id: last.id, createdAt: last.created_at };
    }
    return { state: 'confirmed' as const, contacts, nextCursor };
  } catch {
    return { state: 'unavailable' as const, reason: 'dependency_exception' as const };
  }
}
