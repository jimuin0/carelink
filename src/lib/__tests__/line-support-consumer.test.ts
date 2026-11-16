/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { consumeLineSupport } from '../../../tools/cloudflare/line-support-consumer';
import { enqueueLineSupportEvents,isLineSupportQueueConfigured } from '../line-support-wakeup';
const env={CRON_SECRET:'synthetic-test-secret'};
function message(body:unknown={eventId:'event'}){return {body,ack:jest.fn(),retry:jest.fn()};}
test.each([null,{},false,{eventId:1},{eventId:''},{eventId:'x'.repeat(129)}])('malformed queue item %j is discarded without app invocation',async body=>{const msg=message(body);const fetchApp=jest.fn();await consumeLineSupport({messages:[msg]},env,{},fetchApp);expect(msg.ack).toHaveBeenCalledTimes(1);expect(fetchApp).not.toHaveBeenCalled();});
test('absent credentials leave the item retryable',async()=>{const msg=message();await consumeLineSupport({messages:[msg]},{},{},jest.fn());expect(msg.retry).toHaveBeenCalledWith({delaySeconds:120});expect(msg.ack).not.toHaveBeenCalled();});
test.each([200,503])('HTTP %s is acknowledged only for a completed durable job',async status=>{const msg=message();const fetchApp=jest.fn().mockResolvedValue(new Response('{}',{status}));await consumeLineSupport({messages:[msg]},env,{},fetchApp);const req=fetchApp.mock.calls[0][0] as Request;expect(new URL(req.url).pathname).toBe('/api/line/support-work');expect(await req.json()).toEqual({eventId:'event'});expect(req.headers.get('authorization')).toBe('Bearer '+env.CRON_SECRET);expect(status===200?msg.ack:msg.retry).toHaveBeenCalledTimes(1);});
test('transport failure retries without inventing another event ID',async()=>{const msg=message();await consumeLineSupport({messages:[msg]},env,{},jest.fn().mockRejectedValue(new Error('unavailable')));expect(msg.retry).toHaveBeenCalledWith({delaySeconds:120});});
test('Next-only runtime fails closed instead of pretending background work is durable',async()=>{await expect(enqueueLineSupportEvents(['event'])).rejects.toThrow('not configured');});
test('empty verification or pairing callbacks need no background worker',async()=>{await expect(enqueueLineSupportEvents([])).resolves.toBeUndefined();});

test('Next-only runtime cannot report a durable queue as configured',()=>{expect(isLineSupportQueueConfigured()).toBe(false);});
