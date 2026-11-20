/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
jest.mock('../line-support-store',()=>({lineSupportRpc:jest.fn(),supportLeaseSchema:{},supportOperationSchema:{},supportJobSchema:{}}));
jest.mock('../line-support-draft',()=>({generateLineSupportDraft:jest.fn(),supportHistorySchema:{}}));
jest.mock('../line-support-delivery',()=>({dispatchLineSupportDelivery:jest.fn()}));
jest.mock('../slack',()=>({postToSlack:jest.fn().mockResolvedValue({ok:true})}));
import { postToSlack } from '../slack';
import { lineSupportRpc } from '../line-support-store';
import { generateLineSupportDraft } from '../line-support-draft';
import { dispatchLineSupportDelivery } from '../line-support-delivery';
import { processLineSupportEvent,processLineSupportPending } from '../line-support-processor';
import { formatLineSupportFallbackNotice } from '../line-support-policy';
const rpc=lineSupportRpc as jest.Mock;
const convo='10000000-0000-4000-8000-000000000001';const delivery='20000000-0000-4000-8000-000000000001';
const lease={event:{event_id:'event',conversation_id:convo,revision:1,message_type:'text',body:'登録方法',occurred_at:new Date().toISOString(),reply_token:'synthetic-reply-token',reply_expires_at:new Date(Date.now()+40000).toISOString(),reply_fallback_reason:null},mode:'automatic'};
const env={...process.env};
beforeEach(()=>{jest.clearAllMocks();rpc.mockReset();process.env={...env,LINE_SUPPORT_ENABLED:'true',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40)};
 (generateLineSupportDraft as jest.Mock).mockResolvedValue({state:'ready',model:'existing-claude',draft:{text:'詳細を確認いたします。',missingInformation:['発生日時'],sourceUrls:[]}});
});
afterEach(()=>{process.env={...env};});
test('no lease means no generation or delivery',async()=>{rpc.mockResolvedValueOnce(null);await processLineSupportEvent('event');expect(rpc).toHaveBeenCalledTimes(1);expect(generateLineSupportDraft).not.toHaveBeenCalled();expect(dispatchLineSupportDelivery).not.toHaveBeenCalled();});
test('verified public facts bypass the model and prepare before delivery',async()=>{
 rpc.mockResolvedValueOnce(lease).mockResolvedValueOnce({status:'prepared',delivery_id:delivery});
 await processLineSupportEvent('event');
 expect(generateLineSupportDraft).not.toHaveBeenCalled();expect(rpc.mock.calls[1][1]).toMatchObject({p_kind:'customer_reply',p_model_version:'public-facts-v1'});
 expect(dispatchLineSupportDelivery).toHaveBeenCalledWith(delivery);
});
test('human mode preserves history and prepares only an operator notice',async()=>{
 const history=[{revision:1,message_type:'text',body:'問い合わせ'}];
 rpc.mockResolvedValueOnce({...lease,mode:'human'}).mockResolvedValueOnce(history).mockResolvedValueOnce({status:'prepared',delivery_id:delivery});
 await processLineSupportEvent('event');expect(generateLineSupportDraft).toHaveBeenCalledWith(history,expect.any(Object),convo);
 expect(rpc.mock.calls[2][1]).toMatchObject({p_kind:'operator_draft',p_model_version:'existing-claude'});
 expect(rpc.mock.calls[2][1].p_body).toContain('送信済み履歴');expect(rpc.mock.calls[2][1].p_body).toContain('発生日時');
});
test('an unbound operator keeps a draft without dispatch',async()=>{
 rpc.mockResolvedValueOnce({...lease,mode:'human'}).mockResolvedValueOnce([]).mockResolvedValueOnce({status:'recipient_unbound'});
 await processLineSupportEvent('event');expect(dispatchLineSupportDelivery).not.toHaveBeenCalled();
});
test('provider failure finishes the event once and notifies Slack with fixed text, never LINE or the customer',async()=>{
 rpc.mockResolvedValueOnce({...lease,mode:'human'}).mockResolvedValueOnce([{revision:1,message_type:'text',body:'怒っています'}]).mockResolvedValueOnce({status:'completed'});
 (generateLineSupportDraft as jest.Mock).mockResolvedValueOnce({state:'unavailable'});
 await processLineSupportEvent('event');
 const done=rpc.mock.calls.find(c=>c[0]==='complete_line_support_without_delivery')![1];
 expect(done).toMatchObject({p_model_version:'fallback-notice-v1',p_body:formatLineSupportFallbackNotice(lease.event.conversation_id)});
 expect(rpc.mock.calls.some(c=>c[0]==='prepare_line_support_delivery')).toBe(false);
 expect(postToSlack).toHaveBeenCalledWith({text:formatLineSupportFallbackNotice(lease.event.conversation_id),unfurl_links:false});
 expect(JSON.stringify((postToSlack as jest.Mock).mock.calls)).not.toContain('怒っています');
 expect(dispatchLineSupportDelivery).not.toHaveBeenCalled();
});
test('a stale fallback does not notify Slack twice',async()=>{
 rpc.mockResolvedValueOnce({...lease,mode:'human'}).mockResolvedValueOnce([]).mockResolvedValueOnce({status:'stale'});
 (generateLineSupportDraft as jest.Mock).mockResolvedValueOnce({state:'unavailable'});
 (postToSlack as jest.Mock).mockClear();
 await processLineSupportEvent('event');expect(postToSlack).not.toHaveBeenCalled();expect(dispatchLineSupportDelivery).not.toHaveBeenCalled();
});
test('a failed Slack post logs only the fixed error code',async()=>{
 rpc.mockResolvedValueOnce({...lease,mode:'human'}).mockResolvedValueOnce([]).mockResolvedValueOnce({status:'completed'});
 (generateLineSupportDraft as jest.Mock).mockResolvedValueOnce({state:'unavailable'});
 (postToSlack as jest.Mock).mockResolvedValueOnce({ok:false,error:'not_in_channel'});
 const spy=jest.spyOn(console,'warn').mockImplementation(()=>{});
 try{await processLineSupportEvent('event');expect(spy).toHaveBeenCalledWith('[line-support-fallback]','not_in_channel');}finally{spy.mockRestore();}
});
test('superseded preparation never dispatches',async()=>{rpc.mockResolvedValueOnce(lease).mockResolvedValueOnce({status:'stale'});await processLineSupportEvent('event');expect(dispatchLineSupportDelivery).not.toHaveBeenCalled();});
test.each(['unfollow','unsend','follow'])('defensive %s lease cannot send',async message_type=>{rpc.mockResolvedValueOnce({...lease,event:{...lease.event,message_type}});await processLineSupportEvent('event');expect(rpc).toHaveBeenCalledTimes(1);});
test('one failed recovery does not starve other durable events',async()=>{
 rpc.mockImplementation(async(name,args)=>{
  if(name==='line_support_work')return [{event_id:'bad'},{event_id:'good'}];
  if(name==='claim_line_support_event'){if(args.p_event_id==='bad')throw new Error('unavailable');return lease;}
  return {status:'prepared',delivery_id:delivery};
 });
 expect(await processLineSupportPending()).toEqual({processed:1,failed:1});expect(dispatchLineSupportDelivery).toHaveBeenCalledWith(delivery);
});
test('empty recovery performs no external operations',async()=>{rpc.mockResolvedValueOnce([]);expect(await processLineSupportPending()).toEqual({processed:0,failed:0});expect(generateLineSupportDraft).not.toHaveBeenCalled();});
test('missing deployment cannot turn public text into an automatic reply',async()=>{delete process.env.VERCEL_GIT_COMMIT_SHA;rpc.mockResolvedValueOnce(lease).mockResolvedValueOnce([]).mockResolvedValueOnce({status:'recipient_unbound'});await processLineSupportEvent('event');expect(generateLineSupportDraft).toHaveBeenCalledWith([],expect.objectContaining({deployment:null}),convo);expect(rpc.mock.calls[2][1].p_kind).toBe('operator_draft');});
test.each(['pending','processing'])('operator recovery does not count %s work as complete',async state=>{rpc.mockResolvedValueOnce([{event_id:'event'}]).mockResolvedValueOnce(null).mockResolvedValueOnce({state,rollout:'live',delivery_id:null});expect(await processLineSupportPending()).toEqual({processed:0,failed:1});});
test.each([['live','accepted',0],['live','not_attempted',1],['observe','accepted',0]])('prepared outbox recovery respects rollout %s and outcome %s',async(rollout,outcome,failed)=>{
 rpc.mockResolvedValueOnce([{event_id:'event'}]).mockResolvedValueOnce(null).mockResolvedValueOnce({state:'done',rollout,delivery_id:delivery}).mockResolvedValueOnce(failed?{state:'done',rollout,delivery_id:delivery}:null);(dispatchLineSupportDelivery as jest.Mock).mockResolvedValueOnce(outcome);
 expect(await processLineSupportPending()).toEqual({processed:failed?0:1,failed});expect(dispatchLineSupportDelivery).toHaveBeenCalledTimes(rollout==='live'?1:0);
});
test('a removed event is harmless during recovery',async()=>{rpc.mockResolvedValueOnce([{event_id:'event'}]).mockResolvedValueOnce(null).mockResolvedValueOnce(null);expect(await processLineSupportPending()).toEqual({processed:1,failed:0});});
test('runtime disable does not start generation even through manual recovery',async()=>{process.env.LINE_SUPPORT_ENABLED='false';await processLineSupportEvent('event');expect(rpc).not.toHaveBeenCalled();expect(generateLineSupportDraft).not.toHaveBeenCalled();});
test.each([{reply_token:null},{reply_expires_at:'2000-01-01T00:00:00Z'},{occurred_at:'2000-01-01T00:00:00Z'}])('a late public FAQ becomes an operator proposal instead of an unsolicited paid reply: %j',async fields=>{
 rpc.mockResolvedValueOnce({...lease,event:{...lease.event,...fields}}).mockResolvedValueOnce({status:'recipient_unbound'});
 await processLineSupportEvent('event');expect(rpc.mock.calls[1][1]).toMatchObject({p_kind:'operator_draft',p_model_version:'public-facts-review-v1'});
 expect(rpc.mock.calls[1][1].p_proposal_text).toContain('書類');expect(generateLineSupportDraft).not.toHaveBeenCalled();expect(dispatchLineSupportDelivery).not.toHaveBeenCalled();
});
test('an uncertain prior reply produces a human-check notice rather than consuming its token again',async()=>{
 rpc.mockResolvedValueOnce({...lease,mode:'human',event:{...lease.event,reply_fallback_reason:'unknown'}}).mockResolvedValueOnce({status:'prepared',delivery_id:delivery});
 await processLineSupportEvent('event');expect(rpc.mock.calls[1][1].p_body).toContain('届いている可能性');expect(rpc.mock.calls[1][1].p_kind).toBe('operator_draft');expect(generateLineSupportDraft).not.toHaveBeenCalled();
});
test('expiry during preparation reuses the unsent operation for an operator proposal',async()=>{
 rpc.mockResolvedValueOnce(lease).mockResolvedValueOnce({status:'reply_expired'}).mockResolvedValueOnce({status:'prepared',delivery_id:delivery});
 await processLineSupportEvent('event');expect(rpc.mock.calls[1][1].p_kind).toBe('customer_reply');expect(rpc.mock.calls[2][1].p_kind).toBe('operator_draft');
 expect(rpc.mock.calls[2][1].p_delivery_id).toBe(rpc.mock.calls[1][1].p_delivery_id);expect(dispatchLineSupportDelivery).toHaveBeenCalledTimes(1);
});

