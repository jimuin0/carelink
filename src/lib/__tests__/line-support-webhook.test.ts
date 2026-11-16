/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
jest.mock('@/lib/line',()=>({verifyLineSignature:jest.fn(()=>true)}));
jest.mock('@/lib/line-support-store',()=>({lineSupportRpc:jest.fn(),supportOperationSchema:jest.requireActual('@/lib/line-support-store').supportOperationSchema}));
jest.mock('@/lib/line-support-wakeup',()=>({enqueueLineSupportEvents:jest.fn()}));
jest.mock('@/lib/with-route',()=>({serverError:jest.fn(()=>new Response('{}',{status:500}))}));
import { POST } from '@/app/api/line/support-webhook/route';
import { verifyLineSignature } from '@/lib/line';
import { lineSupportRpc } from '@/lib/line-support-store';
import { enqueueLineSupportEvents } from '@/lib/line-support-wakeup';
const rpc=lineSupportRpc as jest.Mock;
const originalEnv={...process.env};
const destination='U'+'1'.repeat(32);const sender='U'+'2'.repeat(32);
const event={webhookEventId:'synthetic-event',timestamp:Date.now(),type:'message',source:{type:'user',userId:sender},message:{id:'message1',type:'text',text:'料金は？'}};
function request(body:unknown={destination,events:[event]},signature:string|null='synthetic'){
 return new Request('https://example.test/api/line/support-webhook',{method:'POST',headers:signature?{'x-line-signature':signature}:{},body:typeof body==='string'?body:JSON.stringify(body)});
}
beforeEach(()=>{jest.clearAllMocks();process.env={...originalEnv,LINE_SUPPORT_ENABLED:'true',LINE_SUPPORT_DESTINATION:destination};
 (verifyLineSignature as jest.Mock).mockReturnValue(true);rpc.mockReset().mockImplementation(async(name,args)=>name==='accept_line_support_events'?args.p_events.map((e:{event_id:string})=>({status:'accepted',event_id:e.event_id})):true);(enqueueLineSupportEvents as jest.Mock).mockResolvedValue(undefined);});
