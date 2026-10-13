/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { isStoreManagementRedirect } from '../store-login';

test.each([
  ['/admin', true], ['/admin/bookings?date=2026-10-13', true], ['/admin/reviews#pending', true],
  ['/admin/onboarding', false], ['/admin/onboarding?facility_name=test', false],
  ['/admin/onboarding/other', true], ['/administrator', false], ['/mypage', false],
])('store login destination %s -> %s', (path, expected) => {
  expect(isStoreManagementRedirect(path)).toBe(expected);
});
