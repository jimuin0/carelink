/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { readLineSupportConnection } from '../line-support-connection';
const fetchMock=jest.fn();const priorFetch=global.fetch;const priorEnv=process.env;
const userId='U'+'1'.repeat(32);const bot={userId,basicId:'@549rbbyi',displayName:'carelink'};
beforeEach(()=>{process.env={...priorEnv,LINE_CHANNEL_ACCESS_TOKEN_CARELINK:'synthetic-token',LINE_SUPPORT_DESTINATION:userId};global.fetch=fetchMock;fetchMock.mockReset();});
afterEach(()=>{process.env=priorEnv;global.fetch=priorFetch;});
test.each([undefined,'',' '])('missing token %s makes no provider call',async value=>{if(value===undefined)delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;else process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK=value;expect(await readLineSupportConnection()).toBeNull();expect(fetchMock).not.toHaveBeenCalled();});
test('confirmed account metadata strips unknown provider fields and credentials',async()=>{fetchMock.mockResolvedValue({ok:true,json:async()=>({...bot,unrelated:'private'})});expect(await readLineSupportConnection()).toEqual({...bot,destinationMatches:true});expect(fetchMock).toHaveBeenCalledWith('https://api.line.me/v2/bot/info',expect.objectContaining({cache:'no-store',redirect:'manual',headers:{Authorization:'Bearer synthetic-token'}}));});
test('wrong or missing destination is reported without silently configuring it',async()=>{delete process.env.LINE_SUPPORT_DESTINATION;fetchMock.mockResolvedValue({ok:true,json:async()=>bot});expect(await readLineSupportConnection()).toEqual({...bot,destinationMatches:false});expect(process.env.LINE_SUPPORT_DESTINATION).toBeUndefined();});
test('provider rejects invalid credentials',async()=>{fetchMock.mockResolvedValue({ok:false});expect(await readLineSupportConnection()).toBeNull();});
test.each([{...bot,basicId:'@other'},{...bot,userId:'invalid'},{}])('untrusted provider metadata %j fails closed',async value=>{fetchMock.mockResolvedValue({ok:true,json:async()=>value});expect(await readLineSupportConnection()).toBeNull();});
test('provider timeout or JSON errors disclose no raw error',async()=>{fetchMock.mockRejectedValue(new Error('synthetic-token'));expect(await readLineSupportConnection()).toBeNull();});

test('a redirect is rejected without following it or parsing its body',async()=>{const json=jest.fn();fetchMock.mockResolvedValue({ok:false,status:302,json});expect(await readLineSupportConnection()).toBeNull();expect(json).not.toHaveBeenCalled();expect(fetchMock).toHaveBeenCalledTimes(1);});