afterEach(()=>{process.env={...originalEnv};});
test('disabled receiver does not inspect or store messages',async()=>{delete process.env.LINE_SUPPORT_ENABLED;expect((await POST(request())).status).toBe(503);expect(rpc).not.toHaveBeenCalled();});
test('missing destination fails closed',async()=>{delete process.env.LINE_SUPPORT_DESTINATION;expect((await POST(request())).status).toBe(500);expect(rpc).not.toHaveBeenCalled();});
test.each([null,'bad'])('signature %s is rejected before persistence',async signature=>{(verifyLineSignature as jest.Mock).mockReturnValue(false);expect((await POST(request(undefined,signature))).status).toBe(401);expect(rpc).not.toHaveBeenCalled();});
test('signature configuration failure is not treated as acceptance',async()=>{(verifyLineSignature as jest.Mock).mockImplementationOnce(()=>{throw new Error('configuration');});expect((await POST(request())).status).toBe(500);});
test('oversized payload is rejected',async()=>{expect((await POST(request('x'.repeat(2100001)))).status).toBe(413);expect(rpc).not.toHaveBeenCalled();});
test.each(['{',JSON.stringify({destination:sender,events:[]}),JSON.stringify({destination,events:[{...event,timestamp:Date.now()+600000}]})])('invalid body never partially persists',async body=>{expect((await POST(request(body))).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
test('every message is persisted before any processing begins',async()=>{
 const events=[event,{...event,webhookEventId:'second'}];
 (enqueueLineSupportEvents as jest.Mock).mockImplementation(async()=>{expect(rpc).toHaveBeenCalledTimes(1);});
 expect((await POST(request({destination,events}))).status).toBe(200);
 expect(rpc.mock.calls[0][1].p_events).toHaveLength(2);expect(rpc.mock.calls[0][1].p_events[0]).toMatchObject({event_id:event.webhookEventId,body:event.message.text,line_user_id:sender});
 expect(enqueueLineSupportEvents).toHaveBeenCalledWith([event.webhookEventId,'second']);
});
test('atomic batch database failure returns retryable failure and never queues',async()=>{rpc.mockRejectedValueOnce(new Error('unavailable'));expect((await POST(request({destination,events:[event,{...event,webhookEventId:'second'}]}))).status).toBe(500);expect(enqueueLineSupportEvents).not.toHaveBeenCalled();});
test('a replay wakes the existing durable event',async()=>{rpc.mockResolvedValueOnce([{status:'duplicate',event_id:event.webhookEventId}]);expect((await POST(request())).status).toBe(200);expect(enqueueLineSupportEvents).toHaveBeenCalledWith([event.webhookEventId]);});
test('groups and unsupported messages are ignored',async()=>{expect((await POST(request({destination,events:[{...event,source:{type:'group',userId:sender}},{...event,type:'unknown'}]}))).status).toBe(200);expect(rpc).not.toHaveBeenCalled();});
test('pairing stores only a hash and never creates a support case',async()=>{rpc.mockResolvedValueOnce(true);const code='a'.repeat(32);await POST(request({destination,events:[{...event,message:{...event.message,text:'CareLink連携 '+code}}]}));expect(rpc.mock.calls[0][0]).toBe('confirm_line_support_pair_candidate');expect(rpc.mock.calls[0][1].p_hash).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(rpc.mock.calls)).not.toContain(code);expect(enqueueLineSupportEvents).toHaveBeenCalledWith([]);});
test('queue failure is retryable even after the event is durable',async()=>{(enqueueLineSupportEvents as jest.Mock).mockRejectedValueOnce(new Error('queue down'));expect((await POST(request())).status).toBe(500);});
test('unsend preserves the withdrawn message identity',async()=>{await POST(request({destination,events:[{...event,type:'unsend',message:undefined,unsend:{messageId:'withdrawn'}}]}));expect(rpc.mock.calls[0][1].p_events[0]).toMatchObject({message_type:'unsend',message_id:'withdrawn',body:'[unsend]'});});
test('follow retains the block lifecycle without fabricating a message ID',async()=>{await POST(request({destination,events:[{...event,type:'follow',message:undefined}]}));expect(rpc.mock.calls[0][1].p_events[0]).toMatchObject({message_type:'follow',message_id:null,body:'[follow]'});});
test('missing text is preserved as empty input, never invented',async()=>{await POST(request({destination,events:[{...event,message:{id:'message1',type:'text'}}]}));expect(rpc.mock.calls[0][1].p_events[0].body).toBe('');});
test('disabled database ingestion never queues an unaccepted event',async()=>{rpc.mockResolvedValueOnce([{status:'disabled',event_id:event.webhookEventId}]);await POST(request());expect(enqueueLineSupportEvents).toHaveBeenCalledWith([]);});
test('unknown support enters human mode during durable acceptance, before model generation',async()=>{
 await POST(request({destination,events:[{...event,message:{...event.message,text:'返金について相談したい'}}]}));
 expect(rpc.mock.calls[0][1].p_events[0].requires_human).toBe(true);
});
test('a verified release can accept a narrow public FAQ without requesting human mode',async()=>{
 process.env.VERCEL_GIT_COMMIT_SHA='a'.repeat(40);
 await POST(request({destination,events:[{...event,message:{...event.message,text:'登録方法'}}]}));
 expect(rpc.mock.calls[0][1].p_events[0].requires_human).toBe(false);
});
test.each([{receipts:[]},{receipts:[{status:'accepted',event_id:'wrong'}]}])('an incomplete or mismatched batch receipt cannot be acknowledged: %j',async({receipts})=>{rpc.mockResolvedValueOnce(receipts);expect((await POST(request())).status).toBe(500);expect(enqueueLineSupportEvents).not.toHaveBeenCalled();});
test('location metadata is preserved privately while the draft context contains a neutral marker',async()=>{
 const message={id:'location1',type:'location',title:'検証地点',latitude:0,longitude:0};
 expect((await POST(request({destination,events:[{...event,message}]}))).status).toBe(200);
 expect(rpc.mock.calls[0][1].p_events[0]).toMatchObject({raw_message:message,body:'[location]',requires_human:true});
});
test('a valid large multilingual batch uses one transaction and queues opaque IDs only',async()=>{
 const events=Array.from({length:100},(_,i)=>({...event,webhookEventId:'batch-'+i,message:{id:'message-'+i,type:'text',text:'検'.repeat(5000)}}));
 expect((await POST(request({destination,events}))).status).toBe(200);expect(rpc).toHaveBeenCalledTimes(1);expect(rpc.mock.calls[0][1].p_events).toHaveLength(100);
 expect(enqueueLineSupportEvents).toHaveBeenCalledWith(events.map(e=>e.webhookEventId));
});
test('a delayed signed FAQ is retained for human review instead of surprising the customer with a late automatic reply',async()=>{
 process.env.VERCEL_GIT_COMMIT_SHA='a'.repeat(40);
 expect((await POST(request({destination,events:[{...event,timestamp:Date.now()-600000,message:{...event.message,text:'登録方法'}}]}))).status).toBe(200);
 expect(rpc.mock.calls[0][1].p_events[0].requires_human).toBe(true);
});
test.each(['standby',''])('a %s event cannot compete with the active responder',async mode=>{await POST(request({destination,events:[{...event,mode}]}));expect(rpc).not.toHaveBeenCalled();});
test('an active reply token stays in private storage and never enters the queue',async()=>{
 await POST(request({destination,events:[{...event,mode:'active',replyToken:'synthetic-reply-secret'}]}));
 expect(rpc.mock.calls[0][1].p_events[0].reply_token).toBe('synthetic-reply-secret');expect(JSON.stringify((enqueueLineSupportEvents as jest.Mock).mock.calls)).not.toContain('synthetic-reply-secret');
});
