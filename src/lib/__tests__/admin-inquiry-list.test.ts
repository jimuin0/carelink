import {
  inquiryCursorFilter,
  inquiryListInput,
  parseInquiryTrafficSource,
} from '../admin-inquiry-list-contract';
import { readAdminInquiryList } from '../admin-inquiry-list';

const id = '11111111-1111-4111-8111-111111111111';
const time = '2026-09-26T12:30:40.123456+00:00';
function row(overrides: Record<string, unknown> = {}) {
  return {
    id, created_at: time, name: '合成問い合わせ', email: 'synthetic@example.invalid', phone: null,
    inquiry_type: '施設掲載', message: '合成データです', ticket_status: 'open', priority: 'normal',
    ticket_notes: null, resolved_at: null, traffic_source: null, ...overrides,
  };
}
function dbWith(data: unknown, error: unknown = null) {
  const query = {
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data, error }),
  };
  return { db: { from: jest.fn(() => query) } as never, query };
}

test('defaults to open, strictly validates filters and cursor, and keeps microseconds', () => {
  expect(inquiryListInput.parse({})).toEqual({ status: 'open', cursor: null });
  expect(inquiryListInput.safeParse({ status: 'unexpected' }).success).toBe(false);
  expect(inquiryListInput.safeParse({ extra: true }).success).toBe(false);
  expect(inquiryListInput.safeParse({ cursor: { id, createdAt: 'not-a-time' } }).success).toBe(false);
  expect(inquiryCursorFilter({ id, createdAt: time })).toBe(
    `created_at.lt.${time},and(created_at.eq.${time},id.lt.${id}),created_at.is.null`,
  );
  expect(inquiryCursorFilter({ id, createdAt: null })).toBe(`and(created_at.is.null,id.lt.${id})`);
});

test('valid tracking metadata is returned; malformed optional metadata is omitted safely', () => {
  const valid = { source: 'search', medium: null, referrerHost: null, landingPath: '/contact', capturedAt: '2026-09-26T12:30:40.000Z' };
  expect(parseInquiryTrafficSource(null)).toBeNull();
  expect(parseInquiryTrafficSource(valid)).toEqual(valid);
  expect(parseInquiryTrafficSource({ source: 'search', landingPath: 'not-a-path' })).toBeNull();
});

test('reads bounded pages ordered by timestamp and id, filters status, and returns a cursor', async () => {
  const data = Array.from({ length: 51 }, (_, index) => row({
    id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    traffic_source: index === 0 ? { source: 'search', landingPath: 'bad' } : null,
  }));
  const { db, query } = dbWith(data);
  const result = await readAdminInquiryList(db, { status: 'waiting', cursor: { id, createdAt: time } });
  expect(result.state).toBe('confirmed');
  if (result.state !== 'confirmed') throw new Error('expected confirmed list');
  expect(result.contacts).toHaveLength(50);
  expect(result.contacts[0].traffic_source).toBeNull();
  expect(result.nextCursor).toEqual({ id: result.contacts[49].id, createdAt: time });
  expect(query.order.mock.calls).toEqual([
    ['created_at', { ascending: false, nullsFirst: false }],
    ['id', { ascending: false }],
  ]);
  expect(query.eq).toHaveBeenCalledWith('ticket_status', 'waiting');
  expect(query.or).toHaveBeenCalledWith(expect.stringContaining(`id.lt.${id}`));
  expect(query.limit).toHaveBeenCalledWith(51);
});

test('all-status first page skips filters and returns no cursor for a short page', async () => {
  const { db, query } = dbWith([row()]);
  const result = await readAdminInquiryList(db, { status: 'all', cursor: null });
  expect(result).toEqual({ state: 'confirmed', contacts: [row()], nextCursor: null });
  expect(query.eq).not.toHaveBeenCalled();
  expect(query.or).not.toHaveBeenCalled();
});

test('invalid input, database error, malformed row, null data, and thrown dependency fail closed', async () => {
  const invalid = await readAdminInquiryList(dbWith([]).db, { status: 'deleted' });
  expect(invalid).toEqual({ state: 'invalid' });
  expect(await readAdminInquiryList(dbWith([row()]).db, {})).toMatchObject({ state: 'confirmed' });
  expect(await readAdminInquiryList(dbWith([row()], { message: 'private' }).db, {})).toEqual({ state: 'unavailable', reason: 'database_error' });
  expect(await readAdminInquiryList(dbWith([{ ...row(), ticket_status: 'corrupt' }]).db, {})).toEqual({ state: 'unavailable', reason: 'invalid_rows' });
  expect(await readAdminInquiryList(dbWith(null).db, {})).toEqual({ state: 'unavailable', reason: 'invalid_rows' });
  const throwing = { from: jest.fn(() => { throw new Error('private'); }) } as never;
  expect(await readAdminInquiryList(throwing, {})).toEqual({ state: 'unavailable', reason: 'dependency_exception' });
});
