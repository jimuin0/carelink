/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
jest.mock('@/lib/cron-auth',()=>({checkCronAuth:jest.fn(()=>null)}));
jest.mock('@/lib/with-route',()=>({serverError:jest.fn(()=>new Response('{}',{status:500}))}));
jest.mock('@/lib/line-support-store',()=>({lineSupportRpc:jest.fn()}));
jest.mock('@/lib/line-support-processor',()=>({processLineSupportEvent:jest.fn()}));
jest.mock('@/lib/line-support-delivery',()=>({dispatchLineSupportDelivery:jest.fn()}));
import { POST } from '@/app/api/line/support-work/route';
import { checkCronAuth } from '@/lib/cron-auth';
import { lineSupportRpc } from '@/lib/line-support-store';
import { processLineSupportEvent } from '@/lib/line-support-processor';
import { dispatchLineSupportDelivery } from '@/lib/line-support-delivery';
const rpc=lineSupportRpc as jest.Mock;const originalEnv={...process.env};
const delivery='10000000-0000-4000-8000-000000000001';
function request(body:unknown={eventId:'event'}){return new Request('https://example.test/api/line/support-work',{method:'POST',body:JSON.stringify(body)});}
beforeEach(()=>{jest.clearAllMocks();rpc.mockReset().mockResolvedValue({state:'done',rollout:'live',delivery_id:null});(processLineSupportEvent as jest.Mock).mockResolvedValue(undefined);(checkCronAuth as jest.Mock).mockReturnValue(null);process.env={...originalEnv,LINE_SUPPORT_ENABLED:'true'};});
afterEach(()=>{process.env={...originalEnv};});
test('unauthenticated queue jobs cannot touch storage or the model',async()=>{(checkCronAuth as jest.Mock).mockReturnValueOnce(new Response('{}',{status:401}));expect((await POST(request())).status).toBe(401);expect(processLineSupportEvent).not.toHaveBeenCalled();});
test('disabled consumer asks the queue to retry',async()=>{delete process.env.LINE_SUPPORT_ENABLED;expect((await POST(request())).status).toBe(503);expect(rpc).not.toHaveBeenCalled();});
test.each([{},null,{eventId:''},{eventId:'event',to:'other'}])('invalid job %j fails without a model call',async body=>{expect((await POST(request(body))).status).toBe(400);expect(processLineSupportEvent).not.toHaveBeenCalled();});
test.each(['pending','processing'])('active %s durable work is retried instead of silently acknowledged',async state=>{rpc.mockResolvedValueOnce({state,rollout:'live',delivery_id:null});expect((await POST(request())).status).toBe(503);});
test.each([null,{state:'superseded',rollout:'live',delivery_id:null},{state:'done',rollout:'observe',delivery_id:delivery}])('completed or held receipt %j is acknowledged without send',async value=>{rpc.mockResolvedValueOnce(value);expect((await POST(request())).status).toBe(200);expect(dispatchLineSupportDelivery).not.toHaveBeenCalled();});
test('a crash after preparation is recovered using the existing outbox ID',async()=>{rpc.mockResolvedValueOnce({state:'done',rollout:'live',delivery_id:delivery});(dispatchLineSupportDelivery as jest.Mock).mockResolvedValueOnce('accepted');expect((await POST(request())).status).toBe(200);expect(dispatchLineSupportDelivery).toHaveBeenCalledWith(delivery);});
test.each([delivery,null])('unattempted delivery remains pending only when durable receipt says so: %s',async pending=>{rpc.mockResolvedValueOnce({state:'done',rollout:'live',delivery_id:delivery}).mockResolvedValueOnce(pending?{state:'done',rollout:'live',delivery_id:pending}:null);(dispatchLineSupportDelivery as jest.Mock).mockResolvedValueOnce('not_attempted');expect((await POST(request())).status).toBe(pending?503:200);});
test('worker failure leaves a retryable job, never an acceptance receipt',async()=>{(processLineSupportEvent as jest.Mock).mockRejectedValueOnce(new Error('private'));expect((await POST(request())).status).toBe(500);});
test.each(['pending','processing'])('a delivery requeued as %s cannot be acknowledged as done',async state=>{
 rpc.mockResolvedValueOnce({state:'done',rollout:'live',delivery_id:delivery}).mockResolvedValueOnce({state,rollout:'live',delivery_id:null});(dispatchLineSupportDelivery as jest.Mock).mockResolvedValueOnce('not_attempted');
 expect((await POST(request())).status).toBe(503);
});
