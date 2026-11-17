/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { hasLineSupportQuota } from '../line-support-quota';
const originalFetch=global.fetch;
afterEach(()=>{global.fetch=originalFetch;});
function replies(limit:unknown,usage:unknown){global.fetch=jest.fn().mockResolvedValueOnce(new Response(JSON.stringify(limit))).mockResolvedValueOnce(new Response(JSON.stringify(usage)));}
test('verified account headroom allows an attempt without reading customer data',async()=>{replies({type:'limited',value:200},{totalUsage:0});expect(await hasLineSupportQuota('synthetic')).toBe(true);expect((global.fetch as jest.Mock).mock.calls.map(([url])=>url)).toEqual(['https://api.line.me/v2/bot/message/quota','https://api.line.me/v2/bot/message/quota/consumption']);});
test.each([[{type:'limited',value:200},{totalUsage:200}],[{type:'limited',value:0},{totalUsage:0}],[{type:'none'},{totalUsage:0}],[{type:'limited',value:30000},{totalUsage:0}],[{type:'limited',value:200},{totalUsage:-1}]])('unknown, increased or exhausted budget fails closed: %j %j',async(limit,usage)=>{replies(limit,usage);expect(await hasLineSupportQuota('synthetic')).toBe(false);});
test('quota HTTP errors are never interpreted as permission to spend',async()=>{global.fetch=jest.fn().mockResolvedValue(new Response('{}',{status:500}));expect(await hasLineSupportQuota('synthetic')).toBe(false);});
test('network failures do not fall back to an assumed balance',async()=>{global.fetch=jest.fn().mockRejectedValue(new Error('offline'));expect(await hasLineSupportQuota('synthetic')).toBe(false);});

test('quota redirects fail closed and all reads disable automatic redirects',async()=>{global.fetch=jest.fn().mockResolvedValue(new Response(null,{status:302,headers:{location:'https://example.invalid'}}));expect(await hasLineSupportQuota('synthetic')).toBe(false);for(const [,options] of (global.fetch as jest.Mock).mock.calls)expect(options.redirect).toBe('manual');expect(global.fetch).toHaveBeenCalledTimes(2);});
