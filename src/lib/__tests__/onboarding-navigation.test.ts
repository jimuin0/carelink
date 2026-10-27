/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { navigateAfterFacilitySetup } from '../onboarding-navigation';
import { getMembershipCacheKey } from '../admin-membership-cache-key';

test('successful setup performs a fresh same-origin request, not a cached App Router transition', () => {
  const replace = jest.fn();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { replace } } });
  try {
    navigateAfterFacilitySetup();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/admin');
    navigateAfterFacilitySetup('68000000-0000-4000-8000-000000000001');
    expect(replace).toHaveBeenLastCalledWith('/admin?facility_id=68000000-0000-4000-8000-000000000001');
  } finally {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

test('the invalidated cookie uses the middleware identity without hyphens', () => {
  expect(getMembershipCacheKey('12345678-1234-4321-8123-123456789abc')).toBe('_cm_mbr_1234567812344321');
});
