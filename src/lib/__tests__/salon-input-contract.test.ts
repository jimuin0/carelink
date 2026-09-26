import { salonFullSchema, salonInsertSchema } from '../validations';
import { businessTypes, DESIRED_START_DATES } from '../constants';
import { salonFieldErrors, isSalonField, SALON_FIELD_MESSAGES } from '../salon-field-errors';
import { readSalonRegistrationResult } from '../salon-registration-delivery';

const base = { facility_name: '合成施設', business_type: 'ヘアサロン', representative_name: '合成代表', contact_name: '合成担当', email: 'fixture@example.invalid', phone: '09012345678' };
const body = { ...base, source: 'register' };

test.each(businessTypes)('both UI and API accept the same category %s', (business_type) => {
  expect(salonFullSchema.safeParse({ ...base, business_type }).success).toBe(true);
  expect(salonInsertSchema.safeParse({ ...body, business_type }).success).toBe(true);
});
test.each(DESIRED_START_DATES)('both UI and API accept start preference %s', (desired_start_date) => {
  expect(salonFullSchema.safeParse({ ...base, desired_start_date }).success).toBe(true);
  expect(salonInsertSchema.safeParse({ ...body, desired_start_date }).success).toBe(true);
});
test.each(['website', 'postal_code', 'address', 'building_name', 'nearest_station', 'business_hours', 'regular_holiday', 'pr_text', 'desired_start_date'])('%s accepts omitted, empty and serialized null optional values', (field) => {
  for (const value of [undefined, '', null]) expect(salonInsertSchema.safeParse({ ...body, [field]: value }).success).toBe(true);
});
test.each(['seat_count', 'staff_count'])('%s preserves zero and bounds, rejects fractions and strings', (field) => {
  for (const value of [undefined, null, 0, 9999]) expect(salonInsertSchema.safeParse({ ...body, [field]: value }).success).toBe(true);
  for (const value of [-1, 10000, 1.5, '', '0', NaN]) expect(salonInsertSchema.safeParse({ ...body, [field]: value }).success).toBe(false);
  expect(salonFullSchema.safeParse({ ...base, [field]: NaN }).success).toBe(true);
  expect(salonInsertSchema.safeParse(JSON.parse(JSON.stringify({ ...body, [field]: NaN }))).success).toBe(true);
});
test('shared field constraints trim required names and strip unknown privilege fields', () => {
  const parsed = salonInsertSchema.parse({ ...body, facility_name: ' 合成施設 ', is_public: true, owner_id: 'not-allowed' });
  expect(parsed.facility_name).toBe('合成施設');
  expect(parsed).not.toHaveProperty('is_public');
  expect(parsed).not.toHaveProperty('owner_id');
  expect(salonInsertSchema.safeParse({ ...body, facility_name: ' ' }).success).toBe(false);
  expect(salonInsertSchema.safeParse({ ...body, business_type: 'unknown-category' }).success).toBe(false);
});
test('URL, postal and photo boundaries are enforced before persistence', () => {
  for (const website of ['not-a-url', 'https://example.invalid/' + 'x'.repeat(2000)]) expect(salonInsertSchema.safeParse({ ...body, website }).success).toBe(false);
  expect(salonInsertSchema.safeParse({ ...body, postal_code: '123-4567' }).success).toBe(true);
  expect(salonInsertSchema.safeParse({ ...body, postal_code: '123' }).success).toBe(false);
  expect(salonInsertSchema.safeParse({ ...body, photo_urls: Array(7).fill('https://example.invalid/photo') }).success).toBe(true);
  expect(salonInsertSchema.safeParse({ ...body, photo_urls: Array(8).fill('https://example.invalid/photo') }).success).toBe(false);
});
test('field error projection excludes raw input, unknown and prototype keys', () => {
  expect(salonFieldErrors([{ path: ['website'] }, { path: ['features', 0] }, { path: ['__proto__'] }, { path: ['source'] }, { path: [] }])).toEqual({ website: SALON_FIELD_MESSAGES.website, features: SALON_FIELD_MESSAGES.features });
  expect(isSalonField('constructor')).toBe(false);
  expect(isSalonField(null)).toBe(false);
});
test('client accepts only known field keys and fixed public messages', async () => {
  const response = { status: 400, ok: false, json: async () => ({ error: '入力内容を確認してください', fieldErrors: { website: 'untrusted-response-value', constructor: 'not-a-field' } }) } as Response;
  expect(await readSalonRegistrationResult(response)).toEqual({ kind: 'rejected', message: '入力内容を確認してください', fieldErrors: { website: SALON_FIELD_MESSAGES.website } });
});
