import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import * as Sentry from '@sentry/nextjs';

export async function POST(request: Request) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const { facilityId } = await request.json();
    if (!facilityId || !uuidRegex.test(facilityId)) {
      return NextResponse.json({ error: '無効な施設IDです' }, { status: 400 });
    }

    const cookieStore = cookies();
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
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'favorites' } });
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
