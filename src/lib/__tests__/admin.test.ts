/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
const mockFrom = jest.fn(), mockRpc = jest.fn();
jest.mock('../supabase-server-auth', () => ({ createServerSupabaseAuthClient: () => ({ from: mockFrom, rpc: mockRpc }) }));
import { getCustomerVisits, getUniqueCustomers } from '../admin';
let chain: Record<string, jest.Mock>, pages: { data: unknown; error?: unknown }[];
beforeEach(() => {
  jest.clearAllMocks(); chain = {}; pages = [{ data: [] }];
  for (const key of ['select','eq','order']) chain[key] = jest.fn(() => chain);
  chain.range = jest.fn(async () => pages.shift() ?? { data: [] });
  mockFrom.mockReturnValue(chain); mockRpc.mockReturnValue(chain);
});
const visits = [{ customer_email: 'f.o.o@gmail.com', email_canonical: 'foo@gmail.com', customer_name: 'First', visit_date: '2026-04-10' },
  { customer_email: 'foo+shop@gmail.com', email_canonical: 'foo@gmail.com', customer_name: 'Old', visit_date: '2026-04-01' },
  { customer_email: 'other@example.invalid', customer_name: 'Other', visit_date: '2026-03-01' }];
const missing = { code: '42703', message: 'column "email_canonical" does not exist' };
test.each([undefined,'B.B+x@Gmail.com'])('visits maintain facility and canonical scope %s', async email => {
  pages = [{ data: visits }]; expect(await getCustomerVisits('f1', email)).toEqual(visits);
  expect(chain.eq).toHaveBeenCalledWith('facility_id','f1');
  if (email) expect(chain.eq).toHaveBeenCalledWith('email_canonical','bb@gmail.com');
  expect(chain.order).toHaveBeenCalledWith('visit_date',{ ascending: false });
  expect(chain.order).toHaveBeenCalledWith('id'); expect(chain.range).toHaveBeenCalledWith(0,999);
});
test.each([undefined,'b@test.com'])('empty visits remain empty %s', async email => {
  pages = [{ data: [] }]; expect(await getCustomerVisits('f1',email)).toEqual([]);
});
test('missing provider visit data cannot become measured empty history', async () => {
  pages = [{ data:null }]; await expect(getCustomerVisits('f1')).rejects.toThrow('来店履歴');
});
test('missing canonical column falls back to exact email without losing scope', async () => {
  pages = [{ data: null,error: missing },{ data: visits }];
  expect(await getCustomerVisits('f1','b@test.com')).toEqual(visits);
  expect(chain.eq).toHaveBeenCalledWith('customer_email','b@test.com');
});
test.each(['all','canonical','fallback'])('visit %s read error cannot become empty history', async kind => {
  pages = kind === 'fallback' ? [{ data: null,error: missing },{ data: null,error: {} }] : [{ data: null,error: {} }];
  await expect(getCustomerVisits('f1',kind === 'all' ? undefined : 'b@test.com')).rejects.toThrow('来店履歴');
});
test('visit pagination includes the 1001st record rather than truncating at PostgREST default', async () => {
  pages = [{ data: Array.from({ length: 1000 },(_,id) => ({ id })) },{ data: [{ id: 1000 }] }];
  expect(await getCustomerVisits('f1')).toHaveLength(1001);
  expect(chain.range).toHaveBeenLastCalledWith(1000,1999);
});
test('later page failure never returns partial measured history', async () => {
  pages = [{ data: Array(1000).fill(visits[0]) },{ data: null,error: {} }];
  await expect(getCustomerVisits('f1')).rejects.toThrow();
});
test('customer RPC is paginated and bigint count converted without fetching visits', async () => {
  pages = [{ data: [{ email: 'a@test.com',name: 'A',visit_count: '3',last_visit: '2026-05-01' }] }];
  expect(await getUniqueCustomers('f1')).toEqual([{ email:'a@test.com',name:'A',visit_count:3,last_visit:'2026-05-01' }]);
  expect(mockRpc).toHaveBeenCalledWith('get_unique_customers',{ p_facility_id:'f1' }); expect(mockFrom).not.toHaveBeenCalled();
});
test('customer RPC beyond 1000 is not silently truncated', async () => {
  const row = { email:'a@test.com',name:'A',visit_count:1,last_visit:'2026-05-01' };
  pages = [{ data:Array(1000).fill(row) },{ data:[row] }];
  expect(await getUniqueCustomers('f1')).toHaveLength(1001); expect(chain.range).toHaveBeenCalledWith(1000,1999);
});
test.each([{ data:null,error:{ code:'PGRST202' } },{ data:null },{ data:{ broken:true } }])('unavailable or malformed RPC %j uses complete fallback', async response => {
  pages = [response,{ data:visits }];
  expect(await getUniqueCustomers('f1')).toEqual([{ email:'f.o.o@gmail.com',name:'First',visit_count:2,last_visit:'2026-04-10' },
    { email:'other@example.invalid',name:'Other',visit_count:1,last_visit:'2026-03-01' }]);
});
test('missing canonical field falls back to JS canonicalization; null and blank emails do not merge by name', async () => {
  pages = [{ data:null,error:{} },{ data:null,error:missing },{ data:[{ ...visits[0],email_canonical:undefined },
    { ...visits[1],email_canonical:undefined },{ ...visits[0],customer_email:null },{ ...visits[0],customer_email:' ' }] }];
  expect(await getUniqueCustomers('f1')).toEqual([{ email:'f.o.o@gmail.com',name:'First',visit_count:2,last_visit:'2026-04-10' }]);
});
test.each(['canonical','fallback'])('customer %s fallback failure cannot become zero', async kind => {
  pages = [{ data:null,error:{} },...(kind === 'fallback' ? [{ data:null,error:missing }] : []),{ data:null,error:{} }];
  await expect(getUniqueCustomers('f1')).rejects.toThrow('顧客集計');
});
test('RPC empty and fallback empty are genuine empty lists', async () => {
  expect(await getUniqueCustomers('f1')).toEqual([]);
  pages = [{ data:null,error:{} },{ data:[] }]; expect(await getUniqueCustomers('f1')).toEqual([]);
});
test.each([NaN, -1, 'broken', '9007199254740992'])('invalid RPC count %s falls back rather than rendering a false count', async visit_count => {
  pages = [{ data:[{ email:'a@test.com',name:'A',visit_count,last_visit:'2026-05-01' }] },{ data:visits }];
  expect((await getUniqueCustomers('f1'))[0].visit_count).toBe(2);
});
test('missing fallback provider data cannot become measured empty customers', async () => {
  pages = [{ data:null,error:{} },{ data:null }]; await expect(getUniqueCustomers('f1')).rejects.toThrow('顧客集計');
});
