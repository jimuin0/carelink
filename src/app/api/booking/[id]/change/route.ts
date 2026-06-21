import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { safeCaptureException } from '@/lib/safe';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { z } from 'zod';
import { sendLineWorksMessage, isLineWorksConfigured } from '@/lib/integrations/line-works';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { writeAuditLog } from '@/lib/audit-logger';

export const dynamic = 'force-dynamic';

const changeSchema = z.object({
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !isNaN(Date.parse(d)), { message: 'Invalid date' }),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
});

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = getClientIp(request);
    if (await checkRateLimit(mutationRateLimit, ip, 10, 60_000, 'booking-change')) {
      return NextResponse.json({ error: '短時間に多くのリクエストがありました。しばらくお待ちください。' }, { status: 429 });
    }

    if (!uuidRegex.test(params.id)) {
      return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = changeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '入力内容が不正です' }, { status: 400 });
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

    // 競合チェック＋UPDATE を change_booking_atomic で同一トランザクション・同一 advisory lock
    // 下に実行（TOCTOU 解消）。指名なし(staff_id NULL)もアクティブ施術者数までの容量判定を行う
    // （旧実装は指名なしの競合チェックを完全スキップしていた）。所有権・状態も RPC 内で再検査。
    const { error } = await supabase.rpc('change_booking_atomic', {
      p_booking_id: params.id,
      p_user_id: user.id,
      p_booking_date: parsed.data.booking_date,
      p_start_time: parsed.data.start_time,
      p_end_time: parsed.data.end_time,
    });

    if (error) {
      const msg = error.message || '';
      if (msg.includes('BOOKING_CONFLICT')) {
        return NextResponse.json({ error: 'この時間帯は既に予約が入っています' }, { status: 409 });
      }
      if (msg.includes('BOOKING_NOT_FOUND')) {
        return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
      }
      if (msg.includes('BOOKING_FORBIDDEN')) {
        return NextResponse.json({ error: '権限がありません' }, { status: 403 });
      }
      if (msg.includes('BOOKING_NOT_CHANGEABLE')) {
        return NextResponse.json({ error: 'この予約は変更できません' }, { status: 400 });
      }
      return NextResponse.json({ error: '変更に失敗しました' }, { status: 500 });
    }

    void writeAuditLog({
      userId: user.id,
      facilityId: booking.facility_id,
      action: 'update',
      tableName: 'bookings',
      recordId: params.id,
      newValues: { booking_date: parsed.data.booking_date, start_time: parsed.data.start_time, end_time: parsed.data.end_time },
      ipAddress: ip,
    });

    // LINE Works change notification (non-blocking)
    if (isLineWorksConfigured()) {
      try {
        const adminSupabase = createServiceRoleClient();
        const { data: staffList } = await adminSupabase
          .from('staff_profiles')
          .select('line_works_channel_id, line_works_notify_all, id')
          .eq('facility_id', booking.facility_id)
          .not('line_works_channel_id', 'is', null);

        if (staffList && staffList.length > 0) {
          const { data: customerBooking } = await adminSupabase
            .from('bookings')
            .select('customer_name, menu_id')
            .eq('id', params.id)
            .maybeSingle();

          let menuName = '';
          if (customerBooking?.menu_id) {
            const { data: menu } = await adminSupabase.from('facility_menus').select('name').eq('id', customerBooking.menu_id).maybeSingle();
            menuName = menu?.name || '';
          }

          const text = [
            '🔄 予約変更',
            '',
            `お客様: ${customerBooking?.customer_name || '不明'}`,
            menuName ? `メニュー: ${menuName}` : '',
            `変更後日時: ${parsed.data.booking_date} ${parsed.data.start_time}`,
          ].filter(Boolean).join('\n');

          for (const staff of staffList) {
            if (!staff.line_works_channel_id) continue;
            if (staff.id !== booking.staff_id && !staff.line_works_notify_all) continue;
            sendLineWorksMessage(staff.line_works_channel_id, { content: { type: 'text', text } })
              .catch((e) => safeCaptureException(e, 'change-lineworks'));
          }
        }
      } catch (e) {
        safeCaptureException(e, 'change-lineworks-setup');
      }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    safeCaptureException(e, 'booking-change');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
