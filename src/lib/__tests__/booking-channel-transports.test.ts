/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
const mockPushSend=jest.fn(),mockPushPrepare=jest.fn();
jest.mock('web-push',()=>({setVapidDetails:jest.fn(),generateRequestDetails:(...a:unknown[])=>mockPushPrepare(...a),sendNotification:(...a:unknown[])=>mockPushSend(...a)}));
jest.mock('../supabase-server',()=>({createServiceRoleClient:jest.fn(()=>{throw new Error('recipient reread forbidden');})}));
import { prepareCapturedPushDelivery } from '../push';
import { prepareSingleLineDelivery } from '../line';
import { prepareSingleLineWorksDelivery,__resetLineWorksTokenCacheForTest } from '../integrations/line-works';
const subscription={endpoint:'https://push.example.invalid/captured',p256dh:'synthetic-key',auth:'synthetic-auth'};
beforeEach(()=>{
  jest.clearAllMocks();jest.restoreAllMocks();__resetLineWorksTokenCacheForTest();
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY='synthetic-public';process.env.VAPID_PRIVATE_KEY='synthetic-private';
  process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK='synthetic-line-token';
  for(const key of ['LINE_WORKS_BOT_ID','LINE_WORKS_CLIENT_ID','LINE_WORKS_CLIENT_SECRET','LINE_WORKS_SERVICE_ACCOUNT','LINE_WORKS_PRIVATE_KEY'])delete process.env[key];
  mockPushPrepare.mockReturnValue({});mockPushSend.mockResolvedValue({statusCode:201});
  global.fetch=jest.fn();
});
test('push material is validated before the fence without sending',async()=>{
 const copied={...subscription};const sender=prepareCapturedPushDelivery(copied,{title:'captured',body:'frozen'});
 copied.endpoint='https://push.example.invalid/new';expect(mockPushSend).not.toHaveBeenCalled();
 expect(await sender()).toEqual({outcome:'delivered',status:201});expect(mockPushSend).toHaveBeenCalledTimes(1);
 expect(mockPushSend.mock.calls[0][0].endpoint).toBe(subscription.endpoint);
});
test('invalid push encryption material fails in preparation, without provider traffic',()=>{
 mockPushPrepare.mockImplementationOnce(()=>{throw new Error('private key content');});
 expect(()=>prepareCapturedPushDelivery(subscription,{title:'x',body:'x'})).toThrow('PUSH_PREPARATION_UNAVAILABLE');expect(mockPushSend).not.toHaveBeenCalled();
});
test('missing VAPID config does not send',()=>{
 delete process.env.VAPID_PRIVATE_KEY;expect(()=>prepareCapturedPushDelivery(subscription,{title:'x',body:'x'})).toThrow('PUSH_PREPARATION_UNAVAILABLE');
});
test('a resolved push promise without response evidence remains unknown',async()=>{
 mockPushSend.mockResolvedValueOnce(undefined);
 expect(await prepareCapturedPushDelivery(subscription,{title:'x',body:'x'})()).toEqual({outcome:'uncertain',status:null});
 expect(mockPushSend).toHaveBeenCalledTimes(1);
});
test('push network exception without an HTTP status remains unknown',async()=>{
 mockPushSend.mockRejectedValueOnce(new Error('synthetic connection loss'));
 expect(await prepareCapturedPushDelivery(subscription,{title:'x',body:'x'})()).toEqual({outcome:'uncertain',status:null});
 expect(mockPushSend).toHaveBeenCalledTimes(1);
});
test.each([429,500,201,undefined])('push exception status %p never causes inline retry',async statusCode=>{
 mockPushSend.mockRejectedValueOnce({statusCode,message:'private endpoint/key'});
 const result=await prepareCapturedPushDelivery(subscription,{title:'x',body:'x'})();
 expect(result.outcome).toBe(statusCode===429?'rejected':'uncertain');expect(mockPushSend).toHaveBeenCalledTimes(1);
});
test.each([200,401,429,500])('LINE status %i performs exactly one message request',async status=>{
 (fetch as jest.Mock).mockResolvedValue({status});const sender=prepareSingleLineDelivery('captured-recipient','captured text');
 expect(fetch).not.toHaveBeenCalled();expect((await sender()).outcome).toBe(status===200?'delivered':status===500?'uncertain':'rejected');expect(fetch).toHaveBeenCalledTimes(1);
});
test('LINE timeout stays unknown and is not retried',async()=>{
 (fetch as jest.Mock).mockRejectedValue(new Error('private credential'));expect((await prepareSingleLineDelivery('captured','text')()).outcome).toBe('uncertain');expect(fetch).toHaveBeenCalledTimes(1);
});
test('missing LINE config blocks preparation',()=>{
 delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;expect(()=>prepareSingleLineDelivery('x','x')).toThrow();expect(fetch).not.toHaveBeenCalled();
});
test('LINE Works missing bot or auth blocks before any message request',async()=>{
 await expect(prepareSingleLineWorksDelivery('x','x')).rejects.toThrow('LINE_WORKS_PREPARATION_UNAVAILABLE');expect(fetch).not.toHaveBeenCalled();
 process.env.LINE_WORKS_BOT_ID='bot';await expect(prepareSingleLineWorksDelivery('x','x')).rejects.toThrow('LINE_WORKS_PREPARATION_UNAVAILABLE');expect(fetch).not.toHaveBeenCalled();
});
describe('prepared LINE Works transport',()=>{
 beforeEach(()=>{
  Object.assign(process.env,{LINE_WORKS_BOT_ID:'bot',LINE_WORKS_CLIENT_ID:'client',LINE_WORKS_CLIENT_SECRET:'secret',LINE_WORKS_SERVICE_ACCOUNT:'synthetic-account',LINE_WORKS_PRIVATE_KEY:'-----BEGIN PRIVATE KEY-----\nYWJj\n-----END PRIVATE KEY-----'});
  jest.spyOn(crypto.subtle,'importKey').mockResolvedValue({} as CryptoKey);jest.spyOn(crypto.subtle,'sign').mockResolvedValue(new Uint8Array([1,2,3]).buffer);
  (fetch as jest.Mock).mockResolvedValueOnce({ok:true,json:async()=>({access_token:'synthetic-token',expires_in:3600})});
 });
 test.each([201,401,403,429,500])('status %i never retries a message within the same fence',async status=>{
  const sender=await prepareSingleLineWorksDelivery('group/id','frozen text');expect(fetch).toHaveBeenCalledTimes(1);
  (fetch as jest.Mock).mockResolvedValueOnce({status});expect((await sender()).outcome).toBe(status===201?'delivered':status===500?'uncertain':'rejected');
  expect(fetch).toHaveBeenCalledTimes(2);expect((fetch as jest.Mock).mock.calls[1][0]).toContain('/channels/group%2Fid/messages');
 });
 test('network loss after fence remains unknown',async()=>{
  const sender=await prepareSingleLineWorksDelivery('x','x');(fetch as jest.Mock).mockRejectedValueOnce(new Error('private response'));
  expect((await sender()).outcome).toBe('uncertain');expect(fetch).toHaveBeenCalledTimes(2);
 });
});
