import { readMailReplyEvidence, readMailThread } from '../platform-mail-read';
const id = '11111111-1111-4111-8111-111111111111', at = '2026-10-26T00:00:00Z';
const evidence = { id, contact_id: id, state: 'draft', delivery_status: null };
const mail = { ...evidence, revision: 1, recipient: 'synthetic@example.invalid', subject: '合成件名', body: '本文',
  scheduled_at: null, reserved_at: null, accepted_at: null, provider_message_id: null, envelope: null, created_at: at, updated_at: at };
const reply = { id, contact_id: id, body: '旧返信', author_name: '運営', is_internal: false, sent_at: at, created_at: at, delivery_abandoned_at: null };
function fixture(pages: Record<string, { data: unknown; error: unknown }[]>) {
  const queries: Record<string, jest.Mock>[] = [];
  const db = { from: jest.fn((table: string) => {
    const query: Record<string, jest.Mock> = {};
    for (const key of ['select', 'in', 'order', 'limit', 'gt']) query[key] = jest.fn(() => query);
    query.abortSignal = jest.fn(async () => pages[table].shift());
    queries.push(query); return query;
  }) };
  return { db: db as never, queries, from: db.from };
}
test('empty contact list cannot query the whole mailbox', async () => {
  const { db, from } = fixture({}); expect(await readMailReplyEvidence(db, [])).toEqual({ messages: [], replies: [] }); expect(from).not.toHaveBeenCalled();
});
test('summaries use linked contact IDs and omit transport envelopes', async () => {
  const { db, queries } = fixture({ platform_mail: [{ data: [evidence], error: null }], contact_replies: [{ data: [reply], error: null }] });
  expect(await readMailReplyEvidence(db, [id])).toEqual({ messages: [evidence], replies: [reply] });
  expect(queries[0].select).toHaveBeenCalledWith('id,contact_id,state,delivery_status');
  for (const query of queries) { expect(query.in).toHaveBeenCalledWith('contact_id', [id]); expect(query.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal)); }
});
test('thread returns validated messages and legacy replies without unrelated private fields', async () => {
  const { db } = fixture({ platform_mail: [{ data: [{ ...mail, created_by: 'private' }], error: null }], contact_replies: [{ data: [{ ...reply, author_id: 'private', delivery_envelope: {} }], error: null }] });
  expect(await readMailThread(db, id)).toEqual({ messages: [mail], replies: [reply] });
});
test('a full page traverses the next UUID key rather than silently truncating evidence', async () => {
  const rows = Array.from({ length: 500 }, (_, index) => ({ ...evidence, id: '11111111-1111-4111-8111-' + String(index).padStart(12, '0') }));
  const { db, queries } = fixture({ platform_mail: [{ data: rows, error: null }, { data: [{ ...evidence, state: 'sent' }], error: null }], contact_replies: [{ data: [], error: null }] });
  const result = await readMailReplyEvidence(db, [id]); expect(result.messages).toHaveLength(501);
  expect(queries[2].gt).toHaveBeenCalledWith('id', rows[499].id);
  expect(queries[2].abortSignal.mock.calls[0][0]).toBe(queries[0].abortSignal.mock.calls[0][0]);
});
test.each(['platform_mail', 'contact_replies'])('dependency errors do not become empty history: %s', async table => {
  const pages = { platform_mail: [{ data: [], error: null as unknown }], contact_replies: [{ data: [], error: null as unknown }] };
  pages[table as keyof typeof pages][0].error = { message: 'private' };
  await expect(readMailThread(fixture(pages).db, id)).rejects.toThrow('MAIL_HISTORY_UNAVAILABLE');
});
test.each([null, [{}], Array.from({ length: 501 }, () => evidence)])('malformed/oversized result is an error: %j', async data => {
  const { db } = fixture({ platform_mail: [{ data, error: null }], contact_replies: [{ data: [], error: null }] });
  await expect(readMailReplyEvidence(db, [id])).rejects.toThrow();
});
