/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
const mockMaybeSingle = jest.fn();
const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ select: mockSelect }));
const mockCreateClient = jest.fn(() => ({ from: mockFrom }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => mockCreateClient() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));

import { resolveRegisteredSalon } from '../register-complete';
import { signSalonClaim, SALON_CLAIM_TTL_SECONDS } from '../salon-claim';
import { alertCaughtError } from '../alert';

const VALID_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const originalSecret = process.env.ADMIN_COOKIE_SECRET;
let claim: string;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ADMIN_COOKIE_SECRET = 'receipt-unit-test-only-not-an-operational-key';
  claim = signSalonClaim(VALID_ID)!;
  mockCreateClient.mockImplementation(() => ({ from: mockFrom }));
});
afterAll(() => {
  if (originalSecret === undefined) delete process.env.ADMIN_COOKIE_SECRET;
  else process.env.ADMIN_COOKIE_SECRET = originalSecret;
});

test('only a verified receipt returns database data, never query-string summaries', async () => {
  mockMaybeSingle.mockResolvedValue({ data: { facility_name: '合成施設', business_type: '訪問介護', address: '合成住所' }, error: null });
  expect(await resolveRegisteredSalon(VALID_ID, claim)).toEqual({ status: 'confirmed', id: VALID_ID, name: '合成施設', type: '訪問介護', area: '合成住所' });
  expect(mockFrom).toHaveBeenCalledWith('salons');
  expect(mockSelect).toHaveBeenCalledWith('facility_name, business_type, address');
  expect(mockEq).toHaveBeenCalledWith('id', VALID_ID);
});

test('null optional data does not crash the receipt', async () => {
  mockMaybeSingle.mockResolvedValue({ data: { facility_name: null, business_type: null, address: null }, error: null });
  expect(await resolveRegisteredSalon(VALID_ID, claim)).toEqual({ status: 'confirmed', id: VALID_ID, name: '', type: '', area: '' });
});

test('a valid claim with no row is not a completed registration', async () => {
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  expect(await resolveRegisteredSalon(VALID_ID, claim)).toEqual({ status: 'not_found' });
});

test.each(['missing-id', 'invalid-id', 'missing-cookie', 'invalid-cookie', 'expired', 'future', 'other-id', 'missing-key'])('%s never queries private application data', async (condition) => {
  let id: string | undefined = VALID_ID;
  let cookie: string | undefined = claim;
  if (condition === 'missing-id') id = undefined;
  if (condition === 'invalid-id') id = '<script>invalid</script>';
  if (condition === 'missing-cookie') cookie = undefined;
  if (condition === 'invalid-cookie') cookie = 'not-a-valid-signature';
  if (condition === 'expired') cookie = signSalonClaim(VALID_ID, Math.floor(Date.now() / 1000) - SALON_CLAIM_TTL_SECONDS - 1)!;
  if (condition === 'future') cookie = signSalonClaim(VALID_ID, Math.floor(Date.now() / 1000) + 3600)!;
  if (condition === 'other-id') cookie = signSalonClaim(OTHER_ID)!;
  if (condition === 'missing-key') delete process.env.ADMIN_COOKIE_SECRET;
  expect(await resolveRegisteredSalon(id, cookie)).toEqual({ status: 'unverified' });
  expect(mockCreateClient).not.toHaveBeenCalled();
});

test.each(['error', 'data-and-error', 'reject', 'factory-throw'])('%s is unavailable, not success or not-found, with redacted telemetry', async (condition) => {
  const privateError = new Error('do-not-log-private-provider-body');
  if (condition === 'factory-throw') mockCreateClient.mockImplementationOnce(() => { throw privateError; });
  else if (condition === 'reject') mockMaybeSingle.mockRejectedValueOnce(privateError);
  else mockMaybeSingle.mockResolvedValueOnce({ data: condition === 'data-and-error' ? { facility_name: 'private-data' } : null, error: privateError });
  expect(await resolveRegisteredSalon(VALID_ID, claim)).toEqual({ status: 'unavailable' });
  expect(alertCaughtError).toHaveBeenCalledWith('register-complete', expect.objectContaining({ message: 'Registration receipt lookup unavailable' }), '/register/complete');
});
