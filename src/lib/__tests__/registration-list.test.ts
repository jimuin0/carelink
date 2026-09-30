/** @jest-environment node */
import { readRegistrationList } from '../registration-list';
import { registrationCursorFilter, registrationListInput } from '../registration-list-contract';
const id = '74000000-0000-4000-8000-000000000001';
const time = '2026-09-26T12:30:40.123456+00:00';
const row = { id, name: 'Synthetic', email: 'Synthetic@example.invalid', phone: null,
  status: null, created_at: time, claimed_at: null, claimed_facility_id: null, review_revision: 0 };
const chain = { select: jest.fn(), order: jest.fn(), eq: jest.fn(), is: jest.fn(), or: jest.fn(), limit: jest.fn() };
const from = jest.fn(() => chain);
const db = { from } as unknown as Parameters<typeof readRegistrationList>[0];
beforeEach(() => {
  jest.clearAllMocks();
  for (const method of ['select', 'order', 'eq', 'is', 'or'] as const) chain[method].mockReturnValue(chain);
  chain.limit.mockResolvedValue({ data: [row], error: null });
});
test.each([null, { extra: true }, { field: 'receipt', query: 'not-uuid' },
  { field: 'facility', query: 'a'.repeat(201) }, { query: 'a\0b' },
  { cursor: { createdAt: '2026-01-01', id } }, { cursor: { createdAt: time, id: 'x),id.gt.0' } },
  { query: 'a'.repeat(255) }, { status: 'anything' }])('invalid input cannot reach database %#', async input => {
  expect(await readRegistrationList(db, input)).toEqual({ state: 'invalid' });
  expect(from).not.toHaveBeenCalled();
});
test('defaults, explicit projection and deterministic null-last ordering', async () => {
  expect(await readRegistrationList(db, {})).toEqual({ state: 'confirmed', salons: [row], nextCursor: null });
  expect(from).toHaveBeenCalledWith('salons');
  expect(chain.select).toHaveBeenCalledWith('id,name:facility_name,email,phone,status,created_at,claimed_at,claimed_facility_id,review_revision');
  expect(chain.order.mock.calls).toEqual([['created_at', { ascending: false, nullsFirst: false }], ['id', { ascending: false }]]);
  expect(chain.limit).toHaveBeenCalledWith(51);
  expect(chain.eq).not.toHaveBeenCalled();
});
test.each([
  ['receipt', '74000000-0000-4000-8000-0000000000AB', 'id', '74000000-0000-4000-8000-0000000000ab'],
  ['facility', '  Synthetic,or.(id.gt.0)  ', 'facility_name', 'Synthetic,or.(id.gt.0)'],
  ['email', ' Synthetic.Name+tag@GoogleMail.com ', 'email', 'Synthetic.Name+tag@GoogleMail.com'],
])('exact %s search uses eq and does not interpolate operator text', async (field, query, column, expected) => {
  expect((await readRegistrationList(db, { field, query })).state).toBe('confirmed');
  expect(chain.eq).toHaveBeenCalledWith(column, expected);
  expect(chain.or).not.toHaveBeenCalled();
});
test.each(['pending', 'approved', 'rejected'])('status %s is an explicit filter', async status => {
  await readRegistrationList(db, { status }); expect(chain.eq).toHaveBeenCalledWith('status', status);
});
test('unknown status means NULL only; legacy statuses remain displayable', async () => {
  chain.limit.mockResolvedValue({ data: [{ ...row, status: 'legacy-state', created_at: null }], error: null });
  expect((await readRegistrationList(db, { status: 'unknown', cursor: { createdAt: null, id } })).state).toBe('confirmed');
  expect(chain.is).toHaveBeenCalledWith('status', null);
  expect(chain.or).toHaveBeenCalledWith(`and(created_at.is.null,id.lt.${id})`);
});
test('timestamp cursor retains microseconds and includes the NULL tail', async () => {
  await readRegistrationList(db, { cursor: { createdAt: time, id } });
  expect(chain.or).toHaveBeenCalledWith(`created_at.lt.${time},and(created_at.eq.${time},id.lt.${id}),created_at.is.null`);
  expect(() => registrationCursorFilter({ createdAt: time, id: 'x),id.gt.0' })).toThrow();
});
test.each([time, null])('51-row lookahead uses last visible row, including NULL %#', async createdAt => {
  const rows = Array.from({ length: 51 }, (_, index) => ({ ...row,
    id: `74000000-0000-4000-8000-${String(100 - index).padStart(12, '0')}`, created_at: createdAt }));
  chain.limit.mockResolvedValue({ data: rows, error: null });
  expect(await readRegistrationList(db, {})).toEqual({ state: 'confirmed', salons: rows.slice(0, 50),
    nextCursor: { id: rows[49].id, createdAt } });
});
test('exactly 50 and zero rows have no next page', async () => {
  for (const count of [0, 50]) {
    chain.limit.mockResolvedValue({ data: Array(count).fill(row), error: null });
    expect(await readRegistrationList(db, {})).toEqual({ state: 'confirmed', salons: Array(count).fill(row), nextCursor: null });
  }
});
test.each([null, {}, [{}], [{ ...row, email: null }], [{ ...row, created_at: 'broken' }],
  [{ ...row, secret: 'must-not-return' }], Array(52).fill(row)])('malformed DB data is not successful empty data %#', async data => {
  chain.limit.mockResolvedValue({ data, error: null });
  expect(await readRegistrationList(db, {})).toEqual({ state: 'unavailable' });
});
test('provider failure with data, missing error field and thrown private values are unavailable', async () => {
  for (const result of [{ data: [row], error: { message: 'PRIVATE' } }, { data: [row] }]) {
    chain.limit.mockResolvedValue(result);
    expect(await readRegistrationList(db, {})).toEqual({ state: 'unavailable' });
  }
  chain.limit.mockRejectedValue(new Error('PRIVATE'));
  expect(await readRegistrationList(db, {})).toEqual({ state: 'unavailable' });
});
test('blank receipt search is deliberately all receipts, not malformed UUID', () => {
  expect(registrationListInput.parse({ field: 'receipt', query: ' ' }).query).toBe('');
});
