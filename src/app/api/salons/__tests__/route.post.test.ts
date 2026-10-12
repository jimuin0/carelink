/** @jest-environment node */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({ mutationRateLimit: null, checkRateLimit: jest.fn(async () => false) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
import { POST } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { readSalonRegistrationResult } from '@/lib/salon-registration-delivery';
const request = (body: string) => new Request('http://localhost/api/salons', { method: 'POST', body });
beforeEach(() => { jest.clearAllMocks(); (checkCsrf as jest.Mock).mockReturnValue(null); (checkRateLimit as jest.Mock).mockResolvedValue(false); });
test.each(['{}','null','invalid json',JSON.stringify({ facility_name:'Synthetic',consent:{terms_agreed:true,license_warranted:true} })])('V1 request %s cannot create a registration or certify earlier absence', async body => {
 const response = await POST(request(body) as never); expect(response.status).toBe(409);
 expect(response.headers.get('Cache-Control')).toBe('no-store');
 expect(await readSalonRegistrationResult(response)).toEqual({kind:'unknown'});
 expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test('CSRF still stops before handling legacy input', async () => {
 (checkCsrf as jest.Mock).mockReturnValue(new Response(null,{status:403}));
 expect((await POST(request('{}') as never)).status).toBe(403); expect(createServiceRoleClient).not.toHaveBeenCalled();
});
test('rate limit still stops legacy traffic', async () => {
 (checkRateLimit as jest.Mock).mockResolvedValue(true);
 expect((await POST(request('{}') as never)).status).toBe(429); expect(createServiceRoleClient).not.toHaveBeenCalled();
});
