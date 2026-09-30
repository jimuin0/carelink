/** Facility membership does not grant platform support privileges. This
 * allowlist only selects routes on which the verified DB platform role may
 * replace facility membership; page/API authorization remains mandatory. */
export function isPlatformSupportPath(pathname: string): boolean {
  return ['/admin/inquiries', '/admin/registrations'].some(
    root => pathname === root || pathname.startsWith(`${root}/`),
  );
}
