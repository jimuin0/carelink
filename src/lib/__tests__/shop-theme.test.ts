import { isEcruShopPath } from '../shop-theme';

test.each(['/register', '/register/complete', '/register/recover', '/admin', '/admin/onboarding', '/admin/bookings/123'])('%s は店舗向け', path => {
  expect(isEcruShopPath(path)).toBe(true);
});
test.each(['/', '/search', '/facility/shop/booking', '/mypage', '/salon', '/registers', '/administrator', '/admin-old', null, undefined, ''])('%s は店舗向けではない', path => {
  expect(isEcruShopPath(path)).toBe(false);
});
test.each(['/auth/login', '/auth/signup', '/auth/forgot-password', '/auth/reset-password'])('%s は戻り先で出し分ける', path => {
  for (const target of ['/admin', '/admin/onboarding?handoff=registration', '/admin/bookings#today', '/register/recover']) {
    expect(isEcruShopPath(path, target)).toBe(true);
  }
  for (const target of [null, '', '/mypage', '/administrator', '//evil.example/admin', 'https://evil.example/admin', '/registers']) {
    expect(isEcruShopPath(path, target)).toBe(false);
  }
});
test('来院者向け画面は redirect だけでは店舗テーマへ変わらない', () => {
  expect(isEcruShopPath('/search', '/admin')).toBe(false);
});
