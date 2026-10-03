import { UUID_REGEX } from '@/lib/constants';

/** Carry the explicit store through tenant-aware management navigation only.
 * Destination pages still independently verify membership before any read/write.
 */
export function adminFacilityHref(href: string, facilityId: string | null): string {
  if (!facilityId || !UUID_REGEX.test(facilityId)) return href;
  const [path, query] = href.split('?');
  const scoped = ['/admin', '/admin/menus', '/admin/staff', '/admin/analytics', '/admin/settings', '/admin/photos', '/admin/schedule', '/admin/bookings'];
  if (!scoped.some(base => path === base || (base !== '/admin' && path.startsWith(`${base}/`)))) return href;
  const params = new URLSearchParams(query);
  params.set('facility_id', facilityId);
  return `${path}?${params.toString()}`;
}
