import { isPlatformSupportPath } from '../platform-support-path';

test.each(['/admin/inquiries', '/admin/inquiries/', '/admin/inquiries/receipt', '/admin/registrations', '/admin/registrations/receipt'])(
  'support path is explicitly scoped: %s', path => expect(isPlatformSupportPath(path)).toBe(true),
);
test.each(['', '/admin', '/admin/settings', '/admin/chain', '/admin/inquiries-evil', '/admin/registrations-evil', '/api/admin/inquiries', '/mypage'])(
  'no privilege expansion for %s', path => expect(isPlatformSupportPath(path)).toBe(false),
);
