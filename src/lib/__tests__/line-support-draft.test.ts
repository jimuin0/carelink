/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
jest.mock('@anthropic-ai/sdk',()=>({__esModule:true,default:jest.fn()}));
jest.mock('../chat-rate-limit',()=>({checkChatLimit:jest.fn(),chatDailyLimit:jest.fn(),CHAT_DAILY_WINDOW_MS:86400000}));
import Anthropic from '@anthropic-ai/sdk';
import { checkChatLimit,chatDailyLimit } from '../chat-rate-limit';
import { generateLineSupportDraft,minimiseSupportContext } from '../line-support-draft';
import { lineSupportKnowledge } from '../line-support-knowledge';
const create=jest.fn(); const env={...process.env};
const history=[{revision:1,message_type:'text',body:'ログインできません。'}];
const facts=lineSupportKnowledge('a'.repeat(40));const conversation='10000000-0000-4000-8000-000000000001';
beforeEach(()=>{jest.resetAllMocks();process.env={...env,ANTHROPIC_API_KEY:'synthetic',LINE_SUPPORT_CLAUDE_MODEL:'synthetic-model'};
 (chatDailyLimit as jest.Mock).mockReturnValue(10);(checkChatLimit as jest.Mock).mockResolvedValue('allowed');
 (Anthropic as unknown as jest.Mock).mockImplementation(()=>({messages:{create}}));
 create.mockResolvedValue({stop_reason:'end_turn',content:[{type:'tool_use',name:'ignored'},{type:'text',text:JSON.stringify({text:'状況を確認させてください。',missingInformation:['発生時刻'],sourceUrls:[]})}]});});
afterEach(()=>{process.env={...env};});
test('generates a validated draft with bounded history and no tools or customer-send command',async()=>{
 const result=await generateLineSupportDraft(history,facts,conversation);expect(result.state).toBe('ready');
 expect(Anthropic).toHaveBeenCalledWith({apiKey:'synthetic',timeout:10000,maxRetries:0});
 expect(create.mock.calls[0][0]).toMatchObject({model:'synthetic-model',max_tokens:1200});
 expect(create.mock.calls[0][0].system).toContain('顧客には送信されません');
});
test('existing provider aliases are supported without switching providers',async()=>{
 delete process.env.ANTHROPIC_API_KEY;delete process.env.LINE_SUPPORT_CLAUDE_MODEL;
 process.env.CLAUDE_API_KEY='synthetic-alias';process.env.CLAUDE_MODEL='alias-model';
 expect((await generateLineSupportDraft(history,facts,conversation)).state).toBe('ready');
});
test.each(['key','model','quota','provenance'])('missing %s never calls a paid model',async part=>{
 if(part==='key'){delete process.env.ANTHROPIC_API_KEY;delete process.env.CLAUDE_API_KEY;}
 if(part==='model'){delete process.env.LINE_SUPPORT_CLAUDE_MODEL;delete process.env.CLAUDE_MODEL;}
 if(part==='quota')(chatDailyLimit as jest.Mock).mockReturnValue(null);
 expect((await generateLineSupportDraft(history,part==='provenance'?lineSupportKnowledge(null):facts,conversation)).state).toBe('unavailable');
 expect(create).not.toHaveBeenCalled();
});
test.each(['limited','unavailable'])('quota %s blocks generation',async state=>{
 (checkChatLimit as jest.Mock).mockResolvedValue(state);expect((await generateLineSupportDraft(history,facts,conversation)).state).toBe('unavailable');expect(create).not.toHaveBeenCalled();
});
test.each([{stop_reason:'max_tokens',content:[]},{stop_reason:'end_turn',content:[{type:'text',text:'bad json'}]},
 {stop_reason:'end_turn',content:[{type:'text',text:'{"text":{},"missingInformation":[],"sourceUrls":[]}'}]}])('does not accept incomplete or malformed model output %j',async value=>{
 create.mockResolvedValue(value);expect((await generateLineSupportDraft(history,facts,conversation)).state).toBe('unavailable');
});
test('provider errors do not log customer details or credentials',async()=>{
 create.mockRejectedValue(new Error('synthetic provider failure'));const spy=jest.spyOn(console,'error').mockImplementation();
 expect((await generateLineSupportDraft(history,facts,conversation)).state).toBe('unavailable');expect(spy).not.toHaveBeenCalled();spy.mockRestore();
});
test('context sent to the model masks incidental contacts and credentials',()=>{
 const text='a@example.com 090-1234-5678 U'+'1'.repeat(32)+' sk-abcdefghijklmnop';
 const result=minimiseSupportContext([{revision:1,message_type:'text',body:text}])[0].body;
 expect(result).not.toContain('example.com');expect(result).not.toContain('090-1234-5678');expect(result).not.toContain('1'.repeat(32));expect(result).not.toContain('abcdefghijklmnop');
 expect(history[0].body).toBe('ログインできません。');
});
test.each([{release:'local',conversation},{release:'a'.repeat(40),conversation:'not-a-case'}])('invalid provenance or conversation cannot consume the model budget: %j',async input=>{
 expect((await generateLineSupportDraft(history,lineSupportKnowledge(input.release),input.conversation)).state).toBe('unavailable');expect(checkChatLimit).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
});
test('one conversation cannot consume more than its own daily allowance',async()=>{
 (checkChatLimit as jest.Mock).mockResolvedValueOnce('limited');
 expect((await generateLineSupportDraft(history,facts,conversation)).state).toBe('unavailable');
 expect(checkChatLimit).toHaveBeenCalledTimes(1);expect(checkChatLimit).toHaveBeenCalledWith('chat-daily:line-support:'+conversation,10,86400000);expect(create).not.toHaveBeenCalled();
});
test('the existing global AI allowance still applies after the per-conversation fence',async()=>{
 (checkChatLimit as jest.Mock).mockResolvedValueOnce('allowed').mockResolvedValueOnce('limited');
 expect((await generateLineSupportDraft(history,facts,conversation)).state).toBe('unavailable');expect(checkChatLimit).toHaveBeenLastCalledWith('chat-daily:global',10,86400000);expect(create).not.toHaveBeenCalled();
});

test('a dedicated support key takes precedence over the common AI credential',async()=>{
 process.env.CLAUDE_API_KEY='synthetic-support-only';expect((await generateLineSupportDraft(history,facts,conversation)).state).toBe('ready');expect(Anthropic).toHaveBeenCalledWith(expect.objectContaining({apiKey:'synthetic-support-only'}));
});
