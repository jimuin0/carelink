import { adminFacilityHref } from '../admin-facility-url';
const id = '00000000-0000-4000-8000-000000000002';
test.each([null, '', 'bad'])('missing/invalid selection leaves link intact %s', value => {
  expect(adminFacilityHref('/admin/menus', value)).toBe('/admin/menus');
});
test.each(['/admin', '/admin/menus', '/admin/staff/new', '/admin/staff/synthetic/edit', '/admin/analytics', '/admin/settings', '/admin/photos', '/admin/schedule', '/admin/bookings'])('carry selected store %s', path => {
  expect(adminFacilityHref(path, id)).toBe(`${path}?facility_id=${id}`);
});
test('date and status filters survive store context', () => {
  const result = new URL(adminFacilityHref('/admin/bookings?from=2026-10-02&to=2026-10-02&status=pending&facility_id=old', id), 'https://example.test');
  expect(result.searchParams.get('from')).toBe('2026-10-02');
  expect(result.searchParams.get('to')).toBe('2026-10-02');
  expect(result.searchParams.get('status')).toBe('pending');
  expect(result.searchParams.get('facility_id')).toBe(id);
});
test.each(['/admin/inquiries', '/admin/newsletters', '/administer', '/admin/menus-other', '/search', 'https://example.test/admin'])('unrelated routes remain intact %s', href => {
  expect(adminFacilityHref(href, id)).toBe(href);
});
