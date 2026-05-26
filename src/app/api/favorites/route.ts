import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { mutationRateLimit } from '@/lib/rate-limit';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { withRoute } from '@/lib/with-route';

export const dynamic = 'force-dynamic';

export const POST = withRoute(async (request) => {
  const { facilityId } = await request.json().catch(() => ({}));
  if (!facilityId || !uuidRegex.test(facilityId)) {
    return NextResponse.json({ error: '無効な施設IDです' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

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
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from('favorites').delete().eq('id', existing.id);
    if (error) return NextResponse.json({ error: '削除に失敗しました' }, { status: 500 });
    return NextResponse.json({ isFavorited: false });
  } else {
    const { error } = await supabase.from('favorites').insert({ user_id: user.id, facility_id: facilityId });
    if (error) return NextResponse.json({ error: '追加に失敗しました' }, { status: 500 });
    return NextResponse.json({ isFavorited: true });
  }
}, {
  csrf: true,
  rateLimit: { limiter: mutationRateLimit, limit: 10, windowMs: 60_000, prefix: 'favorites' },
  sentryTag: 'favorites',
});
