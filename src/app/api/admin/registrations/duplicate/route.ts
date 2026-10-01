import { NextResponse } from 'next/server';
import { withRoute, serverError } from '@/lib/with-route';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { duplicateLinkInput } from '@/lib/registration-duplicate-contract';
import { linkDuplicateRegistration } from '@/lib/registration-duplicate';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export const POST = withRoute(async (request, ctx) => {
  try {
    const profile = await ctx.supabase!.from('profiles').select('is_platform_admin').eq('id', ctx.user!.id).maybeSingle();
    if (profile.error !== null) throw new Error('Authorization unavailable');
    if (profile.data?.is_platform_admin !== true) return NextResponse.json({ outcome: 'forbidden' }, { status: 403, headers });
    const input = duplicateLinkInput.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ outcome: 'invalid' }, { status: 400, headers });
    const result = await linkDuplicateRegistration(createServiceRoleClient(), ctx.user!.id, input.data);
    const status = result.outcome === 'forbidden' ? 403 : result.outcome === 'invalid' ? 400 : result.outcome === 'conflict' ? 409 : 200;
    return NextResponse.json(result, { status, headers });
  } catch {
    // Do not include customer identity or provider raw error in incident output.
    const response = serverError('registration-duplicate', new Error('Registration linkage dependency failure'),
      '/api/admin/registrations/duplicate', '結果を確認できません。再送・再作成せず、比較を再取得してください。');
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}, { csrf: true, requireAuth: true,
  rateLimit: { limiter: null, limit: 10, windowMs: 60_000, prefix: 'registration-duplicate' },
  sentryTag: 'registration-duplicate',
});
