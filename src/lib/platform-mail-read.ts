import { z } from 'zod';
import type { createServiceRoleClient } from './supabase-server';
import { legacyMailReplySchema, mailReplyEvidenceSchema, platformMailRecordSchema } from './platform-mail-contract';

type DB = ReturnType<typeof createServiceRoleClient>;
const legacyFields = 'id,contact_id,author_name,body,is_internal,created_at,sent_at,delivery_abandoned_at';

/** Traverse stable UUID keys; never silently turn the API's row cap into "unreplied". */
async function readLinked<T extends { id: string }>(db: DB, table: 'platform_mail' | 'contact_replies', fields: string,
  ids: string[], schema: z.ZodType<T>, signal: AbortSignal): Promise<T[]> {
  const rows: T[] = [];
  let after: string | null = null;
  while (true) {
    let query = db.from(table).select(fields).in('contact_id', ids).order('id', { ascending: true }).limit(500);
    if (after !== null) query = query.gt('id', after);
    const result = await query.abortSignal(signal);
    if (result.error) throw new Error('MAIL_HISTORY_UNAVAILABLE');
    const page = z.array(schema).max(500).parse(result.data);
    rows.push(...page);
    if (page.length < 500) return rows;
    after = page[page.length - 1].id;
  }
}

export async function readMailReplyEvidence(db: DB, ids: string[]) {
  if (ids.length === 0) return { messages: [], replies: [] };
  const signal = AbortSignal.timeout(8000);
  const [messages, replies] = await Promise.all([
    readLinked(db, 'platform_mail', 'id,contact_id,state,delivery_status', ids, mailReplyEvidenceSchema, signal),
    readLinked(db, 'contact_replies', legacyFields, ids, legacyMailReplySchema, signal),
  ]);
  return { messages, replies };
}

export async function readMailThread(db: DB, id: string) {
  const signal = AbortSignal.timeout(8000);
  const [messages, replies] = await Promise.all([
    readLinked(db, 'platform_mail', '*', [id], platformMailRecordSchema, signal),
    readLinked(db, 'contact_replies', legacyFields, [id], legacyMailReplySchema, signal),
  ]);
  return { messages, replies };
}
