/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { collectNewsletterRecipients, inspectNewsletterOperation, publishNewsletterOperation } from '../newsletter-send';
jest.mock('@/lib/newsletter-unsub', () => ({ newsletterUnsubUrl: jest.fn((email: string) => `https://carelink-jp.com/unsubscribe?n=opaque-${email}`) }));
jest.mock('@/lib/email-from', () => ({ newsletterFromEnv: () => 'CareLink <newsletter@carelink-jp.com>' }));
import { newsletterUnsubUrl } from '../newsletter-unsub';
const id = 'e1000000-0000-4000-8000-000000000001';
const actor = 'e1000000-0000-4000-8000-000000000002';
const receipt = { operation_id: 'e1000000-0000-4000-8000-000000000003', campaign_id: id, total: 1, queued: 1, unconfirmed: 0, accepted: 0, suppressed: 0, failed: 0 };
type Reply = { data: unknown; error: unknown };
/**
 * pages: newsletter_current_recipients の各ページの応答（range ごとに 1 つずつ消費）。
 * operation: inspect / publish の RPC 応答。
 */
function client(pages: Reply[] = [], operation: unknown = receipt) {
  const from = jest.fn();
  const audience = jest.fn((_offset: number, _end: number) => Promise.resolve(pages.shift() ?? { data: [], error: null }));
  const operationRpc = jest.fn().mockResolvedValue({ data: operation, error: null });
  const rpc = jest.fn((name: string, args: Record<string, unknown>) => name === 'newsletter_current_recipients'
    ? { range: (offset: number, end: number) => audience(offset, end) }
    : operationRpc(name, args));
  return { from, rpc, audience, operationRpc };
}
const ok = (data: unknown) => ({ data, error: null });
const publish = (c: ReturnType<typeof client>, type = 'owner_monthly') =>
  publishNewsletterOperation(c as never, actor, { id, campaign_type: type, updated_at: '2026-10-09T00:00:00Z' }, '2026-10-09T00:00:00Z');
beforeEach(() => jest.clearAllMocks());

