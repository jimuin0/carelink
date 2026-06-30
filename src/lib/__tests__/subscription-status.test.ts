/**
 * subscription-status SSOT のテスト。
 * - 許可遷移表が UI の提示と一致する
 * - cancelled→active（誤解約の復活）が許可される（神原さん確定方針）
 * - expired からの手動遷移は無い
 * - getAllowedSubscriptionStatusTransitions の `?? []` フォールバック両分岐
 */
import {
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABEL,
  ALLOWED_SUBSCRIPTION_STATUS_TRANSITIONS,
  getAllowedSubscriptionStatusTransitions,
  isAllowedSubscriptionStatusTransition,
  type SubscriptionStatus,
} from '@/lib/subscription-status';

describe('subscription-status SSOT', () => {
  test('SUBSCRIPTION_STATUSES はラベルの全キー（4状態）', () => {
    expect(SUBSCRIPTION_STATUSES.sort()).toEqual(['active', 'cancelled', 'expired', 'paused']);
    for (const s of SUBSCRIPTION_STATUSES) {
      expect(typeof SUBSCRIPTION_STATUS_LABEL[s]).toBe('string');
    }
  });

  test('active の許可遷移＝一時停止 / 解約', () => {
    expect(getAllowedSubscriptionStatusTransitions('active').sort()).toEqual(['cancelled', 'paused']);
  });

  test('paused の許可遷移＝再開(active) / 解約', () => {
    expect(getAllowedSubscriptionStatusTransitions('paused').sort()).toEqual(['active', 'cancelled']);
  });

  test('cancelled→active（誤解約の復活）は許可', () => {
    expect(isAllowedSubscriptionStatusTransition('cancelled', 'active')).toBe(true);
    // 解約から一時停止など他状態へは不可
    expect(isAllowedSubscriptionStatusTransition('cancelled', 'paused')).toBe(false);
    expect(isAllowedSubscriptionStatusTransition('cancelled', 'expired')).toBe(false);
  });

  test('expired からの手動遷移は無い', () => {
    expect(getAllowedSubscriptionStatusTransitions('expired')).toEqual([]);
    expect(isAllowedSubscriptionStatusTransition('expired', 'active')).toBe(false);
  });

  test('手動で expired へは遷移できない（ends_at 由来のシステム状態）', () => {
    for (const from of SUBSCRIPTION_STATUSES) {
      expect(isAllowedSubscriptionStatusTransition(from, 'expired')).toBe(false);
    }
  });

  test('同状態への遷移は不許可（無意味な再書込防止）', () => {
    for (const s of SUBSCRIPTION_STATUSES) {
      expect(isAllowedSubscriptionStatusTransition(s, s)).toBe(false);
    }
  });

  test('未知ステータスは空配列（?? [] フォールバック）', () => {
    expect(getAllowedSubscriptionStatusTransitions('unknown' as SubscriptionStatus)).toEqual([]);
    expect(isAllowedSubscriptionStatusTransition('unknown' as SubscriptionStatus, 'active')).toBe(false);
  });

  test('遷移表のキーは全状態を網羅', () => {
    expect(Object.keys(ALLOWED_SUBSCRIPTION_STATUS_TRANSITIONS).sort()).toEqual(
      ['active', 'cancelled', 'expired', 'paused'],
    );
  });
});
