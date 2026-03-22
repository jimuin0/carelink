import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { bookingSchema } from '@/lib/validations-booking';

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = bookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
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

  // 競合チェック
  if (parsed.data.staff_id) {
    const { data: conflicts } = await supabase
      .from('bookings')
      .select('id')
      .eq('staff_id', parsed.data.staff_id)
      .eq('booking_date', parsed.data.booking_date)
      .not('status', 'in', '("cancelled","no_show")')
      .lt('start_time', parsed.data.end_time)
      .gt('end_time', parsed.data.start_time);

    if (conflicts && conflicts.length > 0) {
      return NextResponse.json({ error: 'この時間帯は既に予約が入っています' }, { status: 409 });
    }
  }

  const { error } = await supabase
    .from('bookings')
    .insert({
      ...parsed.data,
      user_id: user?.id ?? null,
      status: 'pending',
    });

  if (error) {
    return NextResponse.json({ error: '予約に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
