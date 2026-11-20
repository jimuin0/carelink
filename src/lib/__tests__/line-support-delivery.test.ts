/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
jest.mock('../line-support-store',()=>({lineSupportRpc:jest.fn(),supportDeliverySchema:{},supportDeliveryContextSchema:{}}));
jest.mock('../line-support-quota',()=>({hasLineSupportQuota:jest.fn(()=>Promise.resolve(true))}));
import { hasLineSupportQuota } from '../line-support-quota';
import { lineSupportRpc } from '../line-support-store';
import { dispatchLineSupportDelivery } from '../line-support-delivery';
import { lineSupportKnowledge,publicLineSupportAnswer } from '../line-support-knowledge';
const rpc=lineSupportRpc as jest.Mock;const env={...process.env};const priorFetch=global.fetch;
const context={kind:'operator_draft',question:null,message_type:'text',mode:'human'};
const delivery={kind:'operator_draft',reply_token:null,reply_expires_at:null,id:'30000000-0000-4000-8000-000000000001',recipient_id:'U'+'1'.repeat(32),body:'返信案',retry_key:'40000000-0000-4000-8000-000000000001'};
beforeEach(()=>{jest.clearAllMocks();process.env={...env,LINE_SUPPORT_ENABLED:'true',LINE_CHANNEL_ACCESS_TOKEN_CARELINK:'synthetic',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40)};
 rpc.mockResolvedValueOnce(context).mockResolvedValueOnce(delivery).mockResolvedValueOnce(true);global.fetch=jest.fn().mockResolvedValue(new Response('{}',{status:200,headers:{'x-line-request-id':'req'}}));});
