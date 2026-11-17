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

/**
 * 問い合わせ1件の履歴。紐づけて送ったメールに加え、問い合わせに紐づけずに
 * 同じ宛先へ送ったメール（受付以降）も含める。
 *
 * 2026年10月、運営メール画面の「新規作成」で問い合わせ者へ送った続報が contact_id を持たず、
 * 問い合わせの履歴に出なかった（何を送ったかが元の問い合わせから追えない）。
 * 宛先の一致だけで紐づけ先を書き換えることはせず、表示用に読み足すだけにする。
 * 同じ宛先の問い合わせが複数あるときは、どの件のメールか決められないので読み足さない
 * （別件のメールを混ぜるほうが、出ないより誤解を招くため）。
 */
export async function readMailThread(db: DB, id: string, email?: string | null, since?: string | null) {
  const signal = AbortSignal.timeout(8000);
  const recipient = email?.trim().toLowerCase();
  const [messages, replies, unlinked] = await Promise.all([
    readLinked(db, 'platform_mail', '*', [id], platformMailRecordSchema, signal),
    readLinked(db, 'contact_replies', legacyFields, [id], legacyMailReplySchema, signal),
    recipient ? readUnlinkedToRecipient(db, recipient, since ?? null, signal) : Promise.resolve([]),
  ]);
  return { messages: [...messages, ...unlinked], replies };
}

async function readUnlinkedToRecipient(db: DB, recipient: string, since: string | null, signal: AbortSignal) {
  // 宛先は大文字小文字を区別しない。メールに多い「_」は ilike の1文字一致なのでエスケープし、
  // PostgREST の全一致記号（* と %）を含む宛先は読み足さない（別人のメールを混ぜないため）。
  if (/[*%]/.test(recipient)) return [];
  const pattern = recipient.replace(/[\\_]/g, (char) => `\\${char}`);
  const siblings = await db.from('contacts').select('id', { count: 'exact', head: true }).ilike('email', pattern).abortSignal(signal);
  if (siblings.error) throw new Error('MAIL_HISTORY_UNAVAILABLE');
  if (siblings.count !== 1) return [];
  let query = db.from('platform_mail').select('*').is('contact_id', null).ilike('recipient', pattern);
  // 下書きは受付より前に作って後で送ることがある（created_at は送信しても変わらない）。
  // 送信受付済みは accepted_at、未受付は created_at で受付以降かを判断する（MailConsole の時刻表示と同じ）。
  if (since !== null) query = query.or(`accepted_at.gte.${since},and(accepted_at.is.null,created_at.gte.${since})`);
  const result = await query.order('created_at', { ascending: true }).limit(100).abortSignal(signal);
  if (result.error) throw new Error('MAIL_HISTORY_UNAVAILABLE');
  return z.array(platformMailRecordSchema).max(100).parse(result.data);
}