test('attachments preserve history and create operator proposals without public text matching',async()=>{
 rpc.mockResolvedValueOnce({...lease,event:{...lease.event,message_type:'image',body:''},mode:'human'}).mockResolvedValueOnce([{revision:1,message_type:'image',body:''}]).mockResolvedValueOnce({status:'recipient_unbound'});
 await processLineSupportEvent('event');expect(generateLineSupportDraft).toHaveBeenCalled();expect(rpc.mock.calls[2][1]).toMatchObject({p_kind:'operator_draft'});expect(dispatchLineSupportDelivery).not.toHaveBeenCalled();
});

test.each(['failed','unknown'])('operator recovery reports fallback work reopened after %s',async outcome=>{
 rpc.mockResolvedValueOnce([{event_id:'event'}]).mockResolvedValueOnce(null).mockResolvedValueOnce({state:'done',rollout:'live',delivery_id:delivery}).mockResolvedValueOnce({state:'pending',rollout:'live',delivery_id:null});
 (dispatchLineSupportDelivery as jest.Mock).mockResolvedValueOnce(outcome);expect(await processLineSupportPending()).toEqual({processed:0,failed:1});
});
test.each(['processing','done'])('operator recovery reconciles post-dispatch durable state %s',async state=>{
 rpc.mockResolvedValueOnce([{event_id:'event'}]).mockResolvedValueOnce(null).mockResolvedValueOnce({state:'done',rollout:'live',delivery_id:delivery}).mockResolvedValueOnce({state,rollout:'live',delivery_id:null});
 (dispatchLineSupportDelivery as jest.Mock).mockResolvedValueOnce('accepted');expect(await processLineSupportPending()).toEqual(state==='done'?{processed:1,failed:0}:{processed:0,failed:1});
});
