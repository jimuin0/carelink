/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  PAYJP_API_BASE, PayjpError, addDefaultCard, cancelSubscription, createCustomer, createSubscription,
  isCardError, planMatchesFeaturedPrice, retrievePlan, verifyPayjpWebhookToken,
  FEATURED_AD_PRICE_TAX_EXCLUDED, FEATURED_AD_PRICE_TAX_INCLUDED,
} from '../payjp';

const fetchMock = jest.fn();
const ENV = { ...process.env };
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  process.env = { ...ENV, PAYJP_SECRET_KEY: 'sk_test_abc', PAYJP_WEBHOOK_TOKEN: 'whook_secret' };
});
afterAll(() => { process.env = ENV; });

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number, body: unknown) => ({ ok: false, status, json: async () => body });

test('税込月額は税抜 9,800 円＋消費税 10%', () => {
  expect(FEATURED_AD_PRICE_TAX_INCLUDED).toBe(Math.round(FEATURED_AD_PRICE_TAX_EXCLUDED * 1.1));
});

test('GET は Basic 認証（秘密鍵:空パスワード）で本文なし', async () => {
  fetchMock.mockResolvedValue(ok({ id: 'pln_1', amount: 10780, currency: 'jpy', interval: 'month' }));
  await expect(retrievePlan('pln 1')).resolves.toMatchObject({ id: 'pln_1' });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${PAYJP_API_BASE}/plans/pln%201`);
  expect(init.method).toBe('GET');
  expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('sk_test_abc:').toString('base64')}`);
  expect(init.headers['Content-Type']).toBeUndefined();
  expect(init.body).toBeUndefined();
});

test('customer 作成はトークンと metadata をフォーム形式で送る（カード番号は送らない）', async () => {
  fetchMock.mockResolvedValue(ok({ id: 'cus_1' }));
  await createCustomer('tok_x', 'fac-1');
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${PAYJP_API_BASE}/customers`);
  expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  const body = new URLSearchParams(init.body);
  expect(body.get('card')).toBe('tok_x');
  expect(body.get('metadata[facility_id]')).toBe('fac-1');
});

test('カード差し替え・定期課金の作成・解約の送り先と引数', async () => {
  fetchMock.mockResolvedValue(ok({ id: 'x' }));
  await addDefaultCard('cus_1', 'tok_y');
  await createSubscription('cus_1', 'pln_1', { slot_id: 's1', facility_id: 'f1' });
  await cancelSubscription('sub_1');
  expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
    `${PAYJP_API_BASE}/customers/cus_1/cards`, `${PAYJP_API_BASE}/subscriptions`, `${PAYJP_API_BASE}/subscriptions/sub_1/cancel`,
  ]);
  expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get('default')).toBe('true');
  const sub = new URLSearchParams(fetchMock.mock.calls[1][1].body);
  expect([sub.get('customer'), sub.get('plan'), sub.get('metadata[slot_id]'), sub.get('metadata[facility_id]')]).toEqual(['cus_1', 'pln_1', 's1', 'f1']);
  expect(fetchMock.mock.calls[2][1].body).toBeUndefined();
});

test('PAY.JP のエラー本文を PayjpError に写す', async () => {
  fetchMock.mockResolvedValue(fail(402, { error: { message: 'declined', type: 'card_error', code: 'card_declined' } }));
  const err = await retrievePlan('p').catch((e) => e);
  expect(err).toBeInstanceOf(PayjpError);
  expect([err.status, err.type, err.code, err.message]).toEqual([402, 'card_error', 'card_declined', 'declined']);
});

test('エラー本文が JSON でなくても HTTP 状態で失敗にする', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => { throw new Error('html'); } });
  await expect(retrievePlan('p')).rejects.toMatchObject({ status: 503, message: 'PAY.JP HTTP 503' });
});

test('成功なのに JSON でない応答は失敗', async () => {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('x'); } });
  await expect(retrievePlan('p')).rejects.toMatchObject({ type: 'invalid_response' });
});

test.each([[new Error('reset'), 'PAY.JP request failed: reset'], ['boom', 'PAY.JP request failed: unknown']])('通信失敗 %p は network_error', async (thrown, message) => {
  fetchMock.mockRejectedValue(thrown);
  await expect(retrievePlan('p')).rejects.toMatchObject({ type: 'network_error', status: 0, message });
});

test('秘密鍵が無ければ通信しない', async () => {
  delete process.env.PAYJP_SECRET_KEY;
  await expect(retrievePlan('p')).rejects.toMatchObject({ type: 'configuration_error' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('カードのエラーかどうか', () => {
  expect(isCardError(new PayjpError('x', 402))).toBe(true);
  expect(isCardError(new PayjpError('x', 400, 'card_error'))).toBe(true);
  expect(isCardError(new PayjpError('x', 500, 'server_error'))).toBe(false);
  expect(isCardError(new Error('x'))).toBe(false);
});

test('プランが税込月額・円・月次と一致するときだけ販売する', () => {
  const plan = { id: 'p', amount: 10780, currency: 'jpy', interval: 'month' };
  expect(planMatchesFeaturedPrice(plan)).toBe(true);
  expect(planMatchesFeaturedPrice({ ...plan, amount: 9800 })).toBe(false);
  expect(planMatchesFeaturedPrice({ ...plan, currency: 'usd' })).toBe(false);
  expect(planMatchesFeaturedPrice({ ...plan, interval: 'year' })).toBe(false);
});

test('webhook トークンの照合', () => {
  expect(verifyPayjpWebhookToken('whook_secret')).toBe(true);
  expect(verifyPayjpWebhookToken('whook_secreX')).toBe(false);
  expect(verifyPayjpWebhookToken('short')).toBe(false);
  expect(verifyPayjpWebhookToken(null)).toBe(false);
  delete process.env.PAYJP_WEBHOOK_TOKEN;
  expect(verifyPayjpWebhookToken('whook_secret')).toBe(false);
});

describe('2026年11月14日に足した支払い・プラン', () => {
  test('createPlan は月額・円でフォーム送信する', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'pln_x' }));
    const { createPlan } = await import('../payjp');
    await createPlan('pln_x', 1500, 'name');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${PAYJP_API_BASE}/plans`);
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ id: 'pln_x', amount: '1500', currency: 'jpy', interval: 'month', name: 'name' });
  });
  test('createCharge はトークン・金額・metadata を送る', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'ch_1', paid: true }));
    const { createCharge } = await import('../payjp');
    await createCharge('tok_1', 5000, 'desc', { payment_id: 'p1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${PAYJP_API_BASE}/charges`);
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ card: 'tok_1', amount: '5000', currency: 'jpy', description: 'desc', 'metadata[payment_id]': 'p1' });
  });
  test('isNotFound は PAY.JP の 404 だけ', async () => {
    const { isNotFound } = await import('../payjp');
    expect(isNotFound(new PayjpError('x', 404))).toBe(true);
    expect(isNotFound(new PayjpError('x', 500))).toBe(false);
    expect(isNotFound(new Error('x'))).toBe(false);
  });
});
