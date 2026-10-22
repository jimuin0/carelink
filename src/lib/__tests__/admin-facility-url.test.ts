import { adminFacilityHref } from '../admin-facility-url';
const id = '00000000-0000-4000-8000-000000000002';
test.each([null, '', 'bad'])('missing/invalid selection leaves link intact %s', value => {
  expect(adminFacilityHref('/admin/menus', value)).toBe('/admin/menus');
});
test.each(['/admin', '/admin/menus', '/admin/staff/new', '/admin/staff/synthetic/edit', '/admin/analytics', '/admin/settings', '/admin/photos', '/admin/schedule', '/admin/bookings', '/admin/reviews', '/admin/facility-inquiries',
  // 2026年10月22日: 店舗を選んで使う画面になったもの（ナビで移動しても選んだ店舗が落ちない）
  '/admin/coupons', '/admin/gbp', '/admin/white-label',
  '/admin/qa', '/admin/packages', '/admin/subscription-plans', '/admin/catalog', '/admin/catalog/new', '/admin/blog', '/admin/blog/new',
  '/admin/blog/synthetic/edit', '/admin/accounting', '/admin/qrcode', '/admin/api-keys', '/admin/funnel', '/admin/usage-stats'])('carry selected store %s', path => {
  expect(adminFacilityHref(path, id)).toBe(`${path}?facility_id=${id}`);
});
test('date and status filters survive store context', () => {
  const result = new URL(adminFacilityHref('/admin/bookings?from=2026-10-02&to=2026-10-02&status=pending&facility_id=old', id), 'https://example.test');
  expect(result.searchParams.get('from')).toBe('2026-10-02');
  expect(result.searchParams.get('to')).toBe('2026-10-02');
  expect(result.searchParams.get('status')).toBe('pending');
  expect(result.searchParams.get('facility_id')).toBe(id);
});
// /admin/jobs と応募一覧は全店舗分をまとめて出すので、店舗を付けない（ヘッダーが 1 店舗だけを名乗らないように）。
test.each(['/admin/inquiries', '/admin/newsletters', '/administer', '/admin/menus-other', '/search', 'https://example.test/admin',
  '/admin/jobs', '/admin/jobs/applications', '/admin/qa-other', '/admin/blogs'])('unrelated routes remain intact %s', href => {
  expect(adminFacilityHref(href, id)).toBe(href);
});