// 回帰（2026年10月23日）: アプリが profiles.email から宛先と配信停止を組み立てていた（本人が自由に書き換えられる値）。
// 宛先は DB の newsletter_current_recipients（確認済みのログインメール・email_address_opted_out）だけで決める。
test('the audience comes from the database definition only, never from profiles or subscriptions read by the app', async () => {
  const c = client([ok(['a@example.com', 'owner@example.com'])]);
  expect(await collectNewsletterRecipients(c as never, 'owner_monthly')).toEqual(['a@example.com', 'owner@example.com']);
  expect(c.rpc).toHaveBeenCalledWith('newsletter_current_recipients', { p_kind: 'owner_monthly' });
  expect(c.audience).toHaveBeenCalledWith(0, 999);
  expect(c.from).not.toHaveBeenCalled();
});
test('the campaign type is passed through unchanged', async () => {
  const c = client([ok(['a@example.com'])]);
  await collectNewsletterRecipients(c as never, 'user_digest');
  expect(c.rpc).toHaveBeenCalledWith('newsletter_current_recipients', { p_kind: 'user_digest' });
});
test('duplicates across pages collapse and the result is sorted', async () => {
  const c = client([ok(['b@example.com', 'a@example.com', 'b@example.com'])]);
  expect(await collectNewsletterRecipients(c as never, 'owner_monthly')).toEqual(['a@example.com', 'b@example.com']);
});
test.each([0, 1])('error with partial data on page %s stops publication', async stage => {
  const full = ok(Array.from({ length: 1000 }, (_, i) => `u${i}@example.com`));
  const pages = [full, ok(['last@example.com'])].map((r, i) => i === stage ? { ...r, error: { message: 'dependency' } } : r);
  const c = client(pages);
  await expect(publish(c)).rejects.toMatchObject({ status: 503 });
  expect(c.operationRpc).not.toHaveBeenCalled(); expect(newsletterUnsubUrl).not.toHaveBeenCalled();
});
test.each([null, {}, [42], [null], ['bad-mail'], [`${'a'.repeat(250)}@example.com`]])('missing/malformed audience never produces an envelope: %p', async data => {
  const c = client([ok(data)]);
  await expect(publish(c)).rejects.toMatchObject({ status: 503 });
  expect(c.operationRpc).not.toHaveBeenCalled();
});
test('1000 recipient boundary is paged', async () => {
  const c = client([ok(Array.from({ length: 1000 }, (_, i) => `u${i}@example.com`)), ok(['last@example.com'])]);
  expect(await collectNewsletterRecipients(c as never, 'owner_monthly')).toHaveLength(1001);
  expect(c.audience.mock.calls).toEqual([[0, 999], [1000, 1999]]);
});
test('maxRows full pages cannot silently truncate audience', async () => {
  const full = ok(Array.from({ length: 1000 }, (_, i) => `u${i}@example.com`));
  const c = client(Array.from({ length: 100 }, () => full));
  await expect(collectNewsletterRecipients(c as never, 'owner_monthly')).rejects.toMatchObject({ status: 503 });
  expect(c.audience).toHaveBeenCalledTimes(100);
});
test('publication snapshots links once and RPC uses observed revision and the database audience, never claims directly', async () => {
  const c = client([ok(['a@example.com'])]);
  await expect(publish(c)).resolves.toEqual(receipt);
  expect(c.operationRpc).toHaveBeenCalledWith('publish_newsletter_send_operation', expect.objectContaining({ p_expected_revision: '2026-10-09T00:00:00Z', p_expected_emails: ['a@example.com'] }));
  expect(newsletterUnsubUrl).toHaveBeenCalledTimes(1);
});
test.each([undefined, 'bad', '2026-10-08T00:00:00Z'])('old/stale consumer revision %p stops before reads', async revision => {
  const c = client();
  await expect(publishNewsletterOperation(c as never, actor, { id, campaign_type: 'owner_monthly', updated_at: '2026-10-09T00:00:00Z' }, revision)).rejects.toMatchObject({ status: 409 });
  expect(c.rpc).not.toHaveBeenCalled();
});
test('no recipients is a visible pre-publication rejection', async () => {
  const c = client([ok([])]);
  await expect(publish(c)).rejects.toMatchObject({ status: 409 });
  expect(c.operationRpc).not.toHaveBeenCalled();
});
test.each([['42501', 403], ['40001', 409], ['23514', 409], ['PGRST202', 503]])('RPC %s refuses phantom receipt', async (code, status) => {
  const c = client(); c.operationRpc.mockResolvedValue({ data: receipt, error: { code } });
  await expect(inspectNewsletterOperation(c as never, actor, id)).rejects.toMatchObject({ status });
});
test.each([undefined, [], { ...receipt, total: 2 }, { ...receipt, campaign_id: actor }])('malformed/replayed other-campaign receipt fails: %p', async data => {
  const c = client(); c.operationRpc.mockResolvedValue({ data, error: null });
  await expect(inspectNewsletterOperation(c as never, actor, id)).rejects.toMatchObject({ status: 503 });
});
test('inspect replay reads no recipients or link secrets; null is definite no-operation', async () => {
  const c = client();
  expect(await inspectNewsletterOperation(c as never, actor, id)).toEqual(receipt);
  expect(c.audience).not.toHaveBeenCalled(); expect(newsletterUnsubUrl).not.toHaveBeenCalled();
  c.operationRpc.mockResolvedValue({ data: null, error: null });
  expect(await inspectNewsletterOperation(c as never, actor, id)).toBeNull();
});
test.each([undefined, 'network', {}])('unstructured/missing RPC error fails safely: %p', async error => {
  const c = client(); c.operationRpc.mockResolvedValue({ data: receipt, error });
  await expect(inspectNewsletterOperation(c as never, actor, id)).rejects.toMatchObject({ status: 503 });
});
test('publication RPC data plus concurrent audience error cannot return success', async () => {
  const c = client([ok(['a@example.com'])]); c.operationRpc.mockResolvedValue({ data: receipt, error: { code: '40001' } });
  await expect(publish(c)).rejects.toMatchObject({ status: 409 });
});
