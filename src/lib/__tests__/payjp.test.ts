/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/payjp.ts（PAY.JP サーバクライアント・Phase 0）
 * env は Stryker(L4) と通常 jest の双方で動くミックスイン環境に統一。
 */
jest.mock('payjp', () => ({
  __esModule: true,
  default: jest.fn((key: string) => ({ apikey: key, charges: { create: jest.fn() } })),
}));

import Payjp from 'payjp';
import { getPayjp, isPayjpConfigured } from '../payjp';

const mockPayjp = Payjp as unknown as jest.Mock;

describe('lib/payjp', () => {
  const orig = process.env.PAYJP_SECRET_KEY;
  afterEach(() => {
    if (orig === undefined) delete process.env.PAYJP_SECRET_KEY;
    else process.env.PAYJP_SECRET_KEY = orig;
    jest.clearAllMocks();
  });

  test('PAYJP_SECRET_KEY 未設定 → getPayjp は null', () => {
    delete process.env.PAYJP_SECRET_KEY;
    expect(getPayjp()).toBeNull();
  });

  test('PAYJP_SECRET_KEY 設定済 → クライアントを返し、鍵で初期化される', () => {
    process.env.PAYJP_SECRET_KEY = 'sk_test_dummy';
    const client = getPayjp();
    expect(client).not.toBeNull();
    expect(mockPayjp).toHaveBeenCalledWith('sk_test_dummy');
  });

  test('isPayjpConfigured は鍵の有無を反映する', () => {
    delete process.env.PAYJP_SECRET_KEY;
    expect(isPayjpConfigured()).toBe(false);
    process.env.PAYJP_SECRET_KEY = 'sk_test_dummy';
    expect(isPayjpConfigured()).toBe(true);
  });
});
