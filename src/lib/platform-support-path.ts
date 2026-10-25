/** Facility membership does not grant platform support privileges. This
 * allowlist only selects routes on which the verified DB platform role may
 * replace facility membership; page/API authorization remains mandatory. */
export function isPlatformSupportPath(pathname: string): boolean {
  return ['/admin/email-setup', '/admin/line-richmenu', '/admin/feature-flags', '/admin/ab-tests', '/admin/platform-blog', '/admin/features', '/admin/inquiries', '/admin/mail', '/admin/registrations', '/admin/moderation', '/admin/newsletters'].some(
    root => pathname === root || pathname.startsWith(`${root}/`),
  );
}
