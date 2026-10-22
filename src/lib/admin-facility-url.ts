import { UUID_REGEX } from '@/lib/constants';

/** Carry the explicit store through tenant-aware management navigation only.
 * Destination pages still independently verify membership before any read/write.
 */
export function adminFacilityHref(href: string, facilityId: string | null): string {
  if (!facilityId || !UUID_REGEX.test(facilityId)) return href;
  const [path, query] = href.split('?');
  // 2026年10月22日: Q&A・回数券・月額プラン・カタログ・ブログ・会計連携・QRコード・外部API・ファネル・
  // 利用状況も店舗を選んで使う画面になった。ここに無いと、ナビで移動したときに選んだ店舗が落ちる
  // （クーポン・GBP・ホワイトラベルは店舗選択を持っていたのに載っておらず、同じく落ちていた）。
  // /admin/jobs は全店舗の求人をまとめて出す一覧なので載せない（応募一覧 /admin/jobs/applications も同じ）。
  const scoped = ['/admin', '/admin/menus', '/admin/staff', '/admin/analytics', '/admin/settings', '/admin/photos', '/admin/schedule', '/admin/bookings', '/admin/reviews', '/admin/facility-inquiries',
    '/admin/coupons', '/admin/gbp', '/admin/white-label',
    '/admin/qa', '/admin/packages', '/admin/subscription-plans', '/admin/catalog', '/admin/blog', '/admin/accounting', '/admin/qrcode', '/admin/api-keys', '/admin/funnel', '/admin/usage-stats'];
  if (!scoped.some(base => path === base || (base !== '/admin' && path.startsWith(`${base}/`)))) return href;
  const params = new URLSearchParams(query);
  params.set('facility_id', facilityId);
  return `${path}?${params.toString()}`;
}
