import { INTAKE_CUSTOMER_ENABLED } from '../intake-config';

/**
 * 【監査M2/H1】問診の顧客向け公開ゲート定数。ローンチでは非表示（false）が神原さんの決定。
 * 再開時（閲覧UI M2 実装後）に true へ戻す運用のため、型（boolean）と現在値を固定しておく。
 */
describe('INTAKE_CUSTOMER_ENABLED', () => {
  test('boolean 型の単一ゲート定数である', () => {
    expect(typeof INTAKE_CUSTOMER_ENABLED).toBe('boolean');
  });

  test('ローンチ方針：問診は顧客に非表示（false）', () => {
    expect(INTAKE_CUSTOMER_ENABLED).toBe(false);
  });
});
