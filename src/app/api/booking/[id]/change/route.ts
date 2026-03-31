import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import * as Sentry from '@sentry/nextjs';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const changeSchema = z.object({
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (await checkRateLimit(mutationRateLimit, ip, 10, 60_000, 'booking-change')) {
      return NextResponse.json({ error: '短時間に多くのリクエストがありました。しばらくお待ちください。' }, { status: 429 });
    }

    if (!uuidRegex.test(params.id)) {
      return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 });
    }

    const body = await request.json();
    const parsed = changeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '入力内容が不正です' }, { status: 400 });
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

    // Fetch existing booking
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, user_id, status, facility_id, staff_id')
      .eq('id', params.id)
      .single();

    if (!booking) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    if (booking.user_id !== user.id) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    if (!['pending', 'confirmed'].includes(booking.status)) {
      return NextResponse.json({ error: 'この予約は変更できません' }, { status: 400 });
    }

    // Double-booking check: verify the slot is still available
    if (booking.staff_id) {
      const { data: conflict } = await supabase
        .from('bookings')
        .select('id')
        .eq('staff_id', booking.staff_id)
        .eq('booking_date', parsed.data.booking_date)
        .in('status', ['pending', 'confirmed'])
        .neq('id', params.id)
        .lt('start_time', parsed.data.end_time)
        .gt('end_time', parsed.data.start_time)
        .limit(1);

      if (conflict && conflict.length > 0) {
        return NextResponse.json({ error: 'この時間帯は既に予約が入っています' }, { status: 409 });
      }
    }

    // Update booking
    const { error } = await supabase
      .from('bookings')
      .update({
        booking_date: parsed.data.booking_date,
        start_time: parsed.data.start_time,
        end_time: parsed.data.end_time,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .eq('user_id', user.id);

    if (error) {
      return NextResponse.json({ error: '変更に失敗しました' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'booking-change' } });
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
