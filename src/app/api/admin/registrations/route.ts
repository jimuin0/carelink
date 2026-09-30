import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute, serverError, type RouteContext } from '@/lib/with-route';
import { readRegistrationList } from '@/lib/registration-list';

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };
async function list(value: unknown, ctx: RouteContext) {
  try {
    const profile = await ctx.supabase!.from('profiles').select('is_platform_admin')
      .eq('id', ctx.user!.id).maybeSingle();
    if (profile.error !== null) throw new Error('Registration authorization unavailable');
    if (profile.data?.is_platform_admin !== true) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers });
    }
    const result = await readRegistrationList(createServiceRoleClient(), value);
    if (result.state === 'invalid') return NextResponse.json({ error: '検索条件を確認してください' }, { status: 400, headers });
    if (result.state === 'unavailable') throw new Error('Registration list unavailable');
    return NextResponse.json({ salons: result.salons, nextCursor: result.nextCursor }, { headers });
  } catch {
    // Provider exceptions may contain search terms. Report only a fixed category.
    return serverError('admin-registrations-list', new Error('Registration list dependency failure'),
      '/api/admin/registrations', '取得に失敗しました。申込なしとは判定できません。');
  }
}
const post = withRoute(async (request, ctx) => list(await request.json().catch(() => null), ctx), {
  csrf: true, requireAuth: true,
  rateLimit: { limiter: null, limit: 30, windowMs: 60_000, prefix: 'admin-registrations-get' },
  sentryTag: 'admin-registrations-list',
});
const get = withRoute(async (_request, ctx) => list({}, ctx), {
  csrf: false, requireAuth: true,
  rateLimit: { limiter: null, limit: 30, windowMs: 60_000, prefix: 'admin-registrations-get' },
  sentryTag: 'admin-registrations-list',
});
export async function POST(request: Request) {
  const response = await post(request);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
export async function GET(request: Request) {
  const response = await get(request);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
