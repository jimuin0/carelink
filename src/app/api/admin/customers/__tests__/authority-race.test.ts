/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { NextRequest } from 'next/server';
const actor = '33333333-3333-4333-8333-333333333333';
const facility = '22222222-2222-4222-8222-222222222222';
const menu = '11111111-1111-4111-8111-111111111111';
const mockRpc = jest.fn();
const mockWrite = jest.fn();
jest.mock('@/lib/admin-api-context', () => ({ getAdminApiContext: async () => ({ userId: actor, facilityId: facility }) }));
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => false }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: () => null }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn(), getRequestContext: () => ({ ua: null }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ rpc: mockRpc, from: () => {
  let writing = false;
  const value = () => ({ data: writing ? { id: menu, facility_id: facility } : null, error: null, count: 0 });
  const chain: any = { select: () => chain, eq: () => chain, neq: () => chain,
    insert: () => { writing = true; mockWrite(); return chain; },
    update: () => { writing = true; mockWrite(); return chain; },
    delete: () => { writing = true; mockWrite(); return chain; },
    maybeSingle: async () => value(), single: async () => value(),
    then: (resolve: (v: unknown) => void) => resolve(value()) };
  return chain;
} }) }));
import { POST } from '../route';
import { PATCH, DELETE } from '../[id]/route';
import { writeAuditLog } from '@/lib/audit-logger';
beforeEach(() => { jest.clearAllMocks(); mockRpc.mockResolvedValue({ data: null, error: { code: '42501' } }); });
test.each(['POST','PATCH','DELETE'])('%s rejects permission revoked after the HTTP gate', async method => {
 const request = new NextRequest('http://localhost/api/admin/customers?facility_id='+facility, {method,body:JSON.stringify({name:'Allowed before revocation'}),headers:{'Content-Type':'application/json'}});
 const response = method === 'POST' ? await POST(request) : method === 'PATCH' ? await PATCH(request,{params:Promise.resolve({id:menu})}) : await DELETE(request,{params:Promise.resolve({id:menu})});
 expect(response.status).toBe(403);
 expect(mockWrite).not.toHaveBeenCalled();
 expect(writeAuditLog).not.toHaveBeenCalled();
});