afterEach(()=>{process.env={...env};global.fetch=priorFetch;rpc.mockReset();});
test('sends the frozen recipient, body and persisted retry key once',async()=>{
 expect(await dispatchLineSupportDelivery(delivery.id)).toBe('accepted');
 const [,options]=(global.fetch as jest.Mock).mock.calls[0];expect(options.headers['X-Line-Retry-Key']).toBe(delivery.retry_key);
 expect(JSON.parse(options.body).to).toBe(delivery.recipient_id);expect(global.fetch).toHaveBeenCalledTimes(1);
 expect(rpc.mock.calls[2][1]).toMatchObject({p_state:'accepted',p_request_id:'req'});
});
test.each(['token','release'])('missing %s does not claim a delivery',async part=>{
 if(part==='token')delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;else delete process.env.VERCEL_GIT_COMMIT_SHA;
 expect(await dispatchLineSupportDelivery(delivery.id)).toBe('not_attempted');expect(rpc).not.toHaveBeenCalled();
});
test('an obsolete or already claimed delivery never sends',async()=>{
 rpc.mockReset().mockResolvedValue(null);expect(await dispatchLineSupportDelivery(delivery.id)).toBe('not_attempted');expect(global.fetch).not.toHaveBeenCalled();
});
test('an unverifiable release never checks quota or sends',async()=>{process.env.VERCEL_GIT_COMMIT_SHA='local';expect(await dispatchLineSupportDelivery(delivery.id)).toBe('not_attempted');expect(rpc).not.toHaveBeenCalled();});
test('quota exhaustion leaves the durable delivery pending without an external send',async()=>{(hasLineSupportQuota as jest.Mock).mockResolvedValueOnce(false);expect(await dispatchLineSupportDelivery(delivery.id)).toBe('not_attempted');expect(rpc).toHaveBeenCalledTimes(1);expect(rpc.mock.calls[0][0]).toBe('line_support_delivery_context');expect(global.fetch).not.toHaveBeenCalled();});
test.each([[409,true,'accepted'],[409,false,'unknown'],[400,false,'failed'],[429,false,'unknown'],[500,false,'unknown']])('HTTP %s with receipt %s produces %s',async(status,receipt,outcome)=>{
 global.fetch=jest.fn().mockResolvedValue(new Response('{}',{status:Number(status),headers:receipt?{'x-line-accepted-request-id':'accepted-req'}:{}}));
 expect(await dispatchLineSupportDelivery(delivery.id)).toBe(outcome);expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('timeout remains unknown; it never invents another retry key',async()=>{
 global.fetch=jest.fn().mockRejectedValue(new Error('timeout'));expect(await dispatchLineSupportDelivery(delivery.id)).toBe('unknown');
 expect(rpc.mock.calls[2][1]).toMatchObject({p_state:'unknown',p_request_id:null});expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('an unconfirmed DB finish receipt is surfaced rather than reported sent',async()=>{
 rpc.mockReset().mockResolvedValueOnce(context).mockResolvedValueOnce(delivery).mockResolvedValueOnce(false);
 await expect(dispatchLineSupportDelivery(delivery.id)).rejects.toThrow('unconfirmed');
});
test('operator receives only the copyable proposal; the checklist stays in the console',async()=>{
 rpc.mockReset().mockResolvedValueOnce(context).mockResolvedValueOnce({...delivery,body:'運営の確認事項・未送信',proposal_body:'お客様に送れる返信文案です。'}).mockResolvedValueOnce(true);
 expect(await dispatchLineSupportDelivery(delivery.id)).toBe('accepted');
 const payload=JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
 expect(payload.messages).toEqual([{type:'text',text:'お客様に送れる返信文案です。'}]);expect(JSON.stringify(payload)).not.toContain('運営の確認事項');expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('the runtime stop switch also blocks operator-initiated recovery sends',async()=>{process.env.LINE_SUPPORT_ENABLED='false';expect(await dispatchLineSupportDelivery(delivery.id)).toBe('not_attempted');expect(rpc).not.toHaveBeenCalled();expect(global.fetch).not.toHaveBeenCalled();});
function replyDelivery(overrides:Record<string,unknown>={}){
 const body=publicLineSupportAnswer('登録方法',lineSupportKnowledge('a'.repeat(40)))!.text;
 const response={...delivery,kind:'customer_reply',body,reply_token:'synthetic-one-use-token',reply_expires_at:new Date(Date.now()+35000).toISOString(),...overrides};
 rpc.mockReset().mockResolvedValueOnce({kind:'customer_reply',question:'登録方法',message_type:'text',mode:'automatic'}).mockResolvedValueOnce(response).mockResolvedValueOnce(true);
 return response;
}
test('a public FAQ uses the one-use Reply API without spending the push allowance',async()=>{
 const frozen=replyDelivery();expect(await dispatchLineSupportDelivery(delivery.id)).toBe('accepted');
 const [url,options]=(global.fetch as jest.Mock).mock.calls[0];expect(url).toBe('https://api.line.me/v2/bot/message/reply');
 expect(JSON.parse(options.body)).toEqual({replyToken:frozen.reply_token,messages:[{type:'text',text:frozen.body}]});
 expect(options.headers['X-Line-Retry-Key']).toBeUndefined();expect(hasLineSupportQuota).not.toHaveBeenCalled();
 expect(rpc.mock.calls[1][1].p_expected_reply).toBe(frozen.body);expect(global.fetch).toHaveBeenCalledTimes(1);
});
test.each([{reply_token:null},{reply_expires_at:null},{reply_expires_at:'invalid'},{reply_expires_at:'2000-01-01T00:00:00Z'}])('an expired or malformed claimed reply never falls back to a paid customer push: %j',async fields=>{
 replyDelivery(fields);expect(await dispatchLineSupportDelivery(delivery.id)).toBe('failed');expect(global.fetch).not.toHaveBeenCalled();expect(hasLineSupportQuota).not.toHaveBeenCalled();
 expect(rpc.mock.calls[2][1].p_state).toBe('failed');
});
test('an unexpected reply conflict is uncertain even if it contains a push acceptance header',async()=>{
 replyDelivery();global.fetch=jest.fn().mockResolvedValue(new Response('{}',{status:409,headers:{'x-line-accepted-request-id':'not-a-reply-receipt'}}));
 expect(await dispatchLineSupportDelivery(delivery.id)).toBe('unknown');expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('a question no longer allowed by current policy cannot use an old queued customer classification',async()=>{
 rpc.mockReset().mockResolvedValueOnce({kind:'customer_reply',question:'返金して',message_type:'text',mode:'automatic'}).mockResolvedValueOnce(null);
 expect(await dispatchLineSupportDelivery(delivery.id)).toBe('not_attempted');expect(rpc.mock.calls[1][1].p_expected_reply).toBeNull();expect(global.fetch).not.toHaveBeenCalled();
});
test('a missing original question is also held for human review',async()=>{
 rpc.mockReset().mockResolvedValueOnce({kind:'customer_reply',question:null,message_type:'text',mode:'automatic'}).mockResolvedValueOnce(null);
 expect(await dispatchLineSupportDelivery(delivery.id)).toBe('not_attempted');expect(rpc.mock.calls[1][1].p_expected_reply).toBeNull();
});

test('a provider redirect is not followed and cannot become an accepted receipt',async()=>{global.fetch=jest.fn().mockResolvedValue(new Response(null,{status:302,headers:{location:'https://example.invalid'}}));expect(await dispatchLineSupportDelivery(delivery.id)).toBe('unknown');expect(global.fetch).toHaveBeenCalledTimes(1);expect((global.fetch as jest.Mock).mock.calls[0][1].redirect).toBe('manual');expect(rpc.mock.calls.at(-1)[1].p_state).toBe('unknown');});
