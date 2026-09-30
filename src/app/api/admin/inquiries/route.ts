import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute, serverError, type RouteContext } from '@/lib/with-route';
import { inquiryListInput } from '@/lib/admin-inquiry-list-contract';
import { readAdminInquiryList } from '@/lib/admin-inquiry-list';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
const allowedQueryKeys = new Set(['status', 'cursor']);

function parseRequest(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => !allowedQueryKeys.has(key))) return null;
  if (params.getAll('status').length > 1 || params.getAll('cursor').length > 1) return null;

  const rawCursor = params.get('cursor');
  let cursor: unknown = null;
  if (rawCursor !== null) {
    try {
      cursor = JSON.parse(rawCursor);
    } catch {
      return null;
    }
  }
  const input = inquiryListInput.safeParse({
    status: params.get('status') ?? undefined,
    cursor,
  });
  return input.success ? input.data : null;
}

async function list(request: Request, ctx: RouteContext) {
  try {
    const input = parseRequest(request);
    if (input === null) return NextResponse.json({ error: '検索条件を確認してください' }, { status: 400, headers });

    const profile = await ctx.supabase!.from('profiles').select('is_platform_admin')
      .eq('id', ctx.user!.id).maybeSingle();
    if (profile.error !== null) {
      return serverError('admin-inquiries-list-auth', new Error('Admin inquiry authorization unavailable'),
        '/api/admin/inquiries', '問い合わせの読み込みに失敗しました。');
    }
    if (profile.data?.is_platform_admin !== true) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers });
    }

    const result = await readAdminInquiryList(createServiceRoleClient(), input);
    if (result.state === 'invalid') return NextResponse.json({ error: '検索条件を確認してください' }, { status: 400, headers });
    if (result.state === 'unavailable') {
      return serverError('admin-inquiries-list', new Error(`Admin inquiry list failure: ${result.reason}`),
        '/api/admin/inquiries', '問い合わせの読み込みに失敗しました。');
    }
    return NextResponse.json({ contacts: result.contacts, nextCursor: result.nextCursor }, { headers });
  } catch {
    return serverError('admin-inquiries-list', new Error('Admin inquiry list dependency failure'),
      '/api/admin/inquiries', '問い合わせの読み込みに失敗しました。');
  }
}

const get = withRoute(list, {
  csrf: false,
  requireAuth: true,
  rateLimit: { limiter: null, limit: 30, windowMs: 60_000, prefix: 'admin-inquiries-list' },
  sentryTag: 'admin-inquiries-list',
});

export async function GET(request: Request) {
  const response = await get(request);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
