import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
  if (!uuidRegex.test(params.id)) {
    return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 });
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

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, user_id, status')
    .eq('id', params.id)
    .single();

  if (!booking) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
  if (booking.user_id !== user.id) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  if (booking.status === 'cancelled') return NextResponse.json({ error: '既にキャンセル済みです' }, { status: 400 });

  const { error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', params.id);

  if (error) {
    return NextResponse.json({ error: 'キャンセルに失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
