/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { checkChatLimit, chatDailyLimit, chatUsageCount, CHAT_DAILY_WINDOW_MS } from '../chat-rate-limit';
import { createServiceRoleClient } from '../supabase-server';
jest.mock('../supabase-server', () => ({ createServiceRoleClient: jest.fn() }));
const rpc = jest.fn();
beforeEach(() => { jest.clearAllMocks(); (createServiceRoleClient as jest.Mock).mockReturnValue({ rpc }); });
afterEach(() => { jest.useRealTimers(); });

test.each([undefined, ''])('undefined or empty limit uses finite default: %s', value => {
  expect(chatDailyLimit(value)).toBe(100);
});
test.each(['0', '-1', '1.5', '01', '1e2', ' ', 'NaN', 'Infinity', '100001', '9999999999999999999999999999999999'])('invalid configured quota stops paid calls: %s', value => {
  expect(chatDailyLimit(value)).toBeNull();
});
test.each(['1', '100', '100000'])('valid quota is exact: %s', value => { expect(chatDailyLimit(value)).toBe(Number(value)); });
test.each([null, undefined, 'secret input must not be logged', -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('usage admits no private/malformed value %s', value => {
  expect(chatUsageCount(value)).toBeUndefined();
});
test.each([0, 13, Number.MAX_SAFE_INTEGER])('usage admits nonnegative integer %s', value => { expect(chatUsageCount(value)).toBe(value); });
test.each([[false, 'allowed'], [true, 'limited']])('distributed burst verdict %s', async (data, verdict) => {
  rpc.mockResolvedValue({ data, error: null });
  expect(await checkChatLimit('chat:synthetic', 5, 60000)).toBe(verdict);
  expect(rpc).toHaveBeenCalledWith('check_rate_limit', { p_key: 'chat:synthetic', p_limit: 5, p_window_ms: 60000 });
});
test.each([null, undefined, 0, 1, 'false', {}, []])('unconfirmed quota data fails closed: %j', async data => {
  rpc.mockResolvedValue({ data, error: null });
  expect(await checkChatLimit('chat:synthetic', 5, 60000)).toBe('unavailable');
});
test('data plus error fails closed, including allowed-looking false', async () => {
  rpc.mockResolvedValue({ data: false, error: { message: 'synthetic' } });
  expect(await checkChatLimit('chat:synthetic', 5, 60000)).toBe('unavailable');
});
test('constructor and thrown RPC failures cannot activate memory fallback', async () => {
  (createServiceRoleClient as jest.Mock).mockImplementationOnce(() => { throw new Error('synthetic'); });
  expect(await checkChatLimit('chat:synthetic', 5, 60000)).toBe('unavailable');
  rpc.mockRejectedValueOnce(new Error('synthetic'));
  expect(await checkChatLimit('chat:synthetic', 5, 60000)).toBe('unavailable');
});
test.each([{ data: null, error: null }, { data: 0, error: null }, { data: '1', error: null }, { data: 1, error: {} }])('daily retention must be installed %j', async response => {
  rpc.mockResolvedValue(response);
  expect(await checkChatLimit('chat-daily:global', 100, CHAT_DAILY_WINDOW_MS)).toBe('unavailable');
  expect(rpc).toHaveBeenCalledTimes(1);
});
test('global counter across instances uses same key and 24h window after retention proof', async () => {
  rpc.mockResolvedValueOnce({ data: 1, error: null }).mockResolvedValueOnce({ data: false, error: null });
  expect(await checkChatLimit('chat-daily:global', 100, CHAT_DAILY_WINDOW_MS)).toBe('allowed');
  expect(rpc).toHaveBeenLastCalledWith('check_rate_limit', { p_key: 'chat-daily:global', p_limit: 100, p_window_ms: 86400000 });
});
test('stalled RPC stops at 3s; late success cannot revise unavailable result', async () => {
  jest.useFakeTimers(); let finish!: (value: unknown) => void;
  rpc.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const pending = checkChatLimit('chat:synthetic', 5, 60000);
  await jest.advanceTimersByTimeAsync(3000);
  expect(await pending).toBe('unavailable');
  finish({ data: false, error: null }); await Promise.resolve();
  expect(jest.getTimerCount()).toBe(0);
});
test('late retention result cannot reserve quota after deadline', async () => {
  jest.useFakeTimers(); let finish!: (value: unknown) => void;
  rpc.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const pending = checkChatLimit('chat-daily:global', 100, CHAT_DAILY_WINDOW_MS);
  await jest.advanceTimersByTimeAsync(3000); expect(await pending).toBe('unavailable');
  finish({ data: 1, error: null }); await Promise.resolve(); await Promise.resolve();
  expect(rpc).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
test.each([3000, 3100])('retention elapsed %ims prevents a counter start even before its timer callback', async elapsed => {
  jest.useFakeTimers(); const started = Date.now();
  rpc.mockImplementation(async name => {
    expect(name).toBe('chat_quota_retention_version');
    jest.setSystemTime(started + elapsed);
    return { data: 1, error: null };
  });
  expect(await checkChatLimit('chat-daily:global',100,CHAT_DAILY_WINDOW_MS)).toBe('unavailable');
  expect(rpc).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
test('slow client construction cannot start a burst reservation after deadline', async () => {
  jest.useFakeTimers(); const started=Date.now();
  (createServiceRoleClient as jest.Mock).mockImplementationOnce(() => {
    jest.setSystemTime(started+3001); return { rpc };
  });
  expect(await checkChatLimit('chat:synthetic',5,60000)).toBe('unavailable');
  expect(rpc).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});
test.each([false,true])('already-started quota data %s after deadline is unknown and never refunded/retried', async data => {
  jest.useFakeTimers(); const started=Date.now();
  rpc.mockImplementation(async name => {
    expect(name).toBe('check_rate_limit'); jest.setSystemTime(started+3000);
    return { data,error:null };
  });
  expect(await checkChatLimit('chat:synthetic',5,60000)).toBe('unavailable');
  expect(rpc).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
test('a completed reservation before the deadline remains allowed', async () => {
  jest.useFakeTimers(); const started=Date.now();
  rpc.mockImplementation(async name=> {
    if (name==='chat_quota_retention_version') { jest.setSystemTime(started+2000); return {data:1,error:null}; }
    jest.setSystemTime(started+2999); return {data:false,error:null};
  });
  expect(await checkChatLimit('chat-daily:global',100,CHAT_DAILY_WINDOW_MS)).toBe('allowed');
  expect(rpc).toHaveBeenCalledTimes(2); expect(jest.getTimerCount()).toBe(0);
});
