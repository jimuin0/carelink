import { NextResponse } from 'next/server';
import { mutationRateLimit } from '@/lib/rate-limit';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute, serverError } from '@/lib/with-route';

export const dynamic = 'force-dynamic';

export const POST = withRoute(async (request, ctx) => {
  const body: unknown = await request.json().catch(() => null);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: '無効な施設IDです' }, { status: 400 });
  const facilityId = (body as Record<string, unknown>).facilityId;
  if (typeof facilityId !== 'string' || !uuidRegex.test(facilityId)) return NextResponse.json({ error: '無効な施設IDです' }, { status: 400 });
  const { data, error } = await createServiceRoleClient().rpc('toggle_user_favorite_atomic', {
    p_actor_id: ctx.user!.id, p_facility_id: facilityId,
  });
  if (error?.code === 'P0002') return NextResponse.json({ error: '施設が見つかりません' }, { status: 404 });
  if (error || typeof data !== 'boolean') return serverError('favorites-toggle', new Error('FAVORITE_MUTATION_UNCONFIRMED'), '/api/favorites', 'お気に入りを変更できませんでした。現在の状態を確認してください。');
  return NextResponse.json({ isFavorited: data }, { headers: { 'Cache-Control': 'no-store' } });

}, {
  csrf: true,
  requireAuth: true,
  rateLimit: { limiter: mutationRateLimit, limit: 10, windowMs: 60_000, prefix: 'favorites' },
  sentryTag: 'favorites',
});
