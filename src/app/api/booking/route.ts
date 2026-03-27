import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { bookingSchema } from '@/lib/validations-booking';
import { checkCsrf } from '@/lib/csrf';

const bookingLog = new Map<string, number[]>();
const BOOKING_RATE_LIMIT = 3;
const BOOKING_RATE_WINDOW = 300_000; // 5 minutes

function isBookingRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = (bookingLog.get(ip) || []).filter((t) => now - t < BOOKING_RATE_WINDOW);
  if (timestamps.length >= BOOKING_RATE_LIMIT) return true;
  timestamps.push(now);
  bookingLog.set(ip, timestamps);
  // Clean old entries (keep map size reasonable)
  if (bookingLog.size > 1000) {
    Array.from(bookingLog.entries()).forEach(([key, ts]) => {
      if (ts.every((t) => now - t >= BOOKING_RATE_WINDOW)) bookingLog.delete(key);
    });
  }
  return false;
}

export async function POST(request: Request) {
  try {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (isBookingRateLimited(ip)) {
    return NextResponse.json({ error: '短時間に多くのリクエストがありました。しばらくお待ちください。' }, { status: 429 });
  }

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
    // DB制約違反（二重予約）の場合
    if (error.code === '23505') {
      return NextResponse.json({ error: 'この時間帯は既に予約が入っています' }, { status: 409 });
    }
    return NextResponse.json({ error: '予約に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
