/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { isCreatableNewsletterType, NEWSLETTER_CREATABLE_TYPES, NEWSLETTER_TYPE_UNAVAILABLE_MESSAGE } from '../newsletter-types';

// 宛先を作る経路があるのは施設オーナー向けだけ。ユーザー向けを作れるように戻すなら、先に同意（オプトイン）を
// 記録する経路と宛先の作り方を用意すること（特定電子メール法）。
test('only the owner newsletter can be created', () => {
  expect(NEWSLETTER_CREATABLE_TYPES).toEqual(['owner_monthly']);
  expect(isCreatableNewsletterType('owner_monthly')).toBe(true);
  for (const legacy of ['user_digest', 'user_coupon', 'promo', 'all', '', null, undefined, 1]) {
    expect(isCreatableNewsletterType(legacy)).toBe(false);
  }
  expect(NEWSLETTER_TYPE_UNAVAILABLE_MESSAGE).toContain('施設オーナー向けのみ');
});
