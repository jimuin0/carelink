/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
const mockPayjp = { createCustomer: jest.fn(), addDefaultCard: jest.fn() };
jest.mock('../payjp', () => ({
  ...jest.requireActual('../payjp'),
  createCustomer: (...a: unknown[]) => mockPayjp.createCustomer(...a),
  addDefaultCard: (...a: unknown[]) => mockPayjp.addDefaultCard(...a),
}));
import { ensureFacilityCustomer } from '../payjp-customer';
import { PayjpError } from '../payjp';
import { createFakeSupabase, type FakeResult } from '@/test-utils/fake-supabase';

function make(read: FakeResult = { data: null }, insert?: FakeResult) {
  return createFakeSupabase((c) => (c.op === 'select' ? read : insert));
}
beforeEach(() => { mockPayjp.createCustomer.mockReset(); mockPayjp.addDefaultCard.mockReset(); });

test('無ければ customer を作って保存する', async () => {
  mockPayjp.createCustomer.mockResolvedValue({ id: 'cus_new' });
  const db = make();
  await expect(ensureFacilityCustomer(db.client as never, 'f1', 'tok_1')).resolves.toEqual({ ok: true, customerId: 'cus_new' });
  expect(db.calls[1].payload).toEqual({ facility_id: 'f1', payjp_customer_id: 'cus_new' });
});
test('既存の customer にはカードを差し替える', async () => {
  const db = make({ data: { payjp_customer_id: 'cus_old' } });
  await expect(ensureFacilityCustomer(db.client as never, 'f1', 'tok_1')).resolves.toEqual({ ok: true, customerId: 'cus_old' });
  expect(mockPayjp.addDefaultCard).toHaveBeenCalledWith('cus_old', 'tok_1');
});
test('読み取り・保存の失敗は error', async () => {
  expect(await ensureFacilityCustomer(make({ error: { message: 'x' } }).client as never, 'f1', 'tok_1')).toMatchObject({ ok: false, reason: 'error', tag: 'customer-read' });
  mockPayjp.createCustomer.mockResolvedValue({ id: 'cus_new' });
  const r = await ensureFacilityCustomer(make({ data: null }, { error: { message: 'dup' } }).client as never, 'f1', 'tok_1');
  expect(r).toMatchObject({ ok: false, reason: 'error', tag: 'customer-save' });
  expect(String((r as { error: Error }).error.message)).toContain('cus_new');
});
test('カード拒否は card、それ以外の PAY.JP 障害は error', async () => {
  mockPayjp.createCustomer.mockRejectedValue(new PayjpError('declined', 402, 'card_error'));
  expect(await ensureFacilityCustomer(make().client as never, 'f1', 'tok_1')).toEqual({ ok: false, reason: 'card' });
  mockPayjp.createCustomer.mockRejectedValue(new PayjpError('down', 500));
  expect(await ensureFacilityCustomer(make().client as never, 'f1', 'tok_1')).toMatchObject({ ok: false, reason: 'error', tag: 'customer' });
});
