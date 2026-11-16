/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
jest.mock('../line-support-wakeup',()=>({isLineSupportQueueConfigured:jest.fn(()=>true)}));
import { isLineSupportQueueConfigured } from '../line-support-wakeup';
import { lineSupportReadiness } from '../line-support-readiness';
const saved={...process.env};const queue=isLineSupportQueueConfigured as jest.Mock;
const names=['LINE_SUPPORT_ENABLED','LINE_CHANNEL_ACCESS_TOKEN_CARELINK','LINE_CHANNEL_SECRET_CARELINK','LINE_SUPPORT_DESTINATION','ANTHROPIC_API_KEY','CLAUDE_API_KEY','LINE_SUPPORT_CLAUDE_MODEL','CLAUDE_MODEL','AI_CHAT_DAILY_REQUEST_LIMIT','CRON_SECRET','VERCEL_GIT_COMMIT_SHA'];
beforeEach(()=>{process.env={...saved};for(const key of names)delete process.env[key];Object.assign(process.env,{LINE_SUPPORT_ENABLED:'true',LINE_CHANNEL_ACCESS_TOKEN_CARELINK:'synthetic-line-key',LINE_CHANNEL_SECRET_CARELINK:'synthetic-signature-key',LINE_SUPPORT_DESTINATION:'U'+'1'.repeat(32),ANTHROPIC_API_KEY:'synthetic-provider-key',LINE_SUPPORT_CLAUDE_MODEL:'existing-model',CRON_SECRET:'synthetic-worker-key',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40)});queue.mockReset().mockReturnValue(true);});
afterEach(()=>{process.env={...saved};});
test('configuration is present only when every required boundary is configured',()=>{expect(lineSupportReadiness()).toEqual({configured:true,missing:[]});});
test.each([
 ['LINE_SUPPORT_ENABLED',undefined,'enabled'],['LINE_CHANNEL_ACCESS_TOKEN_CARELINK',undefined,'line'],['LINE_CHANNEL_SECRET_CARELINK',undefined,'line'],['LINE_SUPPORT_DESTINATION',undefined,'line'],['LINE_SUPPORT_DESTINATION','invalid','line'],
 ['ANTHROPIC_API_KEY',undefined,'drafts'],['ANTHROPIC_API_KEY','  ','drafts'],['LINE_SUPPORT_CLAUDE_MODEL',undefined,'drafts'],['LINE_SUPPORT_CLAUDE_MODEL',' ','drafts'],['AI_CHAT_DAILY_REQUEST_LIMIT','0','quota'],['CRON_SECRET',undefined,'processing'],['VERCEL_GIT_COMMIT_SHA',undefined,'version'],['VERCEL_GIT_COMMIT_SHA','local','version'],
])('missing or malformed %s prevents activation', (name,value,missing)=>{if(value===undefined)delete process.env[name!];else process.env[name!]=value;expect(lineSupportReadiness()).toEqual({configured:false,missing:[missing]});});
test('the dedicated provider aliases are accepted without changing common AI credentials',()=>{delete process.env.ANTHROPIC_API_KEY;delete process.env.LINE_SUPPORT_CLAUDE_MODEL;process.env.CLAUDE_API_KEY='synthetic-dedicated-key';process.env.CLAUDE_MODEL='existing-model';expect(lineSupportReadiness().configured).toBe(true);});
test('the actual durable queue binding is required even when worker credentials exist',()=>{queue.mockReturnValue(false);expect(lineSupportReadiness()).toEqual({configured:false,missing:['processing']});});
test('configuration receipts contain safe categories, never credentials, destination IDs or model values',()=>{const text=JSON.stringify(lineSupportReadiness());expect(text).not.toContain('synthetic');expect(text).not.toContain('existing-model');expect(text).not.toContain(process.env.LINE_SUPPORT_DESTINATION);});

test('an unusable dedicated key cannot report the common key as support configuration',()=>{
 process.env.CLAUDE_API_KEY='  ';expect(lineSupportReadiness()).toEqual({configured:false,missing:['drafts']});
});
