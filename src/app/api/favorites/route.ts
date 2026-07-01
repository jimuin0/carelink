import { NextResponse } from 'next/server';
import { mutationRateLimit } from '@/lib/rate-limit';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute } from '@/lib/with-route';

export const dynamic = 'force-dynamic';

export const POST = withRoute(async (request, ctx) => {
  const { facilityId } = await request.json().catch(() => ({}));
  if (!facilityId || !uuidRegex.test(facilityId)) {
    return NextResponse.json({ error: '無効な施設IDです' }, { status: 400 });
  }

  // DB 操作は service_role に集約（anon ポリシー削除後も継続動作・RLS 依存排除）。
  const supabase = createServiceRoleClient();

  // Verify facility exists and is published before toggling favorite
  const { data: facility } = await supabase
    .from('facility_profiles')
    .select('id')
    .eq('id', facilityId)
    .eq('status', 'published')
    .maybeSingle();
  if (!facility) {
    return NextResponse.json({ error: '施設が見つかりません' }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from('favorites')
    .select('id')
    .eq('user_id', ctx.user!.id)
    .eq('facility_id', facilityId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from('favorites').delete().eq('id', existing.id);
    if (error) return NextResponse.json({ error: '削除に失敗しました' }, { status: 500 });
    return NextResponse.json({ isFavorited: false });
  } else {
    const { error } = await supabase.from('favorites').insert({ user_id: ctx.user!.id, facility_id: facilityId });
    if (error) return NextResponse.json({ error: '追加に失敗しました' }, { status: 500 });
    return NextResponse.json({ isFavorited: true });
  }
}, {
  csrf: true,
  requireAuth: true,
  rateLimit: { limiter: mutationRateLimit, limit: 10, windowMs: 60_000, prefix: 'favorites' },
  sentryTag: 'favorites',
});
