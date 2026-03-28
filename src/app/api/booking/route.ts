import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { bookingSchema } from '@/lib/validations-booking';
import { checkCsrf } from '@/lib/csrf';
import { sendBookingConfirmation, sendNewBookingNotification } from '@/lib/email';
import { bookingRateLimit, checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (await checkRateLimit(bookingRateLimit, ip, 3, 300_000, 'booking')) {
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

  const { data: inserted, error } = await supabase
    .from('bookings')
    .insert({
      ...parsed.data,
      user_id: user?.id ?? null,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    // DB制約違反（二重予約）の場合
    if (error.code === '23505') {
      return NextResponse.json({ error: 'この時間帯は既に予約が入っています' }, { status: 409 });
    }
    return NextResponse.json({ error: '予約に失敗しました' }, { status: 500 });
  }

  const newBookingId = inserted?.id || '';

  // Send email notifications (non-blocking)
  try {
    const { data: facility } = await supabase
      .from('facility_profiles')
      .select('name, phone')
      .eq('id', parsed.data.facility_id)
      .single();

    let mName: string | undefined;
    let sName: string | undefined;
    if (parsed.data.menu_id) {
      const { data: menu } = await supabase.from('facility_menus').select('name').eq('id', parsed.data.menu_id).single();
      mName = menu?.name;
    }
    if (parsed.data.staff_id) {
      const { data: staff } = await supabase.from('staff_profiles').select('name').eq('id', parsed.data.staff_id).single();
      sName = staff?.name;
    }

    const emailData = {
      customerName: parsed.data.customer_name,
      customerEmail: parsed.data.email,
      facilityName: facility?.name || '',
      bookingDate: parsed.data.booking_date,
      startTime: parsed.data.start_time,
      endTime: parsed.data.end_time,
      menuName: mName,
      staffName: sName,
      totalPrice: parsed.data.total_price ?? undefined,
      bookingId: newBookingId,
    };

    void sendBookingConfirmation(emailData);

    // Notify facility owner
    const { data: owner } = await supabase
      .from('facility_members')
      .select('user_id')
      .eq('facility_id', parsed.data.facility_id)
      .eq('role', 'owner')
      .single();
    if (owner) {
      const { data: ownerProfile } = await supabase.from('profiles').select('email').eq('id', owner.user_id).single();
      if (ownerProfile?.email) {
        void sendNewBookingNotification({ ...emailData, facilityEmail: ownerProfile.email });
      }
    }
  } catch {
    // Email failure should not block booking creation
  }

  return NextResponse.json({ success: true, bookingId: newBookingId });
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
