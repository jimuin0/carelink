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
    for (const key of ['select', 'in', 'order', 'limit', 'gt', 'is', 'ilike', 'gte']) query[key] = jest.fn(() => query);
    query.abortSignal = jest.fn(async () => (pages[table] ?? (table === 'contacts' ? [{ count: 1, error: null }] : [])).shift() ?? { count: 1, error: null });
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

describe('問い合わせに紐づけずに同じ宛先へ送ったメールも履歴に出す', () => {
  const contactAt = '2026-10-23T00:00:00Z';
  const unlinked = { ...mail, id: '22222222-2222-4222-8222-222222222222', contact_id: null, recipient: 'Synthetic_User@example.invalid', state: 'sent' };
  test('受付以降・紐づけ無し・宛先一致（大文字小文字無視、_ はエスケープ）を読み足し、紐づけは書き換えない', async () => {
    const { db, queries } = fixture({ platform_mail: [{ data: [mail], error: null }, { data: [unlinked], error: null }], contact_replies: [{ data: [], error: null }] });
    const result = await readMailThread(db, id, ' Synthetic_User@Example.invalid ', contactAt);
    expect(result.messages).toEqual([mail, unlinked]);
    const extra = queries.find(query => query.is.mock.calls.length > 0)!;
    expect(extra.is).toHaveBeenCalledWith('contact_id', null);
    expect(extra.ilike).toHaveBeenCalledWith('recipient', 'synthetic\\_user@example.invalid');
    expect(extra.gte).toHaveBeenCalledWith('created_at', contactAt);
    expect(extra.limit).toHaveBeenCalledWith(100);
  });
  test('受付日時が無ければ日付で絞らない', async () => {
    const { db, queries } = fixture({ platform_mail: [{ data: [], error: null }, { data: [], error: null }], contact_replies: [{ data: [], error: null }] });
    await readMailThread(db, id, 'a@example.invalid', null);
    expect(queries.find(query => query.is.mock.calls.length > 0)!.gte).not.toHaveBeenCalled();
    await readMailThread(fixture({ platform_mail: [{ data: [], error: null }, { data: [], error: null }], contact_replies: [{ data: [], error: null }] }).db, id, 'a@example.invalid');
  });
  test.each([undefined, null, '', '   '])('宛先が無ければ読み足さない: %p', async email => {
    const { db, from } = fixture({ platform_mail: [{ data: [], error: null }], contact_replies: [{ data: [], error: null }] });
    await readMailThread(db, id, email);
    expect(from).toHaveBeenCalledTimes(2);
  });
  test.each(['a*b@example.invalid', 'a%b@example.invalid'])('全一致記号を含む宛先は別人を混ぜないよう読み足さない: %s', async email => {
    const { db, from } = fixture({ platform_mail: [{ data: [], error: null }], contact_replies: [{ data: [], error: null }] });
    expect((await readMailThread(db, id, email)).messages).toEqual([]);
    expect(from).toHaveBeenCalledTimes(2);
  });
  test.each([0, 2, null])('同じ宛先の問い合わせが1件でなければ（%p件）別件を混ぜないよう読み足さない', async count => {
    const { db, queries } = fixture({ platform_mail: [{ data: [], error: null }], contact_replies: [{ data: [], error: null }], contacts: [{ count, error: null }] } as never);
    expect((await readMailThread(db, id, 'a_b@example.invalid')).messages).toEqual([]);
    const contacts = queries.find(query => query.ilike.mock.calls[0]?.[0] === 'email')!;
    expect(contacts.ilike).toHaveBeenCalledWith('email', 'a\\_b@example.invalid');
    expect(contacts.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(queries.some(query => query.is.mock.calls.length > 0)).toBe(false);
  });
  test('同じ宛先の問い合わせ件数を読めなければ失敗にする', async () => {
    const { db } = fixture({ platform_mail: [{ data: [], error: null }], contact_replies: [{ data: [], error: null }], contacts: [{ count: null, error: { message: 'private' } }] } as never);
    await expect(readMailThread(db, id, 'a@example.invalid')).rejects.toThrow('MAIL_HISTORY_UNAVAILABLE');
  });
  test('読み足しの失敗は空の履歴にせず失敗にする', async () => {
    const { db } = fixture({ platform_mail: [{ data: [], error: null }, { data: null, error: { message: 'private' } }], contact_replies: [{ data: [], error: null }] });
    await expect(readMailThread(db, id, 'a@example.invalid')).rejects.toThrow('MAIL_HISTORY_UNAVAILABLE');
  });
});
