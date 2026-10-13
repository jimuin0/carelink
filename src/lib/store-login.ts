/** Store management login stays available to an already signed-in customer.
 * Onboarding keeps its existing direct continuation after registration. */
export function isStoreManagementRedirect(redirect: string): boolean {
  const path = redirect.split(/[?#]/)[0];
  return path !== '/admin/onboarding' && (path === '/admin' || path.startsWith('/admin/'));
}
